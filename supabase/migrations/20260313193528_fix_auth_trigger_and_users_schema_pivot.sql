-- 1) Remove potentially faulty auth sync triggers/functions (safe if already absent)
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_sync_public_users on auth.users;
drop trigger if exists handle_new_user on auth.users;
drop trigger if exists auth_user_sync_trigger on auth.users;

drop function if exists public.on_auth_user_created();
drop function if exists public.handle_new_user();
drop function if exists public.sync_auth_user_to_public_user();
drop function if exists auth.on_auth_user_created();
drop function if exists auth.handle_new_user();

-- 2) Schema pivot: remove user-profile hardcoded routing columns
alter table public.users
  drop column if exists role,
  drop column if exists l1_approver_id,
  drop column if exists department_id;

-- 3) Add dynamic HOD mapping column only if master_departments exists
do $$
begin
  if to_regclass('public.master_departments') is not null then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'master_departments'
        and column_name = 'hod_user_id'
    ) then
      alter table public.master_departments add column hod_user_id uuid;
    end if;
  end if;
end $$;