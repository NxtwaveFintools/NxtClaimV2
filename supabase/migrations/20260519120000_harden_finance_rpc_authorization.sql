-- Migration: harden_finance_rpc_authorization
-- Adds caller-authorization checks to update_claim_by_finance (4-arg) and
-- update_claim_by_submitter, and drops the unused/broken 2-arg
-- update_claim_by_finance(text, jsonb) overload introduced in
-- 20260518063735_simplify_amount_columns and preserved through
-- 20260519100000_rpc_finance_foreign_currency.
--
-- Rationale:
--   * Both new RPCs are SECURITY DEFINER and therefore bypass RLS on the
--     underlying tables. Without explicit caller checks, any authenticated
--     role could call them and edit arbitrary claims.
--   * The 2-arg update_claim_by_finance overload writes total_amount from the
--     payload, but the BEFORE-trigger trg_expense_total_amount (introduced in
--     20260518200000_enforce_expense_total_trigger) immediately recomputes
--     total_amount from basic+cgst+sgst+igst, none of which this overload
--     updates. The function silently zeros out finance-entered totals. It
--     is also unused in application code (grep confirmed). Drop it.
--
-- Auth pattern: mirrors public.bulk_process_claims (verifies p_actor_id
-- against public.master_finance_approvers for finance ops).

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Step 1: Drop the broken 2-arg overload.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.update_claim_by_finance(text, jsonb);

