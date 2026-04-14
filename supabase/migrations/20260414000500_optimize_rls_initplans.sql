begin;

-- users
drop policy if exists "users can read own profile" on public.users;
create policy "users can read own profile"
  on public.users
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "users can update own profile" on public.users;
create policy "users can update own profile"
  on public.users
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists users_select_admin on public.users;
create policy users_select_admin
  on public.users
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists users_update_admin on public.users;
create policy users_update_admin
  on public.users
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- claims
drop policy if exists "submitters and approvers can read claims" on public.claims;
create policy "submitters and approvers can read claims"
  on public.claims
  for select
  to authenticated
  using (
    (select auth.uid()) = submitted_by
    or (select auth.uid()) = on_behalf_of_id
    or (select auth.uid()) = assigned_l1_approver_id
    or exists (
      select 1
      from public.master_finance_approvers mfa
      where mfa.id = claims.assigned_l2_approver_id
        and mfa.user_id = (select auth.uid())
        and mfa.is_active = true
    )
  );

drop policy if exists "submitters can create claims" on public.claims;
create policy "submitters can create claims"
  on public.claims
  for insert
  to authenticated
  with check ((select auth.uid()) = submitted_by);

drop policy if exists claims_select_admin on public.claims;
create policy claims_select_admin
  on public.claims
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists claims_update_admin on public.claims;
create policy claims_update_admin
  on public.claims
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists "department_viewers_can_read_department_claims" on public.claims;
create policy "department_viewers_can_read_department_claims"
  on public.claims
  for select
  using (
    exists (
      select 1
      from public.department_viewers dv
      where dv.user_id = (select auth.uid())
        and dv.department_id = claims.department_id
        and dv.is_active = true
    )
  );

-- expense_details
drop policy if exists "submitters and approvers can read expense details" on public.expense_details;
create policy "submitters and approvers can read expense details"
  on public.expense_details
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.claims c
      where c.id = expense_details.claim_id
        and (
          (select auth.uid()) = c.submitted_by
          or (select auth.uid()) = c.on_behalf_of_id
          or (select auth.uid()) = c.assigned_l1_approver_id
          or exists (
            select 1
            from public.master_finance_approvers mfa
            where mfa.id = c.assigned_l2_approver_id
              and mfa.user_id = (select auth.uid())
              and mfa.is_active = true
          )
        )
    )
  );

drop policy if exists expense_details_select_admin on public.expense_details;
create policy expense_details_select_admin
  on public.expense_details
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- advance_details
drop policy if exists "submitters and approvers can read advance details" on public.advance_details;
create policy "submitters and approvers can read advance details"
  on public.advance_details
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.claims c
      where c.id = advance_details.claim_id
        and (
          (select auth.uid()) = c.submitted_by
          or (select auth.uid()) = c.on_behalf_of_id
          or (select auth.uid()) = c.assigned_l1_approver_id
          or exists (
            select 1
            from public.master_finance_approvers mfa
            where mfa.id = c.assigned_l2_approver_id
              and mfa.user_id = (select auth.uid())
              and mfa.is_active = true
          )
        )
    )
  );

drop policy if exists advance_details_select_admin on public.advance_details;
create policy advance_details_select_admin
  on public.advance_details
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- wallets
drop policy if exists "users can read own wallet" on public.wallets;
create policy "users can read own wallet"
  on public.wallets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "finance can insert wallets" on public.wallets;
create policy "finance can insert wallets"
  on public.wallets
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.master_finance_approvers mfa
      where mfa.user_id = (select auth.uid())
        and mfa.is_active = true
    )
  );

drop policy if exists "finance can update wallets" on public.wallets;
create policy "finance can update wallets"
  on public.wallets
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.master_finance_approvers mfa
      where mfa.user_id = (select auth.uid())
        and mfa.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.master_finance_approvers mfa
      where mfa.user_id = (select auth.uid())
        and mfa.is_active = true
    )
  );

drop policy if exists wallets_select_admin on public.wallets;
create policy wallets_select_admin
  on public.wallets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- claim_audit_logs
