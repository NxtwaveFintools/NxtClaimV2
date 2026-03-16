TRUNCATE TABLE public.claims CASCADE;

ALTER TABLE public.expense_details
  DROP CONSTRAINT IF EXISTS expense_details_gst_fields;

ALTER TABLE public.expense_details
  ADD CONSTRAINT expense_details_gst_fields CHECK (
    (
      is_gst_applicable = false
      AND coalesce(gst_number, 'N/A') = 'N/A'
      AND cgst_amount = 0
      AND sgst_amount = 0
      AND igst_amount = 0
    )
    OR
    (
      is_gst_applicable = true
      AND coalesce(gst_number, 'N/A') <> 'N/A'
    )
  );

ALTER TABLE public.claims
  DROP CONSTRAINT IF EXISTS claims_on_behalf_fields;

ALTER TABLE public.claims
  ADD CONSTRAINT claims_on_behalf_fields CHECK (
    (
      submission_type = 'Self'
      AND coalesce(on_behalf_email, 'N/A') = 'N/A'
      AND coalesce(on_behalf_employee_code, 'N/A') = 'N/A'
      AND on_behalf_of_id = submitted_by
    )
    OR
    (
      submission_type = 'On Behalf'
      AND coalesce(on_behalf_email, 'N/A') <> 'N/A'
      AND coalesce(on_behalf_employee_code, 'N/A') <> 'N/A'
      AND on_behalf_of_id IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.create_claim_with_detail(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_id text;
  v_initial_status public.claim_status;
  v_payment_mode_name text;
  v_expected_detail_type text;
  v_detail_type text;
  v_basic_amount numeric;
  v_cgst_amount numeric;
  v_sgst_amount numeric;
  v_igst_amount numeric;
  v_is_gst_applicable boolean;
  v_total_amount numeric;
  v_advance_requested_amount numeric;
  v_advance_budget_month integer;
  v_advance_budget_year integer;
BEGIN
  v_claim_id := nullif(trim(p_payload->>'claim_id'), '');

  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'claim_id is required';
  END IF;

  IF v_claim_id !~ '^CLAIM-[A-Za-z0-9]+-[0-9]{8}-[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'claim_id % does not match required format', v_claim_id;
  END IF;

  v_initial_status := coalesce(
    nullif(trim(p_payload->>'initial_status'), '')::public.claim_status,
    'Submitted - Awaiting HOD approval'::public.claim_status
  );

  SELECT name INTO v_payment_mode_name
  FROM public.master_payment_modes
  WHERE id = (p_payload->>'payment_mode_id')::uuid
    AND is_active = true;

  IF v_payment_mode_name IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive payment_mode_id';
  END IF;

  IF lower(v_payment_mode_name) IN ('reimbursement', 'corporate card', 'happay', 'forex', 'petty cash') THEN
    v_expected_detail_type := 'expense';
  ELSIF lower(v_payment_mode_name) IN ('petty cash request', 'bulk petty cash request') THEN
    v_expected_detail_type := 'advance';
  ELSE
    RAISE EXCEPTION 'Payment mode % is not mapped to a claim detail type', v_payment_mode_name;
  END IF;

  v_detail_type := p_payload->>'detail_type';
  IF v_detail_type IS DISTINCT FROM v_expected_detail_type THEN
    RAISE EXCEPTION 'detail_type % does not match payment mode %', v_detail_type, v_payment_mode_name;
  END IF;

  INSERT INTO public.claims (
    id,
    status,
    submission_type,
    detail_type,
    submitted_by,
    on_behalf_of_id,
    on_behalf_email,
    on_behalf_employee_code,
    department_id,
    payment_mode_id,
    assigned_l1_approver_id,
    assigned_l2_approver_id,
    submitted_at,
    is_active
  )
  VALUES (
    v_claim_id,
    v_initial_status,
    p_payload->>'submission_type',
    v_detail_type,
    (p_payload->>'submitted_by')::uuid,
    (p_payload->>'on_behalf_of_id')::uuid,
    coalesce(nullif(trim(p_payload->>'on_behalf_email'), ''), 'N/A'),
    coalesce(nullif(trim(p_payload->>'on_behalf_employee_code'), ''), 'N/A'),
    (p_payload->>'department_id')::uuid,
    (p_payload->>'payment_mode_id')::uuid,
    (p_payload->>'assigned_l1_approver_id')::uuid,
    nullif(p_payload->>'assigned_l2_approver_id', '')::uuid,
    now(),
    true
  )
  RETURNING id INTO v_claim_id;

  IF v_detail_type = 'expense' THEN
    v_is_gst_applicable := coalesce((p_payload->'expense'->>'is_gst_applicable')::boolean, false);
    v_basic_amount := (p_payload->'expense'->>'basic_amount')::numeric;
    v_cgst_amount := CASE WHEN v_is_gst_applicable THEN coalesce((p_payload->'expense'->>'cgst_amount')::numeric, 0) ELSE 0 END;
    v_sgst_amount := CASE WHEN v_is_gst_applicable THEN coalesce((p_payload->'expense'->>'sgst_amount')::numeric, 0) ELSE 0 END;
    v_igst_amount := CASE WHEN v_is_gst_applicable THEN coalesce((p_payload->'expense'->>'igst_amount')::numeric, 0) ELSE 0 END;
    v_total_amount := v_basic_amount + v_cgst_amount + v_sgst_amount + v_igst_amount;

    INSERT INTO public.expense_details (
      claim_id,
      bill_no,
      transaction_id,
      expense_category_id,
      product_id,
      location_id,
      purpose,
      is_gst_applicable,
      gst_number,
      cgst_amount,
      sgst_amount,
      igst_amount,
      transaction_date,
      basic_amount,
      total_amount,
      currency_code,
      vendor_name,
      receipt_file_hash,
      receipt_file_path,
      bank_statement_file_path,
      people_involved,
      remarks
    )
    VALUES (
      v_claim_id,
      p_payload->'expense'->>'bill_no',
      coalesce(nullif(trim(p_payload->'expense'->>'transaction_id'), ''), 'N/A'),
      (p_payload->'expense'->>'expense_category_id')::uuid,
      nullif(p_payload->'expense'->>'product_id', '')::uuid,
      (p_payload->'expense'->>'location_id')::uuid,
      coalesce(nullif(trim(p_payload->'expense'->>'purpose'), ''), 'N/A'),
      v_is_gst_applicable,
      coalesce(nullif(trim(p_payload->'expense'->>'gst_number'), ''), 'N/A'),
      v_cgst_amount,
      v_sgst_amount,
      v_igst_amount,
      (p_payload->'expense'->>'transaction_date')::date,
      v_basic_amount,
      v_total_amount,
      coalesce(nullif(trim(p_payload->'expense'->>'currency_code'), ''), 'INR'),
      coalesce(nullif(trim(p_payload->'expense'->>'vendor_name'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'receipt_file_hash'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'receipt_file_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'bank_statement_file_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'people_involved'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'remarks'), ''), 'N/A')
    );
  END IF;

  IF v_detail_type = 'advance' THEN
    v_advance_requested_amount := (p_payload->'advance'->>'requested_amount')::numeric;
    v_advance_budget_month := (p_payload->'advance'->>'budget_month')::integer;
    v_advance_budget_year := (p_payload->'advance'->>'budget_year')::integer;

    IF v_advance_requested_amount IS NULL THEN
      RAISE EXCEPTION 'Advance requested_amount is required';
    END IF;
    IF v_advance_requested_amount <= 0 THEN
      RAISE EXCEPTION 'Advance requested_amount must be greater than zero';
    END IF;
    IF v_advance_budget_month IS NULL THEN
      RAISE EXCEPTION 'Advance budget_month is required';
    END IF;
    IF v_advance_budget_year IS NULL THEN
      RAISE EXCEPTION 'Advance budget_year is required';
    END IF;

    INSERT INTO public.advance_details (
      claim_id,
      requested_amount,
      budget_month,
      budget_year,
      expected_usage_date,
      purpose,
      product_id,
      location_id,
      supporting_document_path,
      supporting_document_hash,
      remarks
    )
    VALUES (
      v_claim_id,
      v_advance_requested_amount,
      v_advance_budget_month,
      v_advance_budget_year,
      nullif(p_payload->'advance'->>'expected_usage_date', '')::date,
      coalesce(nullif(trim(p_payload->'advance'->>'purpose'), ''), 'N/A'),
      nullif(p_payload->'advance'->>'product_id', '')::uuid,
      nullif(p_payload->'advance'->>'location_id', '')::uuid,
      coalesce(nullif(trim(p_payload->'advance'->>'supporting_document_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'advance'->>'supporting_document_hash'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'advance'->>'remarks'), ''), 'N/A')
    );
  END IF;

  RETURN v_claim_id;
END;
$$;

-- Rollback (manual):
-- 1) Restore previous create_claim_with_detail function definition from 20260316000300 migration.
-- 2) alter table public.claims drop constraint claims_on_behalf_fields;
-- 3) alter table public.claims add previous claims_on_behalf_fields check.
-- 4) Restore removed data from backups if needed (truncate is destructive).
