-- Recreate the two dashboard views with bc_claim_details joined in.
-- See spec docs/superpowers/specs/2026-05-16-bc-payload-expansion-design.md §1.3.
-- Note: the previous migration (20260517090000) already DROP VIEW IF EXISTSed these
-- so it could DROP COLUMN bc_payments_flag / is_vendor_payment from claims. This
-- migration creates them fresh with the new columns.

drop view if exists public.vw_admin_claims_dashboard;

create view public.vw_admin_claims_dashboard
with (security_invoker = 'on') as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(both from u.full_name), ''),
    nullif(trim(both from split_part(u.email, '@', 1)), ''),
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_employee_code), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    nullif(trim(both from u.email), ''),
    'N/A'
  ) as employee_id,
  c.employee_id as claim_employee_id_raw,
  c.on_behalf_employee_code as on_behalf_employee_code_raw,
  nullif(trim(both from u.full_name), '') as submitter_name_raw,
  nullif(trim(both from beneficiary.full_name), '') as beneficiary_name_raw,
  coalesce(nullif(trim(both from md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(both from mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(
    ed.approved_amount,
    ed.requested_total_amount,
    ad.approved_amount,
    ad.requested_total_amount,
    0
  )::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is null then c.updated_at
      else null::timestamp with time zone
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status = any(array[
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ]) then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is not null then c.updated_at
      else null::timestamp with time zone
    end
  ) as finance_action_date,
  coalesce(ed.location_id, ad.location_id) as location_id,
  coalesce(ed.product_id, ad.product_id) as product_id,
  ed.expense_category_id,
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
  c.deleted_by,
  c.deleted_at,
  nullif(trim(both from deleted_by_user.full_name), '') as deleted_by_name,
  case
    when c.deleted_by is null then null::text
    when exists (
      select 1
      from public.admins a
      where a.user_id = c.deleted_by
    ) then 'admin'
    when exists (
      select 1
      from public.master_finance_approvers f
      where f.user_id = c.deleted_by
        and f.is_active = true
    ) then 'finance'
    else 'employee'
  end as deleted_by_role,
  u.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(both from u.full_name), '') is not null and nullif(trim(both from u.email), '') is not null then trim(both from u.full_name) || ' (' || trim(both from u.email) || ')'
    when nullif(trim(both from u.full_name), '') is not null then trim(both from u.full_name)
    when nullif(trim(both from u.email), '') is not null then trim(both from u.email)
    else c.employee_id
  end as submitter_label,
  case
    when c.detail_type = 'expense' then coalesce(nullif(trim(both from mec_name.name), ''), 'Uncategorized')
    else 'Advance'
  end as category_name,
  coalesce(ed.purpose, ad.purpose) as purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path,
  c.bc_claim_details_id,
  coalesce(bcd.is_vendor_payment, false) as is_vendor_payment
from public.claims c
left join public.users u on u.id = c.submitted_by
left join public.users beneficiary on beneficiary.id = c.on_behalf_of_id
left join public.users hod on hod.id = c.assigned_l1_approver_id
left join public.users finance on finance.id = c.assigned_l2_approver_id
left join public.users deleted_by_user on deleted_by_user.id = c.deleted_by
left join public.master_departments md on md.id = c.department_id
left join public.master_payment_modes mpm on mpm.id = c.payment_mode_id
left join public.expense_details ed on ed.claim_id = c.id
left join public.master_expense_categories mec_name on mec_name.id = ed.expense_category_id
left join public.advance_details ad on ad.claim_id = c.id
left join public.bc_claim_details bcd on bcd.claim_id = c.id;


drop view if exists public.vw_enterprise_claims_dashboard;

create view public.vw_enterprise_claims_dashboard
with (security_invoker = 'on') as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(both from u.full_name), ''),
    nullif(trim(both from split_part(u.email, '@', 1)), ''),
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_employee_code), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    nullif(trim(both from u.email), ''),
    'N/A'
  ) as employee_id,
  c.employee_id as claim_employee_id_raw,
  c.on_behalf_employee_code as on_behalf_employee_code_raw,
  nullif(trim(both from u.full_name), '') as submitter_name_raw,
  nullif(trim(both from beneficiary.full_name), '') as beneficiary_name_raw,
  coalesce(nullif(trim(both from md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(both from mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(
    ed.approved_amount,
    ed.requested_total_amount,
    ad.approved_amount,
    ad.requested_total_amount,
    0
  )::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is null then c.updated_at
      else null::timestamp with time zone
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status = any(array[
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ]) then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is not null then c.updated_at
      else null::timestamp with time zone
    end
  ) as finance_action_date,
  coalesce(ed.location_id, ad.location_id) as location_id,
  coalesce(ed.product_id, ad.product_id) as product_id,
  ed.expense_category_id,
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
  u.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(both from u.full_name), '') is not null and nullif(trim(both from u.email), '') is not null then trim(both from u.full_name) || ' (' || trim(both from u.email) || ')'
    when nullif(trim(both from u.full_name), '') is not null then trim(both from u.full_name)
    when nullif(trim(both from u.email), '') is not null then trim(both from u.email)
    else c.employee_id
  end as submitter_label,
  case
    when c.detail_type = 'expense' then coalesce(nullif(trim(both from mec_name.name), ''), 'Uncategorized')
    else 'Advance'
  end as category_name,
  coalesce(ed.purpose, ad.purpose) as purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path,
  c.bc_claim_details_id,
  coalesce(bcd.is_vendor_payment, false) as is_vendor_payment
from public.claims c
left join public.users u on u.id = c.submitted_by
left join public.users beneficiary on beneficiary.id = c.on_behalf_of_id
left join public.users hod on hod.id = c.assigned_l1_approver_id
left join public.users finance on finance.id = c.assigned_l2_approver_id
left join public.master_departments md on md.id = c.department_id
left join public.master_payment_modes mpm on mpm.id = c.payment_mode_id
left join public.expense_details ed on ed.claim_id = c.id and ed.is_active = true
left join public.master_expense_categories mec_name on mec_name.id = ed.expense_category_id
left join public.advance_details ad on ad.claim_id = c.id and ad.is_active = true
left join public.bc_claim_details bcd on bcd.claim_id = c.id
where c.is_active = true;