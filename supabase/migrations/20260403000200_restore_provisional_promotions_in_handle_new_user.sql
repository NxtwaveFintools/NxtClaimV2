-- ============================================================
-- Restore provisional-email promotions in auth signup trigger
--
-- Root cause:
-- 20260331000100_fix_bulk_logs_and_names.sql replaced
-- public.handle_new_user() and unintentionally removed promotion
-- logic for provisional rows in:
--   1) master_finance_approvers
--   2) master_departments (hod/founder)
--   3) admins
--
-- This migration restores that logic while keeping the full_name
-- fallback behavior introduced in 20260331000100.
--
-- It also backfills existing provisional rows for users that are
-- already present in public.users.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
begin
  if new.email is null then
    return new;
  end if;

  -- Resolve full_name: full_name -> name -> email prefix.
  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(split_part(new.email, '@', 1)), '')
  );

  insert into public.users (
    id,
    email,
    full_name
  )
  values (
    new.id,
    new.email,
    v_full_name
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(nullif(trim(excluded.full_name), ''), public.users.full_name),
        updated_at = now();

  insert into public.wallets (
    user_id
  )
  values (
    new.id
  )
  on conflict (user_id) do nothing;

  -- Promote provisional finance approver entry.
  update public.master_finance_approvers mfa
  set user_id           = new.id,
      provisional_email = null,
      updated_at        = now()
  where mfa.user_id is null
    and mfa.provisional_email is not null
    and lower(mfa.provisional_email) = lower(new.email)
    and not exists (
      select 1
      from public.master_finance_approvers mfa_existing
      where mfa_existing.user_id = new.id
        and mfa_existing.id <> mfa.id
    );

  -- Promote provisional HOD assignment.
  update public.master_departments md
  set hod_user_id           = new.id,
      hod_provisional_email = null,
      updated_at            = now()
  where md.hod_user_id is null
    and md.hod_provisional_email is not null
    and lower(md.hod_provisional_email) = lower(new.email);

  -- Promote provisional founder assignment.
  update public.master_departments md
  set founder_user_id           = new.id,
      founder_provisional_email = null,
      updated_at                = now()
  where md.founder_user_id is null
    and md.founder_provisional_email is not null
    and lower(md.founder_provisional_email) = lower(new.email);

  -- Promote provisional admin entry.
  update public.admins a
  set user_id           = new.id,
      provisional_email = null,
      updated_at        = now()
  where a.user_id is null
    and a.provisional_email is not null
    and lower(a.provisional_email) = lower(new.email)
    and not exists (
      select 1
      from public.admins a_existing
      where a_existing.user_id = new.id
        and a_existing.id <> a.id
    );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Backfill: promote provisional finance approvers where user already exists.
update public.master_finance_approvers mfa
set user_id           = u.id,
    provisional_email = null,
    updated_at        = now()
from public.users u
where mfa.user_id is null
  and mfa.provisional_email is not null
  and lower(mfa.provisional_email) = lower(u.email)
  and not exists (
    select 1
    from public.master_finance_approvers mfa_existing
    where mfa_existing.user_id = u.id
      and mfa_existing.id <> mfa.id
  );

-- Backfill: promote provisional HOD and founder assignments.
update public.master_departments md
set hod_user_id           = u.id,
    hod_provisional_email = null,
    updated_at            = now()
from public.users u
where md.hod_user_id is null
  and md.hod_provisional_email is not null
  and lower(md.hod_provisional_email) = lower(u.email);

update public.master_departments md
set founder_user_id           = u.id,
    founder_provisional_email = null,
    updated_at                = now()
from public.users u
where md.founder_user_id is null
  and md.founder_provisional_email is not null
  and lower(md.founder_provisional_email) = lower(u.email);

-- Backfill: promote provisional admins where user already exists.
update public.admins a
set user_id           = u.id,
    provisional_email = null,
    updated_at        = now()
from public.users u
where a.user_id is null
  and a.provisional_email is not null
  and lower(a.provisional_email) = lower(u.email)
  and not exists (
    select 1
    from public.admins a_existing
    where a_existing.user_id = u.id
      and a_existing.id <> a.id
  );

notify pgrst, 'reload schema';

-- Rollback guidance (manual):
-- 1) Recreate previous function definition from
--    20260331000100_fix_bulk_logs_and_names.sql if required.
-- 2) Re-run backfill only after restoring desired trigger behavior.
