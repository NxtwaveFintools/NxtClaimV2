-- Migration: fix_claim_edit_authorization
-- Expands update_claim_by_submitter authorization so claim edits are allowed for:
--   1) claim submitter
--   2) assigned L1 approver (HOD)
--   3) assigned L2 approver mapped through master_finance_approvers
--   4) any active finance approver in master_finance_approvers
--
-- This keeps the existing edit behavior unchanged while fixing false rejections
-- for assigned approvers during review.

BEGIN;

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
  v_submitter uuid;
  v_assigned_l1_approver_id uuid;
  v_is_assigned_l2_actor boolean := false;
  v_is_active_finance_actor boolean := false;
  v_claim public.claims%rowtype;
  v_detail_type text;
  v_detail_id uuid;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  -- AUTH GATE: pre-check authorization before taking row locks.
  select
    c.submitted_by,
    c.assigned_l1_approver_id,
    coalesce(mfa.user_id = p_actor_id, false)
  into
    v_submitter,
    v_assigned_l1_approver_id,
    v_is_assigned_l2_actor
  from public.claims c
  left join public.master_finance_approvers mfa
    on mfa.id = c.assigned_l2_approver_id
  where c.id = p_claim_id
    and c.is_active = true;

  if not found then
    raise exception 'Claim not found or inactive.';
  end if;

  select exists (
    select 1
    from public.master_finance_approvers mfa
    where mfa.user_id = p_actor_id
      and mfa.is_active = true
  )
  into v_is_active_finance_actor;

  if p_actor_id is distinct from v_submitter
    and p_actor_id is distinct from v_assigned_l1_approver_id
    and not v_is_assigned_l2_actor
    and not v_is_active_finance_actor
  then
    raise exception 'p_actor_id is not authorized to edit this claim';
  end if;

  -- Re-fetch with lock now that auth passed.
  select *
  into v_claim
  from public.claims
  where id = p_claim_id and is_active = true
  for update;

  if not found then
    raise exception 'Claim disappeared between auth check and lock.';
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
