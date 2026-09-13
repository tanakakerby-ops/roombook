-- ============================================================
-- Campus Room Booking — initial schema (Supabase / Postgres)
-- ============================================================

-- ---------- TABLES ----------

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text default '',
  email text not null,
  role text not null default 'student' check (role in ('student', 'staff', 'admin')),
  account_status text not null default 'active' check (account_status in ('active', 'suspended')),
  created_at timestamptz default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_name text not null,
  room_type text,
  capacity int not null check (capacity > 0),
  location text,
  is_active boolean default true
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id),
  appt_date date not null,
  start_time time not null,
  end_time time not null,
  purpose text not null,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'attended', 'no_show', 'cancelled', 'late_cancelled')),
  qr_token uuid not null default gen_random_uuid(),
  checked_in boolean not null default false,
  actual_check_in_time timestamptz,
  created_at timestamptz default now()
);

create table public.violations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id),
  tier int,
  status text not null default 'active' check (status in ('active', 'voided')),
  issued_at timestamptz default now()
);

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  violation_id uuid not null references public.violations(id),
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  proof_file_url text,
  appeal_status text not null default 'pending' check (appeal_status in ('pending', 'approved', 'denied')),
  submitted_at timestamptz default now(),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz
);

create index on public.appointments (room_id, appt_date, status);
create index on public.appointments (user_id, appt_date desc);
create unique index on public.appointments (qr_token);

-- ---------- ROW LEVEL SECURITY ----------

alter table public.users enable row level security;
alter table public.rooms enable row level security;
alter table public.appointments enable row level security;
alter table public.violations enable row level security;
alter table public.appeals enable row level security;

create function public.is_staff_or_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('staff', 'admin')
  );
$$;

-- users
create policy "users can read all profiles" on public.users
  for select using (auth.uid() is not null);
create policy "users can update own profile" on public.users
  for update using (auth.uid() = id);
create policy "staff manage users" on public.users
  for all using (public.is_staff_or_admin());

-- rooms
create policy "anyone signed in can read rooms" on public.rooms
  for select using (auth.uid() is not null);
create policy "staff manage rooms" on public.rooms
  for all using (public.is_staff_or_admin());

-- appointments
create policy "read own or staff" on public.appointments
  for select using (user_id = auth.uid() or public.is_staff_or_admin());
-- NOTE: inserts/updates to appointments happen only through the
-- book_appointment() / check_in_with_qr() functions below (security definer),
-- so no direct insert/update policy is granted to students here.
create policy "staff update appointments" on public.appointments
  for update using (public.is_staff_or_admin());

-- violations
create policy "read own or staff" on public.violations
  for select using (user_id = auth.uid() or public.is_staff_or_admin());
create policy "staff manage violations" on public.violations
  for all using (public.is_staff_or_admin());

-- appeals
create policy "read own or staff" on public.appeals
  for select using (user_id = auth.uid() or public.is_staff_or_admin());
create policy "users submit own appeal" on public.appeals
  for insert with check (user_id = auth.uid() and appeal_status = 'pending');
create policy "staff review appeals" on public.appeals
  for update using (public.is_staff_or_admin());

-- ============================================================
-- FUNCTIONS (replace the Cloud Functions from the Firebase version)
-- ============================================================

-- ---------- Book a room, enforcing per-slot capacity atomically ----------
create function public.book_appointment(
  p_room_id uuid, p_date date, p_start time, p_end time, p_purpose text
) returns uuid
language plpgsql security definer as $$
declare
  v_capacity int;
  v_overlap_count int;
  v_appt_id uuid;
begin
  -- lock the room row so concurrent bookings for this room serialize
  select capacity into v_capacity from public.rooms where id = p_room_id for update;
  if v_capacity is null then
    raise exception 'Room not found';
  end if;

  select count(*) into v_overlap_count
  from public.appointments
  where room_id = p_room_id
    and appt_date = p_date
    and status in ('upcoming', 'attended')
    and start_time < p_end and end_time > p_start;

  if v_overlap_count >= v_capacity then
    raise exception 'SLOT_FULL';
  end if;

  insert into public.appointments (user_id, room_id, appt_date, start_time, end_time, purpose)
  values (auth.uid(), p_room_id, p_date, p_start, p_end, p_purpose)
  returning id into v_appt_id;

  return v_appt_id;
end;
$$;
grant execute on function public.book_appointment to authenticated;

-- ---------- Validate a scanned QR token and mark attendance ----------
create function public.check_in_with_qr(p_token uuid)
returns table(room_id uuid, purpose text, check_in_time timestamptz)
language plpgsql security definer as $$
declare
  v_appt record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into v_appt from public.appointments where qr_token = p_token;
  if not found then
    raise exception 'INVALID_QR';
  end if;
  if v_appt.checked_in then
    raise exception 'ALREADY_USED';
  end if;

  v_start := (v_appt.appt_date + v_appt.start_time) - interval '10 minutes';
  v_end := (v_appt.appt_date + v_appt.end_time) + interval '15 minutes';
  if v_now < v_start or v_now > v_end then
    raise exception 'OUTSIDE_WINDOW';
  end if;

  update public.appointments
    set checked_in = true, actual_check_in_time = v_now, status = 'attended'
    where id = v_appt.id;

  return query select v_appt.room_id, v_appt.purpose, v_now;
end;
$$;
grant execute on function public.check_in_with_qr to authenticated;

-- ---------- Sweep for no-shows and create violations ----------
-- Call this periodically (via pg_cron if available on your project,
-- otherwise trigger it from the staff dashboard on page load).
create function public.sweep_no_shows()
returns int
language plpgsql security definer as $$
declare
  r record;
  v_tier int;
  v_count int := 0;
begin
  for r in
    select * from public.appointments
    where status = 'upcoming'
      and (appt_date + end_time) < now()
  loop
    update public.appointments set status = 'no_show' where id = r.id;

    insert into public.violations (user_id, appointment_id, status)
    values (r.user_id, r.id, 'active');

    select count(*) into v_tier from public.violations
      where user_id = r.user_id and status = 'active';

    update public.violations set tier = v_tier
      where appointment_id = r.id;

    if v_tier >= 3 then
      update public.users set account_status = 'suspended' where id = r.user_id;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.sweep_no_shows to authenticated;

-- ---------- Staff reviews an appeal ----------
create function public.review_appeal(p_appeal_id uuid, p_decision text)
returns void
language plpgsql security definer as $$
declare
  v_appeal record;
  v_active_count int;
begin
  if not public.is_staff_or_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_decision not in ('approved', 'denied') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_appeal from public.appeals where id = p_appeal_id;
  if not found then
    raise exception 'APPEAL_NOT_FOUND';
  end if;

  update public.appeals
    set appeal_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_appeal_id;

  if p_decision = 'approved' then
    update public.violations set status = 'voided' where id = v_appeal.violation_id;

    select count(*) into v_active_count from public.violations
      where user_id = (select user_id from public.violations where id = v_appeal.violation_id)
      and status = 'active';

    if v_active_count < 3 then
      update public.users set account_status = 'active'
        where id = (select user_id from public.violations where id = v_appeal.violation_id);
    end if;
  end if;
end;
$$;
grant execute on function public.review_appeal to authenticated;

-- ---------- Auto-create a users row whenever someone signs up ----------
create function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, role, account_status)
  values (new.id, new.email, 'student', 'active');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