drop policy if exists claim_audit_logs_select_involved_users on public.claim_audit_logs;
create policy claim_audit_logs_select_involved_users
  on public.claim_audit_logs
  for select
  to authenticated
  using (
    actor_id = (select auth.uid())
    or assigned_to_id = (select auth.uid())
    or exists (
      select 1
      from public.claims c
      where c.id = claim_audit_logs.claim_id
        and (
          c.submitted_by = (select auth.uid())
          or c.on_behalf_of_id = (select auth.uid())
          or c.assigned_l1_approver_id = (select auth.uid())
          or c.assigned_l2_approver_id = (select auth.uid())
        )
    )
  );

drop policy if exists claim_audit_logs_insert_admin on public.claim_audit_logs;
create policy claim_audit_logs_insert_admin
  on public.claim_audit_logs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists claim_audit_logs_select_admin on public.claim_audit_logs;
create policy claim_audit_logs_select_admin
  on public.claim_audit_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- admins
drop policy if exists admins_select_own_row on public.admins;
create policy admins_select_own_row
  on public.admins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists admins_insert_admin on public.admins;
create policy admins_insert_admin
  on public.admins
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists admins_delete_admin on public.admins;
create policy admins_delete_admin
  on public.admins
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- master_expense_categories
drop policy if exists master_expense_categories_insert_admin on public.master_expense_categories;
create policy master_expense_categories_insert_admin
  on public.master_expense_categories
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists master_expense_categories_update_admin on public.master_expense_categories;
create policy master_expense_categories_update_admin
  on public.master_expense_categories
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- master_products
drop policy if exists master_products_insert_admin on public.master_products;
create policy master_products_insert_admin
  on public.master_products
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists master_products_update_admin on public.master_products;
create policy master_products_update_admin
  on public.master_products
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- master_locations
drop policy if exists master_locations_insert_admin on public.master_locations;
create policy master_locations_insert_admin
  on public.master_locations
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists master_locations_update_admin on public.master_locations;
create policy master_locations_update_admin
  on public.master_locations
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- master_payment_modes
drop policy if exists master_payment_modes_insert_admin on public.master_payment_modes;
create policy master_payment_modes_insert_admin
  on public.master_payment_modes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists master_payment_modes_update_admin on public.master_payment_modes;
create policy master_payment_modes_update_admin
  on public.master_payment_modes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- master_departments
drop policy if exists master_departments_insert_admin on public.master_departments;
create policy master_departments_insert_admin
  on public.master_departments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists master_departments_update_admin on public.master_departments;
create policy master_departments_update_admin
  on public.master_departments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- master_finance_approvers
drop policy if exists master_finance_approvers_insert_admin on public.master_finance_approvers;
create policy master_finance_approvers_insert_admin
  on public.master_finance_approvers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists master_finance_approvers_update_admin on public.master_finance_approvers;
create policy master_finance_approvers_update_admin
  on public.master_finance_approvers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists master_finance_approvers_delete_admin on public.master_finance_approvers;
create policy master_finance_approvers_delete_admin
  on public.master_finance_approvers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- department_viewers
drop policy if exists "department_viewers_select_own" on public.department_viewers;
create policy "department_viewers_select_own"
  on public.department_viewers
  for select
  using (user_id = (select auth.uid()));

-- master_policies
drop policy if exists "admins can insert policies" on public.master_policies;
create policy "admins can insert policies"
  on public.master_policies
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists "admins can update policies" on public.master_policies;
create policy "admins can update policies"
  on public.master_policies
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

-- user_policy_acceptances
drop policy if exists "users can read own policy acceptances" on public.user_policy_acceptances;
create policy "users can read own policy acceptances"
  on public.user_policy_acceptances
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users can insert own policy acceptances" on public.user_policy_acceptances;
create policy "users can insert own policy acceptances"
  on public.user_policy_acceptances
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- storage.objects
drop policy if exists "authenticated users can upload own claim files" on storage.objects;
create policy "authenticated users can upload own claim files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'claims'
    and split_part(name, '/', 1) in ('expenses', 'petty_cash_requests')
    and split_part(name, '/', 2) = (select auth.uid())::text
    and split_part(name, '/', 3) <> ''
  );

drop policy if exists "admins can upload policy files" on storage.objects;
create policy "admins can upload policy files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'policies'
    and exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

drop policy if exists "admins can update policy files" on storage.objects;
create policy "admins can update policy files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'policies'
    and exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'policies'
    and exists (
      select 1
      from public.admins a
      where a.user_id = (select auth.uid())
    )
  );

commit;
