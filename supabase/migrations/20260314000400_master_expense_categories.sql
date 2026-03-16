create extension if not exists pgcrypto;

create table if not exists public.master_expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_expense_categories_is_active
  on public.master_expense_categories(is_active);

alter table public.master_expense_categories enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'master_expense_categories'
      and policyname = 'authenticated users can read active expense categories'
  ) then
    create policy "authenticated users can read active expense categories"
      on public.master_expense_categories
      for select
      to authenticated
      using (is_active = true);
  end if;
end $$;

comment on table public.master_expense_categories is
  'Master data table for transaction/expense categories. Soft delete via is_active only.';

-- Rollback guidance (execute manually when safe):
-- 1) drop policy if exists "authenticated users can read active expense categories" on public.master_expense_categories;
-- 2) drop table if exists public.master_expense_categories;