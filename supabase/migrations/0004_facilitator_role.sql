-- Rename 'staff' role to 'facilitator' for clarity, and let each
-- facilitator be assigned to manage one room. Admins can see stats
-- across every room and facilitator; facilitators only see their own.
-- Written to be safe to re-run if it partially failed before.

alter table public.users drop constraint if exists users_role_check;

update public.users set role = 'facilitator' where role = 'staff';

alter table public.users add constraint users_role_check
  check (role in ('student', 'facilitator', 'admin'));

alter table public.rooms add column if not exists facilitator_id uuid references public.users(id);

create or replace function public.is_staff_or_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('facilitator', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.get_room_summary(p_room_id uuid)
returns table(
  room_name text, capacity int, total_bookings bigint, attended bigint,
  no_shows bigint, cancelled bigint, active_violations bigint, pending_appeals bigint
)
language plpgsql security definer as $$
begin
  if not public.is_admin() then
    if not exists (select 1 from public.rooms where id = p_room_id and facilitator_id = auth.uid()) then
      raise exception 'PERMISSION_DENIED';
    end if;
  end if;

  return query
  select
    r.room_name, r.capacity,
    count(a.id) as total_bookings,
    count(a.id) filter (where a.status = 'attended') as attended,
    count(a.id) filter (where a.status = 'no_show') as no_shows,
    count(a.id) filter (where a.status in ('cancelled', 'late_cancelled')) as cancelled,
    (select count(*) from public.violations v
      join public.appointments ap on ap.id = v.appointment_id
      where ap.room_id = p_room_id and v.status = 'active') as active_violations,
    (select count(*) from public.appeals ap2
      join public.violations v2 on v2.id = ap2.violation_id
      join public.appointments ap3 on ap3.id = v2.appointment_id
      where ap3.room_id = p_room_id and ap2.appeal_status = 'pending') as pending_appeals
  from public.rooms r
  left join public.appointments a on a.room_id = r.id
  where r.id = p_room_id
  group by r.room_name, r.capacity;
end;
$$;
grant execute on function public.get_room_summary to authenticated;

create or replace function public.get_room_student_breakdown(p_room_id uuid)
returns table(
  user_id uuid, full_name text, email text,
  total_bookings bigint, no_shows bigint, active_violations bigint
)
language plpgsql security definer as $$
begin
  if not public.is_admin() then
    if not exists (select 1 from public.rooms where id = p_room_id and facilitator_id = auth.uid()) then
      raise exception 'PERMISSION_DENIED';
    end if;
  end if;

  return query
  select
    u.id, u.full_name, u.email,
    count(a.id) as total_bookings,
    count(a.id) filter (where a.status = 'no_show') as no_shows,
    (select count(*) from public.violations v
      where v.user_id = u.id and v.status = 'active') as active_violations
  from public.appointments a
  join public.users u on u.id = a.user_id
  where a.room_id = p_room_id
  group by u.id, u.full_name, u.email
  order by no_shows desc;
end;
$$;
grant execute on function public.get_room_student_breakdown to authenticated;

create or replace function public.get_all_rooms_summary()
returns table(
  room_id uuid, room_name text, capacity int, facilitator_name text,
  total_bookings bigint, no_shows bigint, active_violations bigint, pending_appeals bigint
)
language plpgsql security definer as $$
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  return query
  select
    r.id, r.room_name, r.capacity,
    coalesce(f.full_name, 'Unassigned') as facilitator_name,
    count(a.id) as total_bookings,
    count(a.id) filter (where a.status = 'no_show') as no_shows,
    (select count(*) from public.violations v
      join public.appointments ap on ap.id = v.appointment_id
      where ap.room_id = r.id and v.status = 'active') as active_violations,
    (select count(*) from public.appeals ap2
      join public.violations v2 on v2.id = ap2.violation_id
      join public.appointments ap3 on ap3.id = v2.appointment_id
      where ap3.room_id = r.id and ap2.appeal_status = 'pending') as pending_appeals
  from public.rooms r
  left join public.appointments a on a.room_id = r.id
  left join public.users f on f.id = r.facilitator_id
  group by r.id, r.room_name, r.capacity, f.full_name
  order by r.room_name;
end;
$$;
grant execute on function public.get_all_rooms_summary to authenticated;

create or replace function public.assign_facilitator(p_room_id uuid, p_facilitator_id uuid)
returns void
language plpgsql security definer as $$
begin
  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not exists (select 1 from public.users where id = p_facilitator_id and role = 'facilitator') then
    raise exception 'NOT_A_FACILITATOR';
  end if;
  update public.rooms set facilitator_id = p_facilitator_id where id = p_room_id;
end;
$$;
grant execute on function public.assign_facilitator to authenticated;
