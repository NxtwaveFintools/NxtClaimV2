-- Convert claims.submission_type from text → enum so the vocabulary is
-- schema-enforced (TypeScript types narrow to "Self" | "On Behalf"), and
-- fix get_bc_claim_payload to compare against the correct literal.
--
-- Pre-migration audit (verified 2026-05-19):
--   distinct values in 4,529 rows: only 'Self' (3,400) and 'On Behalf' (1,129)
--   no NULLs, no whitespace anomalies, no indexes on submission_type
--   views referencing the column: vw_admin_claims_dashboard, vw_enterprise_claims_dashboard
--   CHECK constraints: claims_submission_type_check (simple IN), claims_on_behalf_fields (cross-field)
--   only get_bc_claim_payload uses the wrong 'On_behalf' literal

BEGIN;

-- 1. Drop dependent views (must drop before ALTER COLUMN TYPE).
DROP VIEW public.vw_admin_claims_dashboard;
DROP VIEW public.vw_enterprise_claims_dashboard;

-- 2. Drop CHECK constraints (will recreate with enum-aware comparisons).
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_submission_type_check;
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_on_behalf_fields;

-- 3. Create enum type.
CREATE TYPE public.claim_submission_type AS ENUM ('Self', 'On Behalf');

-- 4. Alter column type. Cast via text to enum; rows already match enum members.
ALTER TABLE public.claims
  ALTER COLUMN submission_type TYPE public.claim_submission_type
  USING submission_type::text::public.claim_submission_type;

-- 5. Recreate cross-field check using the enum.
ALTER TABLE public.claims ADD CONSTRAINT claims_on_behalf_fields CHECK (
  (
    submission_type = 'Self'::claim_submission_type
    AND COALESCE(on_behalf_email, 'N/A') = 'N/A'
    AND COALESCE(on_behalf_employee_code, 'N/A') = 'N/A'
    AND on_behalf_of_id = submitted_by
  )
  OR
  (
    submission_type = 'On Behalf'::claim_submission_type
    AND COALESCE(on_behalf_email, 'N/A') <> 'N/A'
    AND COALESCE(on_behalf_employee_code, 'N/A') <> 'N/A'
    AND on_behalf_of_id IS NOT NULL
  )
);

-- 6. Recreate vw_admin_claims_dashboard (definition captured verbatim from pg_get_viewdef(); security_invoker added explicitly because pg_get_viewdef() does not emit view options).
CREATE VIEW public.vw_admin_claims_dashboard WITH (security_invoker = 'on') AS
 SELECT c.id AS claim_id,
    COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''::text), NULLIF(TRIM(BOTH FROM split_part(u.email, '@'::text, 1)), ''::text), NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), 'N/A'::text) AS employee_name,
    COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), NULLIF(TRIM(BOTH FROM u.email), ''::text), 'N/A'::text) AS employee_id,
    c.employee_id AS claim_employee_id_raw,
    c.on_behalf_employee_code AS on_behalf_employee_code_raw,
    NULLIF(TRIM(BOTH FROM u.full_name), ''::text) AS submitter_name_raw,
    NULLIF(TRIM(BOTH FROM beneficiary.full_name), ''::text) AS beneficiary_name_raw,
    COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''::text), 'Unknown Department'::text) AS department_name,
    COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''::text),
        CASE
            WHEN c.detail_type = 'advance'::text THEN 'Advance'::text
            WHEN c.detail_type = 'expense'::text THEN 'Expense'::text
            ELSE 'Unknown'::text
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
    NULLIF(TRIM(BOTH FROM deleted_by_user.full_name), ''::text) AS deleted_by_name,
        CASE
            WHEN c.deleted_by IS NULL THEN NULL::text
            WHEN (EXISTS ( SELECT 1
               FROM admins a
              WHERE a.user_id = c.deleted_by)) THEN 'admin'::text
            WHEN (EXISTS ( SELECT 1
               FROM master_finance_approvers f
              WHERE f.user_id = c.deleted_by AND f.is_active = true)) THEN 'finance'::text
            ELSE 'employee'::text
        END AS deleted_by_role,
    u.email AS submitter_email,
    hod.email AS hod_email,
    finance.email AS finance_email,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN ((TRIM(BOTH FROM u.full_name) || ' ('::text) || TRIM(BOTH FROM u.email)) || ')'::text
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.full_name)
            WHEN NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.email)
            ELSE c.employee_id
        END AS submitter_label,
        CASE
            WHEN c.detail_type = 'expense'::text THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''::text), 'Uncategorized'::text)
            ELSE 'Advance'::text
        END AS category_name,
    COALESCE(ed.purpose, ad.purpose) AS purpose,
    ed.receipt_file_path,
    ed.bank_statement_file_path,
    ad.supporting_document_path,
    c.bc_claim_details_id,
    COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment
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
     LEFT JOIN bc_claim_details bcd ON bcd.claim_id = c.id;

