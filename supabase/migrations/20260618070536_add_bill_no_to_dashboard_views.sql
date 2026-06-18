-- Migration: add bill_no to vw_enterprise_claims_dashboard and vw_admin_claims_dashboard
-- bill_no comes from expense_details (already joined); NULL for advance claims.

-- ============================================================
-- UP
-- ============================================================

CREATE OR REPLACE VIEW public.vw_enterprise_claims_dashboard AS
SELECT
  c.id AS claim_id,
  COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''), NULLIF(TRIM(BOTH FROM split_part(u.email, '@', 1)), ''), NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), 'N/A') AS employee_name,
  COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), NULLIF(TRIM(BOTH FROM u.email), ''), 'N/A') AS employee_id,
  c.employee_id AS claim_employee_id_raw,
  c.on_behalf_employee_code AS on_behalf_employee_code_raw,
  NULLIF(TRIM(BOTH FROM u.full_name), '') AS submitter_name_raw,
  NULLIF(TRIM(BOTH FROM beneficiary.full_name), '') AS beneficiary_name_raw,
  COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''), 'Unknown Department') AS department_name,
  COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''),
    CASE
      WHEN c.detail_type = 'advance' THEN 'Advance'
      WHEN c.detail_type = 'expense' THEN 'Expense'
      ELSE 'Unknown'
    END) AS type_of_claim,
  COALESCE(ed.total_amount, ad.total_amount, 0::numeric)::numeric(14,2) AS amount,
  c.status,
  COALESCE(c.submitted_at, c.created_at) AS submitted_on,
  COALESCE(c.hod_action_at,
    CASE
      WHEN c.status = 'HOD approved - Awaiting finance approval'::claim_status THEN c.updated_at
      WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at
      ELSE NULL::timestamp with time zone
    END) AS hod_action_date,
  COALESCE(c.finance_action_at,
    CASE
      WHEN c.status = ANY (ARRAY['Finance Approved - Payment under process'::claim_status, 'Payment Done - Closed'::claim_status]) THEN c.updated_at
      WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at
      ELSE NULL::timestamp with time zone
    END) AS finance_action_date,
  COALESCE(ed.location_id, ad.location_id) AS location_id,
  COALESCE(ed.product_id, ad.product_id) AS product_id,
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
  u.email AS submitter_email,
  hod.email AS hod_email,
  finance.email AS finance_email,
  CASE
    WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN (TRIM(BOTH FROM u.full_name) || ' (' || TRIM(BOTH FROM u.email) || ')')
    WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL THEN TRIM(BOTH FROM u.full_name)
    WHEN NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN TRIM(BOTH FROM u.email)
    ELSE c.employee_id
  END AS submitter_label,
  CASE
    WHEN c.detail_type = 'expense' THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''), 'Uncategorized')
    ELSE 'Advance'
  END AS category_name,
  COALESCE(ed.purpose, ad.purpose) AS purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path,
  c.bc_claim_details_id,
  COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment,
  ed.bill_no
FROM claims c
  LEFT JOIN users u ON u.id = c.submitted_by
  LEFT JOIN users beneficiary ON beneficiary.id = c.on_behalf_of_id
  LEFT JOIN users hod ON hod.id = c.assigned_l1_approver_id
  LEFT JOIN users finance ON finance.id = c.assigned_l2_approver_id
  LEFT JOIN master_departments md ON md.id = c.department_id
  LEFT JOIN master_payment_modes mpm ON mpm.id = c.payment_mode_id
  LEFT JOIN expense_details ed ON ed.claim_id = c.id AND ed.is_active = true
  LEFT JOIN master_expense_categories mec_name ON mec_name.id = ed.expense_category_id
  LEFT JOIN advance_details ad ON ad.claim_id = c.id AND ad.is_active = true
  LEFT JOIN bc_claim_details bcd ON bcd.id = c.bc_claim_details_id
WHERE c.is_active = true;


