-- ============================================================
-- Provisional email support for admins
--
-- Mirrors the finance approver provisional email pattern.
-- An admin can enter an email address for a future admin.
-- If the user already exists they are linked immediately.
-- If not, the email is stored as provisional and the trigger
-- auto-promotes it to a real user_id when that person logs in.
-- ============================================================

-- 1. Make user_id nullable (previously NOT NULL)
alter table public.admins
  alter column user_id drop not null;

-- Add updated_at for trigger bookkeeping
alter table public.admins
  add column if not exists updated_at timestamptz not null default now();

-- 2. Add provisional_email column
alter table public.admins
  add column if not exists provisional_email text;

-- 3. Enforce: at least one of user_id or provisional_email must be non-null
alter table public.admins
  drop constraint if exists admins_user_or_email_required;

alter table public.admins
  add constraint admins_user_or_email_required check (
    user_id is not null or provisional_email is not null
  );

-- 4. Index for trigger lookups
create index if not exists idx_admins_provisional_email
  on public.admins(provisional_email)
  where provisional_email is not null;

-- 5. Update handle_new_user trigger to also promote provisional admins
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

  -- Promote provisional admin entry
  update public.admins
  set user_id           = new.id,
      provisional_email = null,
      updated_at        = now()
  where provisional_email = new.email
    and user_id is null;

  return new;
end;
$$;
