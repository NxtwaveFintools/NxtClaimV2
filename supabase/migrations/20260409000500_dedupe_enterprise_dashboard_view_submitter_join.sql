-- Performance: Remove duplicate submitter join in enterprise dashboard view.
-- Existing view joined public.users twice on submitted_by. This migration removes
-- the duplicate join and keeps output columns unchanged.

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
  u.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(u.full_name), '') is not null and nullif(trim(u.email), '') is not null
      then trim(u.full_name) || ' (' || trim(u.email) || ')'
    when nullif(trim(u.full_name), '') is not null
      then trim(u.full_name)
    when nullif(trim(u.email), '') is not null
      then trim(u.email)
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
