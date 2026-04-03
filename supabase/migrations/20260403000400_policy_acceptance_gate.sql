create extension if not exists pgcrypto;

-- ============================================================
-- Policy Acceptance Gate Foundation (PDF-based)
-- Adds policy versioning, user acceptance audit trail, and
-- a dedicated Supabase Storage bucket for policy PDFs.
-- ============================================================

create table if not exists public.master_policies (
  id uuid primary key default gen_random_uuid(),
  version_name text not null unique,
  file_url text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  policy_id uuid not null references public.master_policies(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  constraint user_policy_acceptances_user_policy_key unique (user_id, policy_id)
);

create index if not exists idx_master_policies_is_active
  on public.master_policies(is_active);

create index if not exists idx_master_policies_created_at
  on public.master_policies(created_at desc);

create unique index if not exists uq_master_policies_single_active
  on public.master_policies(is_active)
  where is_active = true;

create index if not exists idx_user_policy_acceptances_user_id
  on public.user_policy_acceptances(user_id);

create index if not exists idx_user_policy_acceptances_policy_id
  on public.user_policy_acceptances(policy_id);

create index if not exists idx_user_policy_acceptances_accepted_at
  on public.user_policy_acceptances(accepted_at desc);

alter table public.master_policies enable row level security;
alter table public.user_policy_acceptances enable row level security;

grant select, insert, update on table public.master_policies to authenticated;
grant select, insert on table public.user_policy_acceptances to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'master_policies'
      and policyname = 'authenticated users can read active policy'
  ) then
    create policy "authenticated users can read active policy"
      on public.master_policies
      for select
      to authenticated
      using (is_active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'master_policies'
      and policyname = 'admins can insert policies'
  ) then
    create policy "admins can insert policies"
      on public.master_policies
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.admins a
          where a.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'master_policies'
      and policyname = 'admins can update policies'
  ) then
    create policy "admins can update policies"
      on public.master_policies
      for update
      to authenticated
      using (
        exists (
          select 1
          from public.admins a
          where a.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.admins a
          where a.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_policy_acceptances'
      and policyname = 'users can read own policy acceptances'
  ) then
    create policy "users can read own policy acceptances"
      on public.user_policy_acceptances
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_policy_acceptances'
      and policyname = 'users can insert own policy acceptances'
  ) then
    create policy "users can insert own policy acceptances"
      on public.user_policy_acceptances
      for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policies',
  'policies',
  true,
  26214400,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'authenticated users can read policy files'
  ) then
    create policy "authenticated users can read policy files"
      on storage.objects
      for select
      to authenticated
      using (bucket_id = 'policies');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'admins can upload policy files'
  ) then
    create policy "admins can upload policy files"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'policies'
        and exists (
          select 1
          from public.admins a
          where a.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'admins can update policy files'
  ) then
    create policy "admins can update policy files"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'policies'
        and exists (
          select 1
          from public.admins a
          where a.user_id = auth.uid()
        )
      )
      with check (
        bucket_id = 'policies'
        and exists (
          select 1
          from public.admins a
          where a.user_id = auth.uid()
        )
      );
  end if;
end $$;

update public.master_policies
set is_active = false
where is_active = true
  and version_name <> 'FIN-POL-002';

insert into public.master_policies (version_name, file_url, is_active)
values ('FIN-POL-002', '/policies/fin-pol-002.pdf', true)
on conflict (version_name) do update
set
  file_url = excluded.file_url,
  is_active = true;

comment on table public.master_policies is
  'Versioned company policy records. file_url points to a PDF stored in the public policies bucket.';

comment on table public.user_policy_acceptances is
  'Legal audit trail of user acceptance timestamps per policy version. Historical rows are immutable.';

-- Rollback guidance (execute manually when safe):
-- 1) drop policy if exists "admins can update policy files" on storage.objects;
-- 2) drop policy if exists "admins can upload policy files" on storage.objects;
-- 3) drop policy if exists "authenticated users can read policy files" on storage.objects;
-- 4) delete from storage.buckets where id = 'policies';
-- 5) drop policy if exists "users can insert own policy acceptances" on public.user_policy_acceptances;
-- 6) drop policy if exists "users can read own policy acceptances" on public.user_policy_acceptances;
-- 7) drop policy if exists "admins can update policies" on public.master_policies;
-- 8) drop policy if exists "admins can insert policies" on public.master_policies;
-- 9) drop policy if exists "authenticated users can read active policy" on public.master_policies;
-- 10) drop table if exists public.user_policy_acceptances;
-- 11) drop table if exists public.master_policies;
