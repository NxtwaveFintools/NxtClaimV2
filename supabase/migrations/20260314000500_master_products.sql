create extension if not exists pgcrypto;

create table if not exists public.master_products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_products_is_active
  on public.master_products(is_active);

alter table public.master_products enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'master_products'
      and policyname = 'authenticated users can read active products'
  ) then
    create policy "authenticated users can read active products"
      on public.master_products
      for select
      to authenticated
      using (is_active = true);
  end if;
end $$;

comment on table public.master_products is
  'Master data table for products. Soft delete via is_active only.';

-- Rollback guidance (execute manually when safe):
-- 1) drop policy if exists "authenticated users can read active products" on public.master_products;
-- 2) drop table if exists public.master_products;