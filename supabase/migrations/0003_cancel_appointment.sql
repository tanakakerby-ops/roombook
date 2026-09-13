-- Lets a student cancel their own appointment, applying the
-- on-time vs late cancellation distinction we designed earlier.
-- Runs as security definer so it can bypass the staff-only update
-- policy on appointments, while still checking ownership itself.

create function public.cancel_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_appt record;
  v_start timestamptz;
  v_new_status text;
begin
  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;
  if v_appt.user_id <> auth.uid() then
    raise exception 'NOT_YOUR_APPOINTMENT';
  end if;
  if v_appt.status not in ('upcoming') then
    raise exception 'CANNOT_CANCEL';
  end if;

  v_start := v_appt.appt_date + v_appt.start_time;

  -- inside 1 hour of the appointment start = late cancellation
  if now() > (v_start - interval '1 hour') then
    v_new_status := 'late_cancelled';
  else
    v_new_status := 'cancelled';
  end if;

  update public.appointments set status = v_new_status where id = p_appointment_id;
end;
$$;
grant execute on function public.cancel_appointment to authenticated;
