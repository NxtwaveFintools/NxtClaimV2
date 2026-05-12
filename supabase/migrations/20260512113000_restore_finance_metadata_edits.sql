create or replace function public.update_claim_by_finance(
  p_claim_id text,
  p_actor_id uuid,
  p_edit_reason text,
  p_payload jsonb
) returns void
    language plpgsql security definer
    set search_path to 'public'
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
      bill_no = case
        when p_payload ? 'billNo' then coalesce(nullif(p_payload ->> 'billNo', ''), bill_no)
        else bill_no
      end,
      expense_category_id = case
        when p_payload ? 'expenseCategoryId'
          then coalesce(nullif(p_payload ->> 'expenseCategoryId', '')::uuid, expense_category_id)
        else expense_category_id
      end,
      product_id = case
        when p_payload ? 'productId' then nullif(p_payload ->> 'productId', '')::uuid
        else product_id
      end,
      location_id = case
        when p_payload ? 'locationId'
          then coalesce(nullif(p_payload ->> 'locationId', '')::uuid, location_id)
        else location_id
      end,
      location_type = case
        when p_payload ? 'locationType' then nullif(p_payload ->> 'locationType', '')
        else location_type
      end,
      location_details = case
        when p_payload ? 'locationDetails' then nullif(p_payload ->> 'locationDetails', '')
        else location_details
      end,
      transaction_date = case
        when p_payload ? 'transactionDate'
          then coalesce(nullif(p_payload ->> 'transactionDate', '')::date, transaction_date)
        else transaction_date
      end,
      purpose = case
        when p_payload ? 'purpose' then coalesce(nullif(p_payload ->> 'purpose', ''), purpose)
        else purpose
      end,
      is_gst_applicable = case
        when p_payload ? 'isGstApplicable'
          then coalesce((p_payload ->> 'isGstApplicable')::boolean, is_gst_applicable)
        else is_gst_applicable
      end,
      gst_number = case
        when p_payload ? 'gstNumber' then nullif(p_payload ->> 'gstNumber', '')
        else gst_number
      end,
      vendor_name = case
        when p_payload ? 'vendorName' then nullif(p_payload ->> 'vendorName', '')
        else vendor_name
      end,
      people_involved = case
        when p_payload ? 'peopleInvolved' then nullif(p_payload ->> 'peopleInvolved', '')
        else people_involved
      end,
      remarks = case
        when p_payload ? 'remarks' then nullif(p_payload ->> 'remarks', '')
        else remarks
      end,
      approved_amount = coalesce((p_payload ->> 'approvedAmount')::numeric, approved_amount),
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
      purpose = case
        when p_payload ? 'purpose' then coalesce(nullif(p_payload ->> 'purpose', ''), purpose)
        else purpose
      end,
      expected_usage_date = case
        when p_payload ? 'expectedUsageDate'
          then coalesce(nullif(p_payload ->> 'expectedUsageDate', '')::date, expected_usage_date)
        else expected_usage_date
      end,
      product_id = case
        when p_payload ? 'productId' then nullif(p_payload ->> 'productId', '')::uuid
        else product_id
      end,
      location_id = case
        when p_payload ? 'locationId' then nullif(p_payload ->> 'locationId', '')::uuid
        else location_id
      end,
      remarks = case
        when p_payload ? 'remarks' then nullif(p_payload ->> 'remarks', '')
        else remarks
      end,
      approved_amount = coalesce((p_payload ->> 'approvedAmount')::numeric, approved_amount),
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
  )
  values (
    p_claim_id,
    p_actor_id,
    'FINANCE_EDITED',
    null,
    v_trimmed_reason
  );
end;
$$;