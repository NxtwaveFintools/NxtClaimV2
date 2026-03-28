-- ============================================================
-- Admin Control Center — NxtClaim V2
-- Adds an orthogonal `admins` table (separate from users.role),
-- additive RLS policies giving admins system-wide read / write
-- on master data + soft-delete on claims, and fills the missing
-- authenticated SELECT policies on master routing tables.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. public.admins — orthogonal admin membership table
-- ----------------------------------------------------------------
create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

revoke all on table public.admins from anon;
revoke all on table public.admins from authenticated;

grant select, insert, delete on table public.admins to authenticated;

-- Admins can see the full admins table
drop policy if exists admins_select_admin on public.admins;
create policy admins_select_admin
  on public.admins
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- Admins can add new admins
drop policy if exists admins_insert_admin on public.admins;
create policy admins_insert_admin
  on public.admins
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- Admins can remove admins
drop policy if exists admins_delete_admin on public.admins;
create policy admins_delete_admin
  on public.admins
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- 2. Fill missing SELECT policies on master_departments and
--    master_finance_approvers (RLS is enabled but no SELECT
--    policies exist, which breaks existing HOD/Finance dropdowns)
-- ----------------------------------------------------------------
grant select on table public.master_departments to authenticated;

drop policy if exists master_departments_select_authenticated on public.master_departments;
create policy master_departments_select_authenticated
  on public.master_departments
  for select
  to authenticated
  using (true);

grant select on table public.master_finance_approvers to authenticated;

drop policy if exists master_finance_approvers_select_authenticated on public.master_finance_approvers;
create policy master_finance_approvers_select_authenticated
  on public.master_finance_approvers
  for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------
-- 3. Additive RLS policies for admin access on claims
-- ----------------------------------------------------------------
grant select, update on table public.claims to authenticated;

drop policy if exists claims_select_admin on public.claims;
create policy claims_select_admin
  on public.claims
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

drop policy if exists claims_update_admin on public.claims;
create policy claims_update_admin
  on public.claims
  for update
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- 4. Additive RLS policies for admin access on expense_details
-- ----------------------------------------------------------------
grant select on table public.expense_details to authenticated;

drop policy if exists expense_details_select_admin on public.expense_details;
create policy expense_details_select_admin
  on public.expense_details
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- 5. Additive RLS policies for admin access on advance_details
-- ----------------------------------------------------------------
grant select on table public.advance_details to authenticated;

drop policy if exists advance_details_select_admin on public.advance_details;
create policy advance_details_select_admin
  on public.advance_details
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- 6. Extend claim_audit_logs CHECK constraint to include
--    'ADMIN_SOFT_DELETED' and add INSERT grant for admins
-- ----------------------------------------------------------------
alter table public.claim_audit_logs
  drop constraint if exists claim_audit_logs_action_type_check;

alter table public.claim_audit_logs
  add constraint claim_audit_logs_action_type_check check (
    action_type in (
      'SUBMITTED',
      'L1_APPROVED',
      'L1_REJECTED',
      'L2_APPROVED',
      'L2_REJECTED',
      'ADMIN_SOFT_DELETED'
    )
  );

grant insert on table public.claim_audit_logs to authenticated;

drop policy if exists claim_audit_logs_insert_admin on public.claim_audit_logs;
create policy claim_audit_logs_insert_admin
  on public.claim_audit_logs
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

drop policy if exists claim_audit_logs_select_admin on public.claim_audit_logs;
create policy claim_audit_logs_select_admin
  on public.claim_audit_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- 7. Additive RLS policies for admin on simple master tables
-- ----------------------------------------------------------------
grant insert, update on table public.master_expense_categories to authenticated;

drop policy if exists master_expense_categories_insert_admin on public.master_expense_categories;
create policy master_expense_categories_insert_admin
  on public.master_expense_categories
  for insert
  to authenticated
  with check (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
  );

drop policy if exists master_expense_categories_update_admin on public.master_expense_categories;
create policy master_expense_categories_update_admin
  on public.master_expense_categories
  for update
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

grant insert, update on table public.master_products to authenticated;

drop policy if exists master_products_insert_admin on public.master_products;
create policy master_products_insert_admin
  on public.master_products
  for insert
  to authenticated
  with check (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
  );

drop policy if exists master_products_update_admin on public.master_products;
create policy master_products_update_admin
  on public.master_products
  for update
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

grant insert, update on table public.master_locations to authenticated;

drop policy if exists master_locations_insert_admin on public.master_locations;
create policy master_locations_insert_admin
  on public.master_locations
  for insert
  to authenticated
  with check (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
  );

drop policy if exists master_locations_update_admin on public.master_locations;
create policy master_locations_update_admin
  on public.master_locations
  for update
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

grant insert, update on table public.master_payment_modes to authenticated;

drop policy if exists master_payment_modes_insert_admin on public.master_payment_modes;
create policy master_payment_modes_insert_admin
  on public.master_payment_modes
  for insert
  to authenticated
  with check (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
  );

drop policy if exists master_payment_modes_update_admin on public.master_payment_modes;
create policy master_payment_modes_update_admin
  on public.master_payment_modes
  for update
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- ----------------------------------------------------------------
-- 8. Additive RLS policies for admin on master_departments (routing)
-- ----------------------------------------------------------------
grant insert, update on table public.master_departments to authenticated;

drop policy if exists master_departments_insert_admin on public.master_departments;
create policy master_departments_insert_admin
  on public.master_departments
  for insert
  to authenticated
  with check (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
  );

drop policy if exists master_departments_update_admin on public.master_departments;
create policy master_departments_update_admin
  on public.master_departments
  for update
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- ----------------------------------------------------------------
-- 9. Additive RLS policies for admin on master_finance_approvers
-- ----------------------------------------------------------------
grant insert, update, delete on table public.master_finance_approvers to authenticated;

drop policy if exists master_finance_approvers_insert_admin on public.master_finance_approvers;
create policy master_finance_approvers_insert_admin
  on public.master_finance_approvers
  for insert
  to authenticated
  with check (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
  );

drop policy if exists master_finance_approvers_update_admin on public.master_finance_approvers;
create policy master_finance_approvers_update_admin
  on public.master_finance_approvers
  for update
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

drop policy if exists master_finance_approvers_delete_admin on public.master_finance_approvers;
create policy master_finance_approvers_delete_admin
  on public.master_finance_approvers
  for delete
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- ----------------------------------------------------------------
-- 10. Additive RLS policies for admin on users
-- ----------------------------------------------------------------
grant update on table public.users to authenticated;

drop policy if exists users_select_admin on public.users;
create policy users_select_admin
  on public.users
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

drop policy if exists users_update_admin on public.users;
create policy users_update_admin
  on public.users
  for update
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- 11. Additive RLS policies for admin on wallets (read-only)
-- ----------------------------------------------------------------
grant select on table public.wallets to authenticated;

drop policy if exists wallets_select_admin on public.wallets;
create policy wallets_select_admin
  on public.wallets
  for select
  to authenticated
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
    )
  );