-- 7. Recreate vw_enterprise_claims_dashboard (definition captured verbatim from pg_get_viewdef(); security_invoker added explicitly because pg_get_viewdef() does not emit view options).
CREATE VIEW public.vw_enterprise_claims_dashboard WITH (security_invoker = 'on') AS
 SELECT c.id AS claim_id,
    COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''::text), NULLIF(TRIM(BOTH FROM split_part(u.email, '@'::text, 1)), ''::text), NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), 'N/A'::text) AS employee_name,
    COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), NULLIF(TRIM(BOTH FROM u.email), ''::text), 'N/A'::text) AS employee_id,
    c.employee_id AS claim_employee_id_raw,
    c.on_behalf_employee_code AS on_behalf_employee_code_raw,
    NULLIF(TRIM(BOTH FROM u.full_name), ''::text) AS submitter_name_raw,
    NULLIF(TRIM(BOTH FROM beneficiary.full_name), ''::text) AS beneficiary_name_raw,
    COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''::text), 'Unknown Department'::text) AS department_name,
    COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''::text),
        CASE
            WHEN c.detail_type = 'advance'::text THEN 'Advance'::text
            WHEN c.detail_type = 'expense'::text THEN 'Expense'::text
            ELSE 'Unknown'::text
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
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN ((TRIM(BOTH FROM u.full_name) || ' ('::text) || TRIM(BOTH FROM u.email)) || ')'::text
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.full_name)
            WHEN NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.email)
            ELSE c.employee_id
        END AS submitter_label,
        CASE
            WHEN c.detail_type = 'expense'::text THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''::text), 'Uncategorized'::text)
            ELSE 'Advance'::text
        END AS category_name,
    COALESCE(ed.purpose, ad.purpose) AS purpose,
    ed.receipt_file_path,
    ed.bank_statement_file_path,
    ad.supporting_document_path,
    c.bc_claim_details_id,
    COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment
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
     LEFT JOIN bc_claim_details bcd ON bcd.claim_id = c.id
  WHERE c.is_active = true;

-- 8. Recreate get_bc_claim_payload using the corrected literal.
--    All other parts of the function body are unchanged from migration 20260519140000.
CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_already_submitted_id UUID;
  v_payment_mode_name    TEXT;
  v_result               JSONB;
BEGIN
  SELECT c.bc_claim_details_id, mpm.name
    INTO v_already_submitted_id, v_payment_mode_name
  FROM public.claims c
  JOIN public.master_payment_modes mpm ON mpm.id = c.payment_mode_id
  WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: %', p_claim_id USING ERRCODE = 'P0001';
  END IF;

  IF v_already_submitted_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: %', v_already_submitted_id USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object(
    'claim_id',                     c.id,
    'payment_mode_name',            v_payment_mode_name,
    'submission_type',              c.submission_type,
    'employee_id',                  c.employee_id,
    'on_behalf_employee_code',      c.on_behalf_employee_code,
    'employee_name',
      CASE WHEN c.submission_type = 'On Behalf'::claim_submission_type
           THEN COALESCE(onbehalf.full_name, '')
           ELSE COALESCE(submitter.full_name, '')
      END,
    'program_code',                 ppm.program_code,
    'sub_product_code',             spm.sub_product_code,
    'responsible_department_code',  drm.responsible_department_code,
    'beneficiary_department_code',  drm.beneficiary_department_code,
    'region_code',                  elm.region_code,
    'bill_no',                      ed.bill_no,
    'transaction_date',             ed.transaction_date,
    'purpose',                      ed.purpose,
    'receipt_file_path',            ed.receipt_file_path,
    'bank_statement_file_path',     ed.bank_statement_file_path,
    'bc_code',                      ecm.bc_code,
    'basic_amount',                 ed.basic_amount,
    'total_amount',                 ed.total_amount,
    'foreign_basic_amount',         COALESCE(ed.foreign_basic_amount, 0),
    'foreign_total_amount',         COALESCE(ed.foreign_total_amount, 0)
  )
  INTO v_result
  FROM public.claims c
  JOIN public.expense_details ed                    ON ed.claim_id = c.id AND ed.is_active = true
  JOIN public.users submitter                       ON submitter.id = c.submitted_by
  LEFT JOIN public.users onbehalf                   ON onbehalf.id = c.on_behalf_of_id
  JOIN public.expense_category_bc_mappings ecm      ON ecm.expense_category_id = ed.expense_category_id AND ecm.is_active = true
  JOIN LATERAL (
    SELECT program_code FROM public.master_program_product_mappings
    WHERE product_id = ed.product_id AND is_active = true LIMIT 1
  ) ppm ON true
  JOIN LATERAL (
    SELECT sub_product_code FROM public.master_sub_product_mappings
    WHERE product_id = ed.product_id AND is_active = true LIMIT 1
  ) spm ON true
  JOIN LATERAL (
    SELECT responsible_department_code, beneficiary_department_code
    FROM public.master_department_responsible_mappings
    WHERE department_id = c.department_id AND is_active = true LIMIT 1
  ) drm ON true
  JOIN LATERAL (
    SELECT region_code FROM public.master_expense_location_mappings
    WHERE location_id = ed.location_id AND is_active = true LIMIT 1
  ) elm ON true
  WHERE c.id = p_claim_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'MISSING_MAPPING: one or more required mappings missing for claim %', p_claim_id
      USING ERRCODE = 'P0003';
  END IF;

  RETURN v_result;
END;
$$;

COMMIT;
