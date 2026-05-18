-- Three-phase BC claim lifecycle functions + rewritten get_bc_claim_payload.
-- See spec docs/superpowers/specs/2026-05-16-bc-payload-expansion-design.md §1.2 and §3.3.

-- 0. Drop the old payment-era function (signature: TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB).
DROP FUNCTION IF EXISTS public.complete_bc_payment(TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB);

-- 1. start_bc_claim_attempt — claims the in-flight slot (status='submitting') BEFORE the BC POST.
--    Concurrent submissions hit the partial UNIQUE on (claim_id) WHERE bc_status IN
--    ('submitting','success') and get unique_violation. This is the canonical concurrency guard.
CREATE OR REPLACE FUNCTION public.start_bc_claim_attempt(
  p_claim_id          TEXT,
  p_is_vendor_payment BOOLEAN,
  p_payload_json      JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 2. complete_bc_claim — flips 'submitting' → 'success' after BC accepted; updates claim FK + status;
--    writes claim_audit_logs entry. All in one transaction (atomic).
CREATE OR REPLACE FUNCTION public.complete_bc_claim(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 3. record_bc_claim_failure — flips 'submitting' → 'failed' when BC rejected / errored / timed out.
--    Does NOT touch claims.bc_claim_details_id or claims.status (Finance can retry).
CREATE OR REPLACE FUNCTION public.record_bc_claim_failure(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 4. get_bc_claim_payload — returns the flat JSONB needed to build the BC line item.
--    Errors via RAISE EXCEPTION with custom SQLSTATEs so the edge function can pattern-match:
--      P0001 CLAIM_NOT_FOUND   — no active claim with that id
--      P0002 ALREADY_SUBMITTED — claims.bc_claim_details_id already non-null (successful prior submit)
--      P0003 MISSING_MAPPING   — one of the LATERAL joins returned zero rows
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
  -- Pre-check 1: claim exists?
  SELECT c.bc_claim_details_id, mpm.name
    INTO v_already_submitted_id, v_payment_mode_name
  FROM public.claims c
  JOIN public.master_payment_modes mpm ON mpm.id = c.payment_mode_id
  WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: %', p_claim_id USING ERRCODE = 'P0001';
  END IF;

  -- Pre-check 2: already successfully submitted?
  IF v_already_submitted_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: %', v_already_submitted_id USING ERRCODE = 'P0002';
  END IF;

  -- Build payload. LATERAL ... LIMIT 1 guards against duplicate active mapping rows
  -- even though mapping tables are guaranteed 1:1 per active key (defense in depth).
  SELECT jsonb_build_object(
    'claim_id',                     c.id,
    'payment_mode_name',            v_payment_mode_name,
    'submission_type',              c.submission_type,
    'employee_id',                  c.employee_id,
    'on_behalf_employee_code',      c.on_behalf_employee_code,
    'employee_name',
      CASE WHEN c.submission_type = 'On_behalf'
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
    'bc_code',                      ecm.bc_code
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

  -- Pre-check 3: did all mappings resolve?
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'MISSING_MAPPING: one or more required mappings missing for claim %', p_claim_id
      USING ERRCODE = 'P0003';
  END IF;

  RETURN v_result;
END;
$$;
