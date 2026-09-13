-- Adds configurable operating hours per room, and a function that
-- returns, for a given room and date, each time slot with how many
-- students are already booked into it vs. the room's capacity.
-- Used to power the green/yellow/red slot picker on the dashboard.

alter table public.rooms add column if not exists open_time time not null default '08:00';
alter table public.rooms add column if not exists close_time time not null default '17:00';
alter table public.rooms add column if not exists slot_duration_minutes int not null default 60;

create or replace function public.get_slot_availability(p_room_id uuid, p_date date)
returns table(slot_start time, slot_end time, booked_count bigint, capacity int)
language plpgsql security definer as $$
declare
  v_open time;
  v_close time;
  v_duration int;
  v_capacity int;
begin
  select open_time, close_time, slot_duration_minutes, capacity
    into v_open, v_close, v_duration, v_capacity
    from public.rooms where id = p_room_id;

  if v_capacity is null then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  return query
  select
    s::time as slot_start,
    (s + (v_duration || ' minutes')::interval)::time as slot_end,
    (
      select count(*) from public.appointments a
      where a.room_id = p_room_id
        and a.appt_date = p_date
        and a.status in ('upcoming', 'attended')
        and a.start_time < (s + (v_duration || ' minutes')::interval)::time
        and a.end_time > s::time
    ) as booked_count,
    v_capacity as capacity
  from generate_series(
    (p_date + v_open)::timestamp,
    (p_date + v_close)::timestamp - (v_duration || ' minutes')::interval,
    (v_duration || ' minutes')::interval
  ) as s;
end;
$$;
grant execute on function public.get_slot_availability to authenticated;
