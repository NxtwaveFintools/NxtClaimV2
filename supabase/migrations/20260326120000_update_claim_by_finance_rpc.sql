create or replace function public.update_claim_by_finance(
  p_claim_id text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim claims%rowtype;
  v_detail_type text;
begin
  select *
  into v_claim
  from public.claims
  where id = p_claim_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive: %', p_claim_id;
  end if;

  v_detail_type := trim(coalesce(p_payload ->> 'detailType', ''));

  if v_detail_type not in ('expense', 'advance') then
    raise exception 'Invalid detailType in finance edit payload.';
  end if;

  if v_claim.detail_type <> v_detail_type then
    raise exception 'Claim detail type mismatch for finance edit request.';
  end if;

  update public.claims
  set
    department_id = (p_payload ->> 'departmentId')::uuid,
    payment_mode_id = (p_payload ->> 'paymentModeId')::uuid,
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
      total_amount = (p_payload ->> 'totalAmount')::numeric,
      vendor_name = nullif(p_payload ->> 'vendorName', ''),
      purpose = p_payload ->> 'purpose',
      people_involved = nullif(p_payload ->> 'peopleInvolved', ''),
      remarks = nullif(p_payload ->> 'remarks', ''),
      receipt_file_path = nullif(p_payload ->> 'receiptFilePath', ''),
      updated_at = now()
    where claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Active expense detail not found for claim: %', p_claim_id;
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
    where claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Active advance detail not found for claim: %', p_claim_id;
    end if;
  end if;
end;
$$;

grant execute on function public.update_claim_by_finance(text, jsonb) to authenticated;
grant execute on function public.update_claim_by_finance(text, jsonb) to service_role;

comment on function public.update_claim_by_finance(text, jsonb) is
  'Atomically updates claims and corresponding detail table rows for finance edit actions.';
