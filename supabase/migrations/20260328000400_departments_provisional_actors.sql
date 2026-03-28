-- ============================================================
-- Provisional HOD/Founder support for master_departments
--
-- Mirrors the finance approver provisional email pattern.
-- An admin can enter an email for HOD or Founder. If the user
-- already exists they are linked immediately. If not, the email
-- is stored as provisional and the trigger auto-promotes it to
-- a real user_id when that person first logs in.
-- ============================================================

-- 1. Make user ID columns nullable (they had NOT NULL previously)
alter table public.master_departments
  alter column hod_user_id drop not null;

alter table public.master_departments
  alter column founder_user_id drop not null;

-- 2. Add provisional email columns
alter table public.master_departments
  add column if not exists hod_provisional_email text;

alter table public.master_departments
  add column if not exists founder_provisional_email text;

-- 3. Enforce: at least one of user_id or provisional_email must be non-null
alter table public.master_departments
  drop constraint if exists dept_hod_user_or_email_required;

alter table public.master_departments
  add constraint dept_hod_user_or_email_required check (
    hod_user_id is not null or hod_provisional_email is not null
  );

alter table public.master_departments
  drop constraint if exists dept_founder_user_or_email_required;

alter table public.master_departments
  add constraint dept_founder_user_or_email_required check (
    founder_user_id is not null or founder_provisional_email is not null
  );

-- 4. Indexes for trigger lookups
create index if not exists idx_master_departments_hod_provisional_email
  on public.master_departments(hod_provisional_email)
  where hod_provisional_email is not null;

create index if not exists idx_master_departments_founder_provisional_email
  on public.master_departments(founder_provisional_email)
  where founder_provisional_email is not null;

-- 5. Update handle_new_user trigger to also promote provisional HOD/founder
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

  -- Promote provisional finance approver entry
  update public.master_finance_approvers
  set user_id           = new.id,
      provisional_email = null,
      updated_at        = now()
  where provisional_email = new.email
    and user_id is null;

  -- Promote provisional HOD assignment
  update public.master_departments
  set hod_user_id           = new.id,
      hod_provisional_email = null,
      updated_at            = now()
  where hod_provisional_email = new.email
    and hod_user_id is null;

  -- Promote provisional founder assignment
  update public.master_departments
  set founder_user_id           = new.id,
      founder_provisional_email = null,
      updated_at                = now()
  where founder_provisional_email = new.email
    and founder_user_id is null;

  return new;
end;
$$;
