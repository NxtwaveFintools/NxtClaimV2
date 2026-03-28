-- ============================================================
-- Fix: admins table RLS infinite recursion
-- The original admins_select_admin policy did:
--   EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid())
-- which re-triggers the same policy → infinite loop → Postgres
-- returns 0 rows silently, causing isAdmin() to always return false.
--
-- Fix: Replace with a simple column-level check so RLS can be
-- evaluated without a recursive sub-query.
-- ============================================================

-- Drop the broken recursive policy
drop policy if exists admins_select_admin on public.admins;

-- Replace with a non-recursive policy: each user can read their own row
create policy admins_select_own_row
  on public.admins
  for select
  to authenticated
  using (user_id = auth.uid());

-- Also fix INSERT/DELETE policies that share the same recursive pattern
drop policy if exists admins_insert_admin on public.admins;
create policy admins_insert_admin
  on public.admins
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

drop policy if exists admins_delete_admin on public.admins;
create policy admins_delete_admin
  on public.admins
  for delete
  to authenticated
  using (user_id = auth.uid());
