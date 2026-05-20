-- Corrective migration for PR #120 review: search_path baked in + status gate + grants.
CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_already_submitted_id UUID;
  v_payment_mode_name    TEXT;
  v_status               public.claim_status;
  v_result               JSONB;
BEGIN
  SELECT c.bc_claim_details_id, mpm.name, c.status
    INTO v_already_submitted_id, v_payment_mode_name, v_status
  FROM public.claims c
  JOIN public.master_payment_modes mpm ON mpm.id = c.payment_mode_id
  WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: %', p_claim_id USING ERRCODE = 'P0001';
  END IF;

  IF v_already_submitted_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: %', v_already_submitted_id USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'HOD approved - Awaiting finance approval'::public.claim_status THEN
    RAISE EXCEPTION 'INVALID_CLAIM_STATE: % is %', p_claim_id, v_status
      USING ERRCODE = 'P0005';
  END IF;

  SELECT jsonb_build_object(
    'claim_id',                     c.id,
    'payment_mode_name',            v_payment_mode_name,
    'submission_type',              c.submission_type,
    'employee_id',                  c.employee_id,
    'on_behalf_employee_code',      c.on_behalf_employee_code,
    'employee_name',
      CASE WHEN c.submission_type = 'On Behalf'::public.claim_submission_type
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

CREATE OR REPLACE FUNCTION public.start_bc_claim_attempt(
  p_claim_id          TEXT,
  p_is_vendor_payment BOOLEAN,
  p_payload_json      JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bc_details_id UUID;
BEGIN
  INSERT INTO public.bc_claim_details
    (claim_id, is_vendor_payment, bc_status, bc_payload_json, bc_response_json)
  VALUES
    (p_claim_id, p_is_vendor_payment, 'submitting', p_payload_json, NULL)
  RETURNING id INTO v_bc_details_id;

  RETURN v_bc_details_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_bc_claim(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim_id TEXT;
BEGIN
  UPDATE public.bc_claim_details
  SET    bc_status        = 'success',
         bc_response_json = p_response_json
  WHERE  id        = p_bc_details_id
    AND  bc_status = 'submitting'
  RETURNING claim_id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'BC_DETAILS_NOT_IN_FLIGHT: %', p_bc_details_id USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.claims
  SET    bc_claim_details_id = p_bc_details_id,
         status              = 'Finance Approved - Payment under process',
         updated_at          = now()
  WHERE  id = v_claim_id;

  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
  VALUES (v_claim_id, p_actor_user_id, 'BC_SUBMITTED',
          'bc_claim_details_id: ' || p_bc_details_id::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_bc_claim_failure(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim_id TEXT;
BEGIN
  UPDATE public.bc_claim_details
  SET    bc_status        = 'failed',
         bc_response_json = p_response_json
  WHERE  id        = p_bc_details_id
    AND  bc_status = 'submitting'
  RETURNING claim_id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'BC_DETAILS_NOT_IN_FLIGHT: %', p_bc_details_id USING ERRCODE = 'P0004';
  END IF;

  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
  VALUES (v_claim_id, p_actor_user_id, 'BC_SUBMISSION_FAILED',
          'bc_claim_details_id: ' || p_bc_details_id::text);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_bc_claim_payload(TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_bc_claim_attempt(TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_bc_claim(UUID, UUID, JSONB)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_bc_claim_failure(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_bc_claim_payload(TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION public.start_bc_claim_attempt(TEXT, BOOLEAN, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_bc_claim(UUID, UUID, JSONB)     TO service_role;
GRANT EXECUTE ON FUNCTION public.record_bc_claim_failure(UUID, UUID, JSONB) TO service_role;;