CREATE OR REPLACE VIEW public.vw_admin_claims_dashboard AS
SELECT
  c.id AS claim_id,
  COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''), NULLIF(TRIM(BOTH FROM split_part(u.email, '@', 1)), ''), NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), 'N/A') AS employee_name,
  COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), NULLIF(TRIM(BOTH FROM u.email), ''), 'N/A') AS employee_id,
  c.employee_id AS claim_employee_id_raw,
  c.on_behalf_employee_code AS on_behalf_employee_code_raw,
  NULLIF(TRIM(BOTH FROM u.full_name), '') AS submitter_name_raw,
  NULLIF(TRIM(BOTH FROM beneficiary.full_name), '') AS beneficiary_name_raw,
  COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''), 'Unknown Department') AS department_name,
  COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''),
    CASE
      WHEN c.detail_type = 'advance' THEN 'Advance'
      WHEN c.detail_type = 'expense' THEN 'Expense'
      ELSE 'Unknown'
    END) AS type_of_claim,
  COALESCE(ed.total_amount, ad.total_amount, 0::numeric)::numeric(14,2) AS amount,
  c.status,
  COALESCE(c.submitted_at, c.created_at) AS submitted_on,
  COALESCE(c.hod_action_at,
    CASE
      WHEN c.status = 'HOD approved - Awaiting finance approval'::claim_status THEN c.updated_at
      WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at
      ELSE NULL::timestamp with time zone
    END) AS hod_action_date,
  COALESCE(c.finance_action_at,
    CASE
      WHEN c.status = ANY (ARRAY['Finance Approved - Payment under process'::claim_status, 'Payment Done - Closed'::claim_status]) THEN c.updated_at
      WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at
      ELSE NULL::timestamp with time zone
    END) AS finance_action_date,
  COALESCE(ed.location_id, ad.location_id) AS location_id,
  COALESCE(ed.product_id, ad.product_id) AS product_id,
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
  NULLIF(TRIM(BOTH FROM deleted_by_user.full_name), '') AS deleted_by_name,
  CASE
    WHEN c.deleted_by IS NULL THEN NULL::text
    WHEN (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = c.deleted_by)) THEN 'admin'
    WHEN (EXISTS (SELECT 1 FROM master_finance_approvers f WHERE f.user_id = c.deleted_by AND f.is_active = true)) THEN 'finance'
    ELSE 'employee'
  END AS deleted_by_role,
  u.email AS submitter_email,
  hod.email AS hod_email,
  finance.email AS finance_email,
  CASE
    WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN (TRIM(BOTH FROM u.full_name) || ' (' || TRIM(BOTH FROM u.email) || ')')
    WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL THEN TRIM(BOTH FROM u.full_name)
    WHEN NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN TRIM(BOTH FROM u.email)
    ELSE c.employee_id
  END AS submitter_label,
  CASE
    WHEN c.detail_type = 'expense' THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''), 'Uncategorized')
    ELSE 'Advance'
  END AS category_name,
  COALESCE(ed.purpose, ad.purpose) AS purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path,
  c.bc_claim_details_id,
  COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment,
  ed.bill_no
FROM claims c
  LEFT JOIN users u ON u.id = c.submitted_by
  LEFT JOIN users beneficiary ON beneficiary.id = c.on_behalf_of_id
  LEFT JOIN users hod ON hod.id = c.assigned_l1_approver_id
  LEFT JOIN users finance ON finance.id = c.assigned_l2_approver_id
  LEFT JOIN users deleted_by_user ON deleted_by_user.id = c.deleted_by
  LEFT JOIN master_departments md ON md.id = c.department_id
  LEFT JOIN master_payment_modes mpm ON mpm.id = c.payment_mode_id
  LEFT JOIN expense_details ed ON ed.claim_id = c.id
  LEFT JOIN master_expense_categories mec_name ON mec_name.id = ed.expense_category_id
  LEFT JOIN advance_details ad ON ad.claim_id = c.id
  LEFT JOIN bc_claim_details bcd ON bcd.id = c.bc_claim_details_id;


-- ============================================================
-- DOWN (rollback) — restore both views to their pre-migration state
-- ============================================================

