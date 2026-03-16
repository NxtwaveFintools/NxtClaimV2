create extension if not exists pgcrypto;

create table if not exists public.master_payment_modes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_payment_modes_is_active
  on public.master_payment_modes(is_active);

alter table public.master_payment_modes enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'master_payment_modes'
      and policyname = 'authenticated users can read active payment modes'
  ) then
    create policy "authenticated users can read active payment modes"
      on public.master_payment_modes
      for select
      to authenticated
      using (is_active = true);
  end if;
end $$;

comment on table public.master_payment_modes is
  'Master data table for payment modes. Soft delete via is_active only.';

-- Rollback guidance (execute manually when safe):
-- 1) drop policy if exists "authenticated users can read active payment modes" on public.master_payment_modes;
-- 2) drop table if exists public.master_payment_modes;