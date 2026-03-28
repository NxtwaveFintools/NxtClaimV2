-- ============================================================
-- Fix schema drift between migrations and the hosted database
--
-- Issues fixed:
-- 1. master_departments had approver_1/approver_2 instead of
--    hod_user_id/founder_user_id (DB state diverged from migrations).
-- 2. users.role was dropped in schema pivot but the admin UI needs it.
-- 3. master_finance_approvers gains provisional_email so admins can
--    pre-register a finance approver by email before they first log in.
--    When they log in, the auth trigger auto-promotes the provisional
--    row to a fully-linked row.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Rename master_departments columns + FK constraints
-- ----------------------------------------------------------------

-- Rename approver_1 → hod_user_id
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'master_departments'
      and column_name = 'approver_1'
  ) then
    alter table public.master_departments rename column approver_1 to hod_user_id;
  end if;
end $$;

-- Rename approver_2 → founder_user_id
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'master_departments'
      and column_name = 'approver_2'
  ) then
    alter table public.master_departments rename column approver_2 to founder_user_id;
  end if;
end $$;

-- Rename FK constraints to match new column names (if old names exist)
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'master_departments'
      and constraint_name = 'master_departments_approver_1_fkey'
  ) then
    alter table public.master_departments
      rename constraint master_departments_approver_1_fkey
      to master_departments_hod_user_id_fkey;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'master_departments'
      and constraint_name = 'master_departments_approver_2_fkey'
  ) then
    alter table public.master_departments
      rename constraint master_departments_approver_2_fkey
      to master_departments_founder_user_id_fkey;
  end if;
end $$;

-- Recreate indexes with correct names
drop index if exists idx_master_departments_hod_user_id;
drop index if exists idx_master_departments_founder_user_id;
create index if not exists idx_master_departments_hod_user_id
  on public.master_departments(hod_user_id);
create index if not exists idx_master_departments_founder_user_id
  on public.master_departments(founder_user_id);

-- ----------------------------------------------------------------
-- 2. Restore users.role (was dropped in schema pivot but required
--    by the admin Users management tab to assign routing roles)
-- ----------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'role'
  ) then
    alter table public.users
      add column role text not null default 'employee'
        check (role in ('employee', 'hod', 'founder', 'finance'));
  end if;
end $$;

-- ----------------------------------------------------------------
-- 3. Provisional finance approver support
--
-- Allows an admin to pre-register a finance approver by email.
-- When that person first logs in, the trigger below auto-promotes
-- the provisional entry by filling in their user_id.
-- ----------------------------------------------------------------

-- 3a. Make user_id nullable (was NOT NULL)
alter table public.master_finance_approvers
  alter column user_id drop not null;

-- 3b. Add provisional_email column
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'master_finance_approvers'
      and column_name = 'provisional_email'
  ) then
    alter table public.master_finance_approvers
      add column provisional_email text;
  end if;
end $$;

-- 3c. Add constraint: exactly one of user_id or provisional_email must be set
alter table public.master_finance_approvers
  drop constraint if exists finance_approver_user_or_email_required;

alter table public.master_finance_approvers
  add constraint finance_approver_user_or_email_required check (
    (user_id is not null and provisional_email is null)
    or
    (user_id is null and provisional_email is not null)
  );

-- 3d. Index for the auto-promote trigger lookup
create index if not exists idx_master_finance_approvers_provisional_email
  on public.master_finance_approvers(provisional_email)
  where provisional_email is not null;

-- ----------------------------------------------------------------
-- 4. Update handle_new_user trigger to auto-promote provisional
--    finance approver entries when a matching user signs in
-- ----------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then
    return new;
  end if;

  -- Upsert user row
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(excluded.full_name, public.users.full_name),
        updated_at = now();

  -- Upsert wallet row
  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Promote any provisional finance approver entry that matches this email
  update public.master_finance_approvers
  set user_id          = new.id,
      provisional_email = null,
      updated_at        = now()
  where provisional_email = new.email
    and user_id is null;

  return new;
end;
$$;