-- To roll back, run this block manually:
--
-- CREATE OR REPLACE VIEW public.vw_enterprise_claims_dashboard AS
-- SELECT
--   c.id AS claim_id,
--   COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''), NULLIF(TRIM(BOTH FROM split_part(u.email, '@', 1)), ''), NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), 'N/A') AS employee_name,
--   COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), NULLIF(TRIM(BOTH FROM u.email), ''), 'N/A') AS employee_id,
--   c.employee_id AS claim_employee_id_raw,
--   c.on_behalf_employee_code AS on_behalf_employee_code_raw,
--   NULLIF(TRIM(BOTH FROM u.full_name), '') AS submitter_name_raw,
--   NULLIF(TRIM(BOTH FROM beneficiary.full_name), '') AS beneficiary_name_raw,
--   COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''), 'Unknown Department') AS department_name,
--   COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''),
--     CASE WHEN c.detail_type = 'advance' THEN 'Advance' WHEN c.detail_type = 'expense' THEN 'Expense' ELSE 'Unknown' END) AS type_of_claim,
--   COALESCE(ed.total_amount, ad.total_amount, 0::numeric)::numeric(14,2) AS amount,
--   c.status,
--   COALESCE(c.submitted_at, c.created_at) AS submitted_on,
--   COALESCE(c.hod_action_at, CASE WHEN c.status = 'HOD approved - Awaiting finance approval'::claim_status THEN c.updated_at WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at ELSE NULL::timestamp with time zone END) AS hod_action_date,
--   COALESCE(c.finance_action_at, CASE WHEN c.status = ANY (ARRAY['Finance Approved - Payment under process'::claim_status, 'Payment Done - Closed'::claim_status]) THEN c.updated_at WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at ELSE NULL::timestamp with time zone END) AS finance_action_date,
--   COALESCE(ed.location_id, ad.location_id) AS location_id,
--   COALESCE(ed.product_id, ad.product_id) AS product_id,
--   ed.expense_category_id,
--   c.submitted_by, c.on_behalf_of_id, c.on_behalf_email,
--   c.assigned_l1_approver_id, c.assigned_l2_approver_id,
--   c.department_id, c.payment_mode_id, c.detail_type, c.submission_type,
--   c.is_active, c.created_at, c.updated_at,
--   u.email AS submitter_email, hod.email AS hod_email, finance.email AS finance_email,
--   CASE WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN (TRIM(BOTH FROM u.full_name) || ' (' || TRIM(BOTH FROM u.email) || ')') WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL THEN TRIM(BOTH FROM u.full_name) WHEN NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN TRIM(BOTH FROM u.email) ELSE c.employee_id END AS submitter_label,
--   CASE WHEN c.detail_type = 'expense' THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''), 'Uncategorized') ELSE 'Advance' END AS category_name,
--   COALESCE(ed.purpose, ad.purpose) AS purpose,
--   ed.receipt_file_path, ed.bank_statement_file_path, ad.supporting_document_path,
--   c.bc_claim_details_id, COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment
-- FROM claims c
--   LEFT JOIN users u ON u.id = c.submitted_by
--   LEFT JOIN users beneficiary ON beneficiary.id = c.on_behalf_of_id
--   LEFT JOIN users hod ON hod.id = c.assigned_l1_approver_id
--   LEFT JOIN users finance ON finance.id = c.assigned_l2_approver_id
--   LEFT JOIN master_departments md ON md.id = c.department_id
--   LEFT JOIN master_payment_modes mpm ON mpm.id = c.payment_mode_id
--   LEFT JOIN expense_details ed ON ed.claim_id = c.id AND ed.is_active = true
--   LEFT JOIN master_expense_categories mec_name ON mec_name.id = ed.expense_category_id
--   LEFT JOIN advance_details ad ON ad.claim_id = c.id AND ad.is_active = true
--   LEFT JOIN bc_claim_details bcd ON bcd.id = c.bc_claim_details_id
-- WHERE c.is_active = true;
--
-- CREATE OR REPLACE VIEW public.vw_admin_claims_dashboard AS
-- SELECT
--   c.id AS claim_id,
--   COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''), NULLIF(TRIM(BOTH FROM split_part(u.email, '@', 1)), ''), NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), 'N/A') AS employee_name,
--   COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''), NULLIF(TRIM(BOTH FROM u.email), ''), 'N/A') AS employee_id,
--   c.employee_id AS claim_employee_id_raw,
--   c.on_behalf_employee_code AS on_behalf_employee_code_raw,
--   NULLIF(TRIM(BOTH FROM u.full_name), '') AS submitter_name_raw,
--   NULLIF(TRIM(BOTH FROM beneficiary.full_name), '') AS beneficiary_name_raw,
--   COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''), 'Unknown Department') AS department_name,
--   COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''),
--     CASE WHEN c.detail_type = 'advance' THEN 'Advance' WHEN c.detail_type = 'expense' THEN 'Expense' ELSE 'Unknown' END) AS type_of_claim,
--   COALESCE(ed.total_amount, ad.total_amount, 0::numeric)::numeric(14,2) AS amount,
--   c.status,
--   COALESCE(c.submitted_at, c.created_at) AS submitted_on,
--   COALESCE(c.hod_action_at, CASE WHEN c.status = 'HOD approved - Awaiting finance approval'::claim_status THEN c.updated_at WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at ELSE NULL::timestamp with time zone END) AS hod_action_date,
--   COALESCE(c.finance_action_at, CASE WHEN c.status = ANY (ARRAY['Finance Approved - Payment under process'::claim_status, 'Payment Done - Closed'::claim_status]) THEN c.updated_at WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at ELSE NULL::timestamp with time zone END) AS finance_action_date,
--   COALESCE(ed.location_id, ad.location_id) AS location_id,
--   COALESCE(ed.product_id, ad.product_id) AS product_id,
--   ed.expense_category_id,
--   c.submitted_by, c.on_behalf_of_id, c.on_behalf_email,
--   c.assigned_l1_approver_id, c.assigned_l2_approver_id,
--   c.department_id, c.payment_mode_id, c.detail_type, c.submission_type,
--   c.is_active, c.created_at, c.updated_at,
--   c.deleted_by, c.deleted_at,
--   NULLIF(TRIM(BOTH FROM deleted_by_user.full_name), '') AS deleted_by_name,
--   CASE WHEN c.deleted_by IS NULL THEN NULL::text WHEN (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = c.deleted_by)) THEN 'admin' WHEN (EXISTS (SELECT 1 FROM master_finance_approvers f WHERE f.user_id = c.deleted_by AND f.is_active = true)) THEN 'finance' ELSE 'employee' END AS deleted_by_role,
--   u.email AS submitter_email, hod.email AS hod_email, finance.email AS finance_email,
--   CASE WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN (TRIM(BOTH FROM u.full_name) || ' (' || TRIM(BOTH FROM u.email) || ')') WHEN NULLIF(TRIM(BOTH FROM u.full_name), '') IS NOT NULL THEN TRIM(BOTH FROM u.full_name) WHEN NULLIF(TRIM(BOTH FROM u.email), '') IS NOT NULL THEN TRIM(BOTH FROM u.email) ELSE c.employee_id END AS submitter_label,
--   CASE WHEN c.detail_type = 'expense' THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''), 'Uncategorized') ELSE 'Advance' END AS category_name,
--   COALESCE(ed.purpose, ad.purpose) AS purpose,
--   ed.receipt_file_path, ed.bank_statement_file_path, ad.supporting_document_path,
--   c.bc_claim_details_id, COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment
-- FROM claims c
--   LEFT JOIN users u ON u.id = c.submitted_by
--   LEFT JOIN users beneficiary ON beneficiary.id = c.on_behalf_of_id
--   LEFT JOIN users hod ON hod.id = c.assigned_l1_approver_id
--   LEFT JOIN users finance ON finance.id = c.assigned_l2_approver_id
--   LEFT JOIN users deleted_by_user ON deleted_by_user.id = c.deleted_by
--   LEFT JOIN master_departments md ON md.id = c.department_id
--   LEFT JOIN master_payment_modes mpm ON mpm.id = c.payment_mode_id
--   LEFT JOIN expense_details ed ON ed.claim_id = c.id
--   LEFT JOIN master_expense_categories mec_name ON mec_name.id = ed.expense_category_id
--   LEFT JOIN advance_details ad ON ad.claim_id = c.id
--   LEFT JOIN bc_claim_details bcd ON bcd.id = c.bc_claim_details_id;