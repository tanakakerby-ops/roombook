-- Restrict signups to the school's email domain and student-ID format
-- e.g. 2095928@g.cu.edu.ph — any digit-only local part, exact domain.
-- Adjust the regex below if your school's ID length/format differs.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  if new.email !~* '^[0-9]{5,10}@g\.cu\.edu\.ph$' then
    raise exception 'INVALID_SCHOOL_EMAIL';
  end if;

  insert into public.users (id, email, role, account_status)
  values (new.id, new.email, 'student', 'active');
  return new;
end;
$$;
