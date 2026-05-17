BEGIN;

CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_claim                RECORD;
  v_expense              RECORD;
  v_payment_mode_name    TEXT;
  v_bc_code              TEXT;
  v_program_code         TEXT;
  v_sub_product_code     TEXT;
  v_responsible_dept     TEXT;
  v_beneficiary_dept     TEXT;
  v_region_code          TEXT;
BEGIN
  SELECT c.id, c.employee_id, c.department_id, c.payment_mode_id,
         c.bc_payments_flag, c.is_active
    INTO v_claim
    FROM public.claims c
   WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CLAIM_NOT_FOUND', 'claim_id', p_claim_id);
  END IF;

  SELECT name INTO v_payment_mode_name
    FROM public.master_payment_modes
   WHERE id = v_claim.payment_mode_id;

  IF lower(trim(coalesce(v_payment_mode_name, ''))) NOT IN (
       'reimbursement', 'corporate card', 'happay', 'forex', 'petty cash'
     ) THEN
    RETURN jsonb_build_object('error', 'NOT_EXPENSE_MODE',
                              'payment_mode', coalesce(v_payment_mode_name, '<null>'));
  END IF;

  SELECT ed.purpose, ed.receipt_file_path, ed.bank_statement_file_path,
         ed.approved_amount, ed.expense_category_id, ed.product_id, ed.location_id
    INTO v_expense
    FROM public.expense_details ed
   WHERE ed.claim_id = p_claim_id AND ed.is_active = true
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'EXPENSE_DETAILS_MISSING', 'claim_id', p_claim_id);
  END IF;

  SELECT bc_code INTO v_bc_code
    FROM public.expense_category_bc_mappings
   WHERE expense_category_id = v_expense.expense_category_id AND is_active = true
   LIMIT 1;
  -- bc_code may be NULL here; non-vendor flow errors at the Edge Function, vendor flow allows it.

  SELECT program_code INTO v_program_code
    FROM public.master_program_product_mappings
   WHERE product_id = v_expense.product_id AND is_active = true
   LIMIT 1;
  IF v_program_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'nwProgramCode',
                              'product_id', v_expense.product_id);
  END IF;

  SELECT sub_product_code INTO v_sub_product_code
    FROM public.master_sub_product_mappings
   WHERE product_id = v_expense.product_id AND is_active = true
   LIMIT 1;
  IF v_sub_product_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'subProductCode',
                              'product_id', v_expense.product_id);
  END IF;

  SELECT responsible_department_code, beneficiary_department_code
    INTO v_responsible_dept, v_beneficiary_dept
    FROM public.master_department_responsible_mappings
   WHERE department_id = v_claim.department_id AND is_active = true
   LIMIT 1;
  IF v_responsible_dept IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'responsibleDepartment',
                              'department_id', v_claim.department_id);
  END IF;

  SELECT region_code INTO v_region_code
    FROM public.master_expense_location_mappings
   WHERE location_id = v_expense.location_id AND is_active = true
   LIMIT 1;
  IF v_region_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'regionCode',
                              'location_id', v_expense.location_id);
  END IF;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'employee_id', v_claim.employee_id,
    'bc_payments_flag', v_claim.bc_payments_flag,
    'approved_amount', v_expense.approved_amount,
    'purpose', v_expense.purpose,
    'receipt_file_path', v_expense.receipt_file_path,
    'bank_statement_file_path', v_expense.bank_statement_file_path,
    'expense_category_id', v_expense.expense_category_id,
    'bc_code', v_bc_code,
    'program_code', v_program_code,
    'sub_product_code', v_sub_product_code,
    'responsible_department_code', v_responsible_dept,
    'beneficiary_department_code', v_beneficiary_dept,
    'region_code', v_region_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bc_claim_payload(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_bc_claim_payload(TEXT) IS
$comment$
Returns one of the following JSONB shapes for the given claim_id:

Success: {
  claim_id, employee_id, bc_payments_flag, approved_amount, purpose,
  receipt_file_path, bank_statement_file_path, expense_category_id,
  bc_code, program_code, sub_product_code,
  responsible_department_code, beneficiary_department_code, region_code
}

Error variants:
  { error: 'CLAIM_NOT_FOUND', claim_id }
  { error: 'NOT_EXPENSE_MODE', payment_mode }
  { error: 'EXPENSE_DETAILS_MISSING', claim_id }
  { error: 'MISSING_MAPPING', field: 'nwProgramCode',         product_id }
  { error: 'MISSING_MAPPING', field: 'subProductCode',        product_id }
  { error: 'MISSING_MAPPING', field: 'responsibleDepartment', department_id }
  { error: 'MISSING_MAPPING', field: 'regionCode',            location_id }

Eligible payment modes (expense modes only):
  reimbursement, corporate card, happay, forex, petty cash

bc_code may be null in success output; non-vendor flow rejects null
bc_code at the Edge Function, vendor flow ignores it.
$comment$;

COMMIT;