-- ─────────────────────────────────────────────────────────────
-- Step 2: Replace 4-arg update_claim_by_finance with an auth gate.
-- Body is identical to 20260519100000_rpc_finance_foreign_currency
-- with the addition of the finance-approver check at the top.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_claim_by_finance(
  p_claim_id text,
  p_actor_id uuid,
  p_edit_reason text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_claim public.claims%rowtype;
  v_detail_type text;
  v_trimmed_reason text;
  v_detail_id uuid;
begin
  -- AUTH GATE: caller must be an active finance approver.
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;
  if not exists (
    select 1 from public.master_finance_approvers
    where user_id = p_actor_id and is_active = true
  ) then
    raise exception 'p_actor_id is not an active finance approver';
  end if;

  v_trimmed_reason := btrim(coalesce(p_edit_reason, ''));

  if char_length(v_trimmed_reason) < 5 then
    raise exception 'An edit reason is required for the audit log.';
  end if;

  select *
  into v_claim
  from public.claims
  where id = p_claim_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive.';
  end if;

  v_detail_type := btrim(coalesce(p_payload ->> 'detailType', ''));

  if v_detail_type not in ('expense', 'advance') then
    raise exception 'Invalid detailType in finance edit payload.';
  end if;

  if v_claim.detail_type <> v_detail_type then
    raise exception 'Claim detail type mismatch for finance edit request.';
  end if;

  v_detail_id := nullif(p_payload ->> 'detailId', '')::uuid;

  if v_detail_id is null then
    raise exception 'Detail ID is required for finance edit payload.';
  end if;

  update public.claims
  set
    payment_mode_id = coalesce(nullif(p_payload ->> 'paymentModeId', '')::uuid, payment_mode_id),
    updated_at = now()
  where id = p_claim_id
    and is_active = true;

  if v_detail_type = 'expense' then
    update public.expense_details
    set
      bill_no = case when p_payload ? 'billNo' then coalesce(nullif(p_payload ->> 'billNo', ''), bill_no) else bill_no end,
      expense_category_id = case when p_payload ? 'expenseCategoryId' then coalesce(nullif(p_payload ->> 'expenseCategoryId', '')::uuid, expense_category_id) else expense_category_id end,
      product_id = case when p_payload ? 'productId' then nullif(p_payload ->> 'productId', '')::uuid else product_id end,
      location_id = case when p_payload ? 'locationId' then coalesce(nullif(p_payload ->> 'locationId', '')::uuid, location_id) else location_id end,
      location_type = case when p_payload ? 'locationType' then nullif(p_payload ->> 'locationType', '') else location_type end,
      location_details = case when p_payload ? 'locationDetails' then nullif(p_payload ->> 'locationDetails', '') else location_details end,
      transaction_date = case when p_payload ? 'transactionDate' then coalesce(nullif(p_payload ->> 'transactionDate', '')::date, transaction_date) else transaction_date end,
      purpose = case when p_payload ? 'purpose' then coalesce(nullif(p_payload ->> 'purpose', ''), purpose) else purpose end,
      is_gst_applicable = case when p_payload ? 'isGstApplicable' then coalesce((p_payload ->> 'isGstApplicable')::boolean, is_gst_applicable) else is_gst_applicable end,
      gst_number = case when p_payload ? 'gstNumber' then nullif(p_payload ->> 'gstNumber', '') else gst_number end,
      vendor_name = case when p_payload ? 'vendorName' then nullif(p_payload ->> 'vendorName', '') else vendor_name end,
      people_involved = case when p_payload ? 'peopleInvolved' then nullif(p_payload ->> 'peopleInvolved', '') else people_involved end,
      remarks = case when p_payload ? 'remarks' then nullif(p_payload ->> 'remarks', '') else remarks end,
      receipt_file_path = coalesce(nullif(p_payload ->> 'receiptFilePath', ''), receipt_file_path),
      bank_statement_file_path = coalesce(nullif(p_payload ->> 'bankStatementFilePath', ''), bank_statement_file_path),
      basic_amount = coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount),
      cgst_amount = coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount),
      sgst_amount = coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount),
      igst_amount = coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
      total_amount = round(
        coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount)
        + coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount)
        + coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount)
        + coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
        2
      ),
      foreign_currency_code = case when p_payload ? 'foreignCurrencyCode' then coalesce(nullif(p_payload ->> 'foreignCurrencyCode', '')::public.foreign_currency_code, 'INR'::public.foreign_currency_code) else foreign_currency_code end,
      foreign_basic_amount = case when p_payload ? 'foreignBasicAmount' then coalesce((p_payload ->> 'foreignBasicAmount')::numeric, 0) else foreign_basic_amount end,
      foreign_gst_amount = case when p_payload ? 'foreignGstAmount' then coalesce((p_payload ->> 'foreignGstAmount')::numeric, 0) else foreign_gst_amount end,
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Expense details missing or soft-deleted.';
    end if;
  else
    update public.advance_details
    set
      purpose = case when p_payload ? 'purpose' then coalesce(nullif(p_payload ->> 'purpose', ''), purpose) else purpose end,
      expected_usage_date = case when p_payload ? 'expectedUsageDate' then coalesce(nullif(p_payload ->> 'expectedUsageDate', '')::date, expected_usage_date) else expected_usage_date end,
      product_id = case when p_payload ? 'productId' then nullif(p_payload ->> 'productId', '')::uuid else product_id end,
      location_id = case when p_payload ? 'locationId' then nullif(p_payload ->> 'locationId', '')::uuid else location_id end,
      remarks = case when p_payload ? 'remarks' then nullif(p_payload ->> 'remarks', '') else remarks end,
      supporting_document_path = coalesce(nullif(p_payload ->> 'supportingDocumentPath', ''), supporting_document_path),
      total_amount = coalesce((p_payload ->> 'totalAmount')::numeric, total_amount),
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Advance details missing or soft-deleted.';
    end if;
  end if;

  insert into public.claim_audit_logs (claim_id, actor_id, action_type, assigned_to_id, remarks)
  values (p_claim_id, p_actor_id, 'FINANCE_EDITED', null, v_trimmed_reason);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Step 3: Replace update_claim_by_submitter with an owner-check gate.
