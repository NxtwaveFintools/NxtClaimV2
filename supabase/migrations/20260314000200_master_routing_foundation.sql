create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'claim_status'
      and n.nspname = 'public'
  ) then
    create type public.claim_status as enum (
      'Submitted - Awaiting HOD approval',
      'HOD approved - Awaiting finance approval',
      'Finance Approved - Payment under process',
      'Payment Done - Closed',
      'Rejected'
    );
  end if;
end $$;

create table if not exists public.master_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  hod_user_id uuid not null references public.users(id) on delete restrict,
  founder_user_id uuid not null references public.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_departments_hod_founder_not_same check (hod_user_id <> founder_user_id)
);

create table if not exists public.master_finance_approvers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete restrict,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_departments_is_active on public.master_departments(is_active);
create index if not exists idx_master_departments_hod_user_id on public.master_departments(hod_user_id);
create index if not exists idx_master_departments_founder_user_id on public.master_departments(founder_user_id);

create index if not exists idx_master_finance_approvers_is_active on public.master_finance_approvers(is_active);
create index if not exists idx_master_finance_approvers_is_primary on public.master_finance_approvers(is_primary);

alter table public.master_departments enable row level security;
alter table public.master_finance_approvers enable row level security;

comment on type public.claim_status is
  'Canonical claim state enum. UI must render enum values as-is from backend.';

comment on table public.master_departments is
  'Department master mapping used for dynamic L1 routing: employee submitter -> HOD, HOD submitter -> Founder.';

comment on table public.master_finance_approvers is
  'Dedicated L2 approver mapping. Claims route to active finance approver(s) only.';

-- Rollback guidance (execute manually in reverse dependency order when safe):
-- 1) drop table if exists public.master_finance_approvers;
-- 2) drop table if exists public.master_departments;
-- 3) drop type if exists public.claim_status;