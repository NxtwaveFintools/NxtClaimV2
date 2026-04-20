-- Enforce finance edit audit reason and atomic finance update + audit logging.
--
-- Why:
-- 1) Every finance claim edit must include a reason for auditability.
-- 2) Claim/detail updates and audit insertion must succeed/fail together.

alter table public.claim_audit_logs
  drop constraint if exists claim_audit_logs_action_type_check;

alter table public.claim_audit_logs
  add constraint claim_audit_logs_action_type_check check (
    action_type in (
      'SUBMITTED',
      'UPDATED',
      'L1_APPROVED',
      'L1_REJECTED',
      'L2_APPROVED',
      'L2_REJECTED',
      'L2_MARK_PAID',
      'FINANCE_EDITED',
      'ADMIN_SOFT_DELETED',
      'ADMIN_PAYMENT_MODE_OVERRIDDEN'
    )
  );

create or replace function public.update_claim_by_finance(
  p_claim_id text,
  p_actor_id uuid,
  p_edit_reason text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.claims%rowtype;
  v_detail_type text;
  v_trimmed_reason text;
  v_detail_id uuid;
begin
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
      bill_no = p_payload ->> 'billNo',
      expense_category_id = (p_payload ->> 'expenseCategoryId')::uuid,
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = (p_payload ->> 'locationId')::uuid,
      transaction_date = (p_payload ->> 'transactionDate')::date,
      is_gst_applicable = (p_payload ->> 'isGstApplicable')::boolean,
      gst_number = nullif(p_payload ->> 'gstNumber', ''),
      basic_amount = (p_payload ->> 'basicAmount')::numeric,
      cgst_amount = (p_payload ->> 'cgstAmount')::numeric,
      sgst_amount = (p_payload ->> 'sgstAmount')::numeric,
      igst_amount = (p_payload ->> 'igstAmount')::numeric,
      vendor_name = nullif(p_payload ->> 'vendorName', ''),
      purpose = p_payload ->> 'purpose',
      people_involved = nullif(p_payload ->> 'peopleInvolved', ''),
      remarks = nullif(p_payload ->> 'remarks', ''),
      receipt_file_path = nullif(p_payload ->> 'receiptFilePath', ''),
      bank_statement_file_path = nullif(p_payload ->> 'bankStatementFilePath', ''),
      updated_at = now()
    where id = v_detail_id
      and claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Cannot edit: Expense details missing or soft-deleted.';
    end if;
  else
    update public.advance_details
    set
      purpose = p_payload ->> 'purpose',
      requested_amount = (p_payload ->> 'requestedAmount')::numeric,
      expected_usage_date = (p_payload ->> 'expectedUsageDate')::date,
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = nullif(p_payload ->> 'locationId', '')::uuid,
      remarks = nullif(p_payload ->> 'remarks', ''),
      supporting_document_path = nullif(p_payload ->> 'supportingDocumentPath', ''),
      updated_at = now()
    where id = v_detail_id
      and claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Cannot edit: Advance details missing or soft-deleted.';
    end if;
  end if;

  insert into public.claim_audit_logs (
    claim_id,
    actor_id,
    action_type,
    assigned_to_id,
    remarks
  ) values (
    p_claim_id,
    p_actor_id,
    'FINANCE_EDITED',
    null,
    v_trimmed_reason
  );
end;
$$;

grant execute on function public.update_claim_by_finance(text, uuid, text, jsonb) to authenticated;
grant execute on function public.update_claim_by_finance(text, uuid, text, jsonb) to service_role;

comment on function public.update_claim_by_finance(text, uuid, text, jsonb) is
  'Atomically updates claim detail data and appends FINANCE_EDITED audit log with mandatory reason.';

notify pgrst, 'reload schema';

-- Rollback guidance (manual):
-- 1) Restore the previous public.update_claim_by_finance(text, jsonb) definition.
-- 2) Recreate claim_audit_logs_action_type_check without FINANCE_EDITED.
