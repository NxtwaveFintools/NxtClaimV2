-- Apply runtime DB object updates after enum split migration.
--
-- Requires:
-- 20260407000200_split_rejected_statuses_with_resubmission.sql

create or replace function public.bulk_process_claims(
  p_action text,
  p_actor_id uuid,
  p_claim_ids text[],
  p_reason text default null,
  p_allow_resubmission boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id text;
  v_processed_count integer := 0;
  v_normalized_action text;
  v_audit_action text;
  v_expected_status public.claim_status;
  v_next_status public.claim_status;
  v_effective_reason text;
  v_beneficiary_id uuid;
  v_payment_mode_name text;
  v_expense_total numeric := 0;
  v_advance_total numeric := 0;
  v_increment_reimbursements numeric := 0;
  v_increment_petty_cash_received numeric := 0;
  v_increment_petty_cash_spent numeric := 0;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    return 0;
  end if;

  if not exists (
    select 1
    from public.master_finance_approvers mfa
    where mfa.user_id = p_actor_id
      and mfa.is_active = true
  ) then
    raise exception 'p_actor_id is not an active finance approver';
  end if;

  v_normalized_action := upper(trim(coalesce(p_action, '')));

  case v_normalized_action
    when 'L2_APPROVE', 'L2_APPROVED' then
      v_audit_action := 'L2_APPROVED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := 'Finance Approved - Payment under process';
      v_effective_reason := null;

    when 'L2_REJECT', 'L2_REJECTED' then
      v_audit_action := 'L2_REJECTED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := case
        when p_allow_resubmission then 'Rejected - Resubmission Allowed'
        else 'Rejected - Resubmission Not Allowed'
      end;
      v_effective_reason := nullif(trim(coalesce(p_reason, '')), '');

      if v_effective_reason is null then
        raise exception 'p_reason is required for L2_REJECT';
      end if;

    when 'MARK_PAID', 'L2_MARK_PAID' then
      v_audit_action := 'L2_MARK_PAID';
      v_expected_status := 'Finance Approved - Payment under process';
      v_next_status := 'Payment Done - Closed';
      v_effective_reason := null;

    else
      raise exception 'Unknown bulk action: %', p_action;
  end case;

  foreach v_claim_id in array p_claim_ids loop
    update public.claims
    set
      status = v_next_status,
      rejection_reason = case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end,
      is_resubmission_allowed = case
        when v_audit_action = 'L2_REJECTED' then p_allow_resubmission
        else false
      end,
      finance_action_at = now(),
      updated_at = now()
    where id = v_claim_id
      and is_active = true
      and status = v_expected_status;

    if not found then
      continue;
    end if;

    insert into public.claim_audit_logs (
      claim_id,
      actor_id,
      action_type,
      assigned_to_id,
      remarks
    )
    values (
      v_claim_id,
      p_actor_id,
      v_audit_action,
      null,
      case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end
    );

    if v_audit_action = 'L2_REJECTED' and p_allow_resubmission then
      update public.expense_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;

      update public.advance_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;
    end if;

    if v_audit_action = 'L2_MARK_PAID' then
      select
        coalesce(c.on_behalf_of_id, c.submitted_by),
        lower(coalesce(pm.name, '')),
        coalesce(
          (
            select ed.total_amount
            from public.expense_details ed
            where ed.claim_id = c.id
              and ed.is_active = true
            limit 1
          ),
          0
        ),
        coalesce(
          (
            select ad.requested_amount
            from public.advance_details ad
            where ad.claim_id = c.id
              and ad.is_active = true
            limit 1
          ),
          0
        )
      into
        v_beneficiary_id,
        v_payment_mode_name,
        v_expense_total,
        v_advance_total
      from public.claims c
      left join public.master_payment_modes pm
        on pm.id = c.payment_mode_id
      where c.id = v_claim_id
      limit 1;

      v_increment_reimbursements := 0;
      v_increment_petty_cash_received := 0;
      v_increment_petty_cash_spent := 0;

      if v_payment_mode_name = 'reimbursement' then
        v_increment_reimbursements := greatest(coalesce(v_expense_total, 0), 0);
      elsif v_payment_mode_name in ('petty cash request', 'bulk petty cash request') then
        v_increment_petty_cash_received := greatest(coalesce(v_advance_total, 0), 0);
      elsif v_payment_mode_name = 'petty cash' then
        v_increment_petty_cash_spent := greatest(coalesce(v_expense_total, 0), 0);
      end if;

      if v_beneficiary_id is not null and (
        v_increment_reimbursements > 0
        or v_increment_petty_cash_received > 0
        or v_increment_petty_cash_spent > 0
      ) then
        insert into public.wallets (
          user_id,
          total_reimbursements_received,
          total_petty_cash_received,
          total_petty_cash_spent
        )
        values (
          v_beneficiary_id,
          v_increment_reimbursements,
          v_increment_petty_cash_received,
          v_increment_petty_cash_spent
        )
        on conflict (user_id)
        do update set
          total_reimbursements_received =
            public.wallets.total_reimbursements_received + excluded.total_reimbursements_received,
          total_petty_cash_received =
            public.wallets.total_petty_cash_received + excluded.total_petty_cash_received,
          total_petty_cash_spent =
            public.wallets.total_petty_cash_spent + excluded.total_petty_cash_spent,
          updated_at = now();
      end if;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

  return v_processed_count;
end;
$$;

drop view if exists public.vw_enterprise_claims_dashboard;

create view public.vw_enterprise_claims_dashboard as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(u.full_name), ''),
    nullif(trim(split_part(u.email, '@', 1)), ''),
    nullif(trim(c.employee_id), ''),
    nullif(trim(c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(c.employee_id), ''),
    nullif(trim(c.on_behalf_employee_code), ''),
    nullif(trim(c.on_behalf_email), ''),
    nullif(trim(u.email), ''),
    'N/A'
  ) as employee_id,
  coalesce(nullif(trim(md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(ed.total_amount, ad.requested_amount, 0)::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status in (
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ) and c.assigned_l2_approver_id is null then c.updated_at
      else null
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status in (
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ) then c.updated_at
      when c.status in (
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ) and c.assigned_l2_approver_id is not null then c.updated_at
      else null
    end
  ) as finance_action_date,
  coalesce(ed.location_id, ad.location_id) as location_id,
  coalesce(ed.product_id, ad.product_id) as product_id,
  ed.expense_category_id as expense_category_id,
  c.submitted_by,
  c.on_behalf_of_id,
  c.on_behalf_email,
  c.assigned_l1_approver_id,
  c.assigned_l2_approver_id,
  c.department_id,
  c.payment_mode_id,
  c.detail_type,
  c.submission_type,
  c.is_active,
  c.created_at,
  c.updated_at,
  submitter.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(u.full_name), '') is not null and nullif(trim(submitter.email), '') is not null
      then trim(u.full_name) || ' (' || trim(submitter.email) || ')'
    when nullif(trim(u.full_name), '') is not null
      then trim(u.full_name)
    when nullif(trim(submitter.email), '') is not null
      then trim(submitter.email)
    else c.employee_id
  end as submitter_label,
  case
    when c.detail_type = 'expense'
      then coalesce(nullif(trim(mec_name.name), ''), 'Uncategorized')
    else 'Advance'
  end as category_name,
  coalesce(ed.purpose, ad.purpose) as purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path
from public.claims c
left join public.users u
  on u.id = c.submitted_by
left join public.users submitter
  on submitter.id = c.submitted_by
left join public.users hod
  on hod.id = c.assigned_l1_approver_id
left join public.users finance
  on finance.id = c.assigned_l2_approver_id
left join public.master_departments md
  on md.id = c.department_id
left join public.master_payment_modes mpm
  on mpm.id = c.payment_mode_id
left join public.expense_details ed
  on ed.claim_id = c.id
  and ed.is_active = true
left join public.master_expense_categories mec_name
  on mec_name.id = ed.expense_category_id
left join public.advance_details ad
  on ad.claim_id = c.id
  and ad.is_active = true
where c.is_active = true;

alter view public.vw_enterprise_claims_dashboard
  set (security_invoker = on);

grant execute on function public.bulk_process_claims(text, uuid, text[], text, boolean) to authenticated;

notify pgrst, 'reload schema';

-- Rollback guidance (manual and non-destructive):
-- 1) Restore previous bulk_process_claims definition from
--    20260404000100_restore_bulk_wallet_updates_and_allow_negative_petty_balance.sql.
-- 2) Restore previous vw_enterprise_claims_dashboard definition from
--    20260407000100_enrich_enterprise_dashboard_view_for_single_fetch.sql.
