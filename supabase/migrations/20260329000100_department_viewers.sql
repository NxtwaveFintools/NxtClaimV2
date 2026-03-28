-- =============================================================================
-- Migration: Department Viewers (POC role)
-- Purpose: Allow users to be assigned as read-only viewers for one or more
--          departments. They can see all claims for their assigned departments
--          but cannot approve, reject, or otherwise mutate claims.
-- =============================================================================

-- 1. Create the department_viewers mapping table
create table public.department_viewers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id),
  department_id uuid not null references public.master_departments(id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_viewers_unique_assignment unique (user_id, department_id)
);

-- 2. Indexes for fast lookups
create index idx_department_viewers_user_id
  on public.department_viewers (user_id);

create index idx_department_viewers_department_id
  on public.department_viewers (department_id);

create index idx_department_viewers_active
  on public.department_viewers (user_id, is_active)
  where is_active = true;

-- 3. Enable RLS on department_viewers
alter table public.department_viewers enable row level security;

-- Users can only read their own viewer assignments
create policy "department_viewers_select_own"
  on public.department_viewers
  for select
  using (user_id = auth.uid());

-- 4. Additive SELECT policy on claims — department viewers can read department claims
-- PostgreSQL ORs multiple SELECT policies, so existing policies remain intact
create policy "department_viewers_can_read_department_claims"
  on public.claims
  for select
  using (
    exists (
      select 1
      from public.department_viewers dv
      where dv.user_id = auth.uid()
        and dv.department_id = claims.department_id
        and dv.is_active = true
    )
  );
