-- Restore the legacy users.role column from assignment-table truth.

alter table public.users
  add column if not exists role text;

update public.users as u
set role = case
  when exists (
    select 1
    from public.master_departments md
    where md.is_active = true
      and md.founder_user_id = u.id
  ) then 'founder'
  when exists (
    select 1
    from public.master_finance_approvers fa
    where fa.is_active = true
      and fa.user_id = u.id
  ) then 'finance'
  when exists (
    select 1
    from public.master_departments md
    where md.is_active = true
      and md.hod_user_id = u.id
  ) then 'hod'
  else 'employee'
end;

alter table public.users
  alter column role set default 'employee';

update public.users
set role = 'employee'
where role is null;

alter table public.users
  alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_role_check'
  ) then
    alter table public.users
      add constraint users_role_check
      check (
        role = any (array['employee'::text, 'hod'::text, 'founder'::text, 'finance'::text])
      );
  end if;
end
$$;
