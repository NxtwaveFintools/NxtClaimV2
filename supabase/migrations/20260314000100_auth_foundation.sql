create extension if not exists pgcrypto;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.allowed_auth_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  full_name text,
  role text not null check (role in ('employee', 'hod', 'founder', 'finance')),
  department_id uuid references public.departments(id),
  l1_approver_id uuid references public.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_department_id on public.users(department_id);
create index if not exists idx_users_l1_approver_id on public.users(l1_approver_id);
create index if not exists idx_users_role on public.users(role);

alter table public.departments enable row level security;
alter table public.allowed_auth_domains enable row level security;
alter table public.users enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'allowed_auth_domains' and policyname = 'authenticated users can read active domains'
  ) then
    create policy "authenticated users can read active domains"
      on public.allowed_auth_domains
      for select
      to authenticated
      using (is_active = true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users can read own profile'
  ) then
    create policy "users can read own profile"
      on public.users
      for select
      to authenticated
      using (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users can update own profile'
  ) then
    create policy "users can update own profile"
      on public.users
      for update
      to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