-- Body identical to 20260519100000_rpc_finance_foreign_currency with the
-- addition of an owner-match check.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_claim_by_submitter(
  p_claim_id text,
  p_actor_id uuid,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_claim public.claims%rowtype;
  v_detail_type text;
  v_detail_id uuid;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  select *
  into v_claim
  from public.claims
  where id = p_claim_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive.';
  end if;

  -- AUTH GATE: caller must be the original submitter of this claim.
  if p_actor_id is distinct from v_claim.submitted_by then
    raise exception 'p_actor_id is not the claim submitter';
  end if;

  v_detail_type := btrim(coalesce(p_payload ->> 'detailType', ''));

  if v_detail_type not in ('expense', 'advance') then
    raise exception 'Invalid detailType in submitter edit payload.';
  end if;

  if v_claim.detail_type <> v_detail_type then
    raise exception 'Claim detail type mismatch for submitter edit request.';
  end if;

  v_detail_id := nullif(p_payload ->> 'detailId', '')::uuid;

  if v_detail_id is null then
    raise exception 'Detail ID is required for submitter edit payload.';
  end if;

  update public.claims
  set updated_at = now()
  where id = p_claim_id
    and is_active = true;

  if v_detail_type = 'expense' then
    update public.expense_details
    set
      bill_no = coalesce(nullif(p_payload ->> 'billNo', ''), bill_no),
      expense_category_id = coalesce(nullif(p_payload ->> 'expenseCategoryId', '')::uuid, expense_category_id),
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = coalesce(nullif(p_payload ->> 'locationId', '')::uuid, location_id),
      transaction_date = coalesce(nullif(p_payload ->> 'transactionDate', '')::date, transaction_date),
      is_gst_applicable = coalesce((p_payload ->> 'isGstApplicable')::boolean, is_gst_applicable),
      gst_number = nullif(p_payload ->> 'gstNumber', ''),
      basic_amount = coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount),
      cgst_amount = coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount),
      sgst_amount = coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount),
      igst_amount = coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
      total_amount = round(
        coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount)
        + coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount)
        + coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount)
        + coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
        2
      ),
      vendor_name = nullif(p_payload ->> 'vendorName', ''),
      purpose = coalesce(nullif(p_payload ->> 'purpose', ''), purpose),
      people_involved = nullif(p_payload ->> 'peopleInvolved', ''),
      remarks = nullif(p_payload ->> 'remarks', ''),
      receipt_file_path = case when p_payload ? 'receiptFilePath' then nullif(p_payload ->> 'receiptFilePath', '') else receipt_file_path end,
      bank_statement_file_path = case when p_payload ? 'bankStatementFilePath' then nullif(p_payload ->> 'bankStatementFilePath', '') else bank_statement_file_path end,
      foreign_currency_code = case when p_payload ? 'foreignCurrencyCode' then coalesce(nullif(p_payload ->> 'foreignCurrencyCode', '')::public.foreign_currency_code, 'INR'::public.foreign_currency_code) else foreign_currency_code end,
      foreign_basic_amount = case when p_payload ? 'foreignBasicAmount' then coalesce((p_payload ->> 'foreignBasicAmount')::numeric, 0) else foreign_basic_amount end,
      foreign_gst_amount = case when p_payload ? 'foreignGstAmount' then coalesce((p_payload ->> 'foreignGstAmount')::numeric, 0) else foreign_gst_amount end,
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Expense details missing or soft-deleted.';
    end if;
  else
    update public.advance_details
    set
      purpose = coalesce(nullif(p_payload ->> 'purpose', ''), purpose),
      total_amount = coalesce((p_payload ->> 'totalAmount')::numeric, total_amount),
      expected_usage_date = coalesce(nullif(p_payload ->> 'expectedUsageDate', '')::date, expected_usage_date),
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = nullif(p_payload ->> 'locationId', '')::uuid,
      remarks = nullif(p_payload ->> 'remarks', ''),
      supporting_document_path = case when p_payload ? 'supportingDocumentPath' then nullif(p_payload ->> 'supportingDocumentPath', '') else supporting_document_path end,
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Advance details missing or soft-deleted.';
    end if;
  end if;

  insert into public.claim_audit_logs (claim_id, actor_id, action_type, assigned_to_id, remarks)
  values (p_claim_id, p_actor_id, 'UPDATED', null, 'Claim details updated before finance review.');
end;
$$;

COMMIT;
