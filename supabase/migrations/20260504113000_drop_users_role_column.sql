-- Drop the legacy users.role column now that access is derived from assignment tables.

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  drop column if exists role;
