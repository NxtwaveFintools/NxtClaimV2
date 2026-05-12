-- Roll back the detail amount audit-trail refactor to the prior schema and behavior.

drop index if exists public.uq_expense_details_active_bill;

alter table public.expense_details
  drop constraint if exists expense_details_requested_total_amount_check,
  drop constraint if exists expense_details_approved_amount_check;

alter table public.advance_details
  drop constraint if exists advance_details_approved_amount_check;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advance_details'
      and column_name = 'requested_total_amount'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advance_details'
      and column_name = 'requested_amount'
  ) then
    alter table public.advance_details
      rename column requested_total_amount to requested_amount;
  end if;
end;
$$;

alter table public.expense_details
  add column if not exists total_amount numeric generated always as ((((coalesce(basic_amount, 0::numeric) + coalesce(cgst_amount, 0::numeric)) + coalesce(sgst_amount, 0::numeric)) + coalesce(igst_amount, 0::numeric))) stored;

CREATE OR REPLACE FUNCTION "public"."bulk_process_claims"("p_action" "text", "p_actor_id" "uuid", "p_claim_ids" "text"[], "p_reason" "text" DEFAULT NULL::"text", "p_allow_resubmission" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim_id text;
  v_processed_count integer := 0;
  v_normalized_action text;
  v_audit_action text;
  v_expected_status public.claim_status;
  v_next_status public.claim_status;
  v_effective_reason text;
  v_beneficiary_id uuid;
  v_payment_mode_name text;
  v_expense_total numeric := 0;
  v_advance_total numeric := 0;
  v_increment_reimbursements numeric := 0;
  v_increment_petty_cash_received numeric := 0;
  v_increment_petty_cash_spent numeric := 0;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    return 0;
  end if;

  if not exists (
    select 1
    from public.master_finance_approvers mfa
    where mfa.user_id = p_actor_id
      and mfa.is_active = true
  ) then
    raise exception 'p_actor_id is not an active finance approver';
  end if;

  v_normalized_action := upper(trim(coalesce(p_action, '')));

  case v_normalized_action
    when 'L2_APPROVE', 'L2_APPROVED' then
      v_audit_action := 'L2_APPROVED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := 'Finance Approved - Payment under process';
      v_effective_reason := null;

    when 'L2_REJECT', 'L2_REJECTED' then
      v_audit_action := 'L2_REJECTED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := case
        when p_allow_resubmission then 'Rejected - Resubmission Allowed'
        else 'Rejected - Resubmission Not Allowed'
      end;
      v_effective_reason := nullif(trim(coalesce(p_reason, '')), '');

      if v_effective_reason is null then
        raise exception 'p_reason is required for L2_REJECT';
      end if;

    when 'MARK_PAID', 'L2_MARK_PAID' then
      v_audit_action := 'L2_MARK_PAID';
      v_expected_status := 'Finance Approved - Payment under process';
      v_next_status := 'Payment Done - Closed';
      v_effective_reason := null;

    else
      raise exception 'Unknown bulk action: %', p_action;
  end case;

  foreach v_claim_id in array p_claim_ids loop
    update public.claims
    set
      status = v_next_status,
      rejection_reason = case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end,
      is_resubmission_allowed = case
        when v_audit_action = 'L2_REJECTED' then p_allow_resubmission
        else false
      end,
      finance_action_at = now(),
      updated_at = now()
    where id = v_claim_id
      and is_active = true
      and status = v_expected_status;

    if not found then
      continue;
    end if;

    insert into public.claim_audit_logs (
      claim_id,
      actor_id,
      action_type,
      assigned_to_id,
      remarks
    )
    values (
      v_claim_id,
      p_actor_id,
      v_audit_action,
      null,
      case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end
    );

    if v_audit_action = 'L2_REJECTED' and p_allow_resubmission then
      update public.expense_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;

      update public.advance_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;
    end if;

    if v_audit_action = 'L2_MARK_PAID' then
      select
        coalesce(c.on_behalf_of_id, c.submitted_by),
        lower(coalesce(pm.name, '')),
        coalesce(
          (
            select ed.total_amount
            from public.expense_details ed
            where ed.claim_id = c.id
              and ed.is_active = true
            limit 1
          ),
          0
        ),
        coalesce(
          (
            select ad.requested_amount
            from public.advance_details ad
            where ad.claim_id = c.id
              and ad.is_active = true
            limit 1
          ),
          0
        )
      into
        v_beneficiary_id,
        v_payment_mode_name,
        v_expense_total,
        v_advance_total
      from public.claims c
      left join public.master_payment_modes pm
        on pm.id = c.payment_mode_id
      where c.id = v_claim_id
      limit 1;

      v_increment_reimbursements := 0;
      v_increment_petty_cash_received := 0;
      v_increment_petty_cash_spent := 0;

      if v_payment_mode_name = 'reimbursement' then
        v_increment_reimbursements := greatest(coalesce(v_expense_total, 0), 0);
      elsif v_payment_mode_name in ('petty cash request', 'bulk petty cash request') then
        v_increment_petty_cash_received := greatest(coalesce(v_advance_total, 0), 0);
      elsif v_payment_mode_name = 'petty cash' then
        v_increment_petty_cash_spent := greatest(coalesce(v_expense_total, 0), 0);
      end if;

      if v_beneficiary_id is not null and (
        v_increment_reimbursements > 0
        or v_increment_petty_cash_received > 0
        or v_increment_petty_cash_spent > 0
      ) then
        insert into public.wallets (
          user_id,
          total_reimbursements_received,
          total_petty_cash_received,
          total_petty_cash_spent
        )
        values (
          v_beneficiary_id,
          v_increment_reimbursements,
          v_increment_petty_cash_received,
          v_increment_petty_cash_spent
        )
        on conflict (user_id)
        do update set
          total_reimbursements_received =
            public.wallets.total_reimbursements_received + excluded.total_reimbursements_received,
          total_petty_cash_received =
            public.wallets.total_petty_cash_received + excluded.total_petty_cash_received,
          total_petty_cash_spent =
            public.wallets.total_petty_cash_spent + excluded.total_petty_cash_spent,
          updated_at = now();
      end if;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

  return v_processed_count;
end;
$$;


ALTER FUNCTION "public"."bulk_process_claims"("p_action" "text", "p_actor_id" "uuid", "p_claim_ids" "text"[], "p_reason" "text", "p_allow_resubmission" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_claim_with_detail"("p_payload" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
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
  v_advance_requested_amount numeric;
  v_advance_budget_month integer;
  v_advance_budget_year integer;
begin
  v_claim_id := nullif(trim(p_payload->>'claim_id'), '');

  if v_claim_id is null then
    raise exception 'claim_id is required';
  end if;

  if v_claim_id !~ '^(CLAIM|EA)-[A-Za-z0-9]+-[0-9]{8}-[A-Za-z0-9]+$' then
    raise exception 'claim_id % does not match required format', v_claim_id;
  end if;

  v_initial_status := coalesce(
    nullif(trim(p_payload->>'initial_status'), '')::public.claim_status,
    'Submitted - Awaiting HOD approval'::public.claim_status
  );

  select name into v_payment_mode_name
  from public.master_payment_modes
  where id = (p_payload->>'payment_mode_id')::uuid
    and is_active = true;

  if v_payment_mode_name is null then
    raise exception 'Invalid or inactive payment_mode_id';
  end if;

  if lower(v_payment_mode_name) in ('reimbursement', 'corporate card', 'happay', 'forex', 'petty cash') then
    v_expected_detail_type := 'expense';
  elsif lower(v_payment_mode_name) in ('petty cash request', 'bulk petty cash request') then
    v_expected_detail_type := 'advance';
  else
    raise exception 'Payment mode % is not mapped to a claim detail type', v_payment_mode_name;
  end if;

  v_detail_type := p_payload->>'detail_type';
  if v_detail_type is distinct from v_expected_detail_type then
    raise exception 'detail_type % does not match payment mode %', v_detail_type, v_payment_mode_name;
  end if;

  insert into public.claims (
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
  values (
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
  returning id into v_claim_id;

  if v_detail_type = 'expense' then
    v_is_gst_applicable := coalesce((p_payload->'expense'->>'is_gst_applicable')::boolean, false);
    v_basic_amount := (p_payload->'expense'->>'basic_amount')::numeric;
    v_cgst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'cgst_amount')::numeric, 0) else 0 end;
    v_sgst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'sgst_amount')::numeric, 0) else 0 end;
    v_igst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'igst_amount')::numeric, 0) else 0 end;

    insert into public.expense_details (
      claim_id,
      bill_no,
      transaction_id,
      expense_category_id,
      product_id,
      location_id,
      location_type,
      location_details,
      purpose,
      is_gst_applicable,
      gst_number,
      cgst_amount,
      sgst_amount,
      igst_amount,
      transaction_date,
      basic_amount,
      currency_code,
      vendor_name,
      receipt_file_path,
      bank_statement_file_path,
      people_involved,
      remarks,
      ai_metadata
    )
    values (
      v_claim_id,
      p_payload->'expense'->>'bill_no',
      coalesce(nullif(trim(p_payload->'expense'->>'transaction_id'), ''), 'N/A'),
      (p_payload->'expense'->>'expense_category_id')::uuid,
      nullif(p_payload->'expense'->>'product_id', '')::uuid,
      (p_payload->'expense'->>'location_id')::uuid,
      nullif(trim(p_payload->'expense'->>'location_type'), ''),
      nullif(trim(p_payload->'expense'->>'location_details'), ''),
      coalesce(nullif(trim(p_payload->'expense'->>'purpose'), ''), 'N/A'),
      v_is_gst_applicable,
      coalesce(nullif(trim(p_payload->'expense'->>'gst_number'), ''), 'N/A'),
      v_cgst_amount,
      v_sgst_amount,
      v_igst_amount,
      (p_payload->'expense'->>'transaction_date')::date,
      v_basic_amount,
      coalesce(nullif(trim(p_payload->'expense'->>'currency_code'), ''), 'INR'),
      coalesce(nullif(trim(p_payload->'expense'->>'vendor_name'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'receipt_file_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'bank_statement_file_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'people_involved'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'remarks'), ''), 'N/A'),
      coalesce(p_payload->'expense'->'ai_metadata', '{}'::jsonb)
    );
  end if;

  if v_detail_type = 'advance' then
    v_advance_requested_amount := (p_payload->'advance'->>'requested_amount')::numeric;
    v_advance_budget_month := (p_payload->'advance'->>'budget_month')::integer;
    v_advance_budget_year := (p_payload->'advance'->>'budget_year')::integer;

    if v_advance_requested_amount is null then
      raise exception 'Advance requested_amount is required';
    end if;
    if v_advance_requested_amount <= 0 then
      raise exception 'Advance requested_amount must be greater than zero';
    end if;
    if v_advance_budget_month is null then
      raise exception 'Advance budget_month is required';
    end if;
    if v_advance_budget_year is null then
      raise exception 'Advance budget_year is required';
    end if;

    insert into public.advance_details (
      claim_id,
      requested_amount,
      budget_month,
      budget_year,
      expected_usage_date,
      purpose,
      product_id,
      location_id,
      supporting_document_path,
      remarks
    )
    values (
      v_claim_id,
      v_advance_requested_amount,
      v_advance_budget_month,
      v_advance_budget_year,
      nullif(p_payload->'advance'->>'expected_usage_date', '')::date,
      coalesce(nullif(trim(p_payload->'advance'->>'purpose'), ''), 'N/A'),
      nullif(p_payload->'advance'->>'product_id', '')::uuid,
      nullif(p_payload->'advance'->>'location_id', '')::uuid,
      coalesce(nullif(trim(p_payload->'advance'->>'supporting_document_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'advance'->>'remarks'), ''), 'N/A')
    );
  end if;

  return v_claim_id;
end;
$_$;


ALTER FUNCTION "public"."create_claim_with_detail"("p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION public.refresh_claim_analytics_snapshot(p_claim_id text) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_claim record;
  v_hod_hours numeric(14,4);
  v_hod_samples integer;
  v_finance_hours numeric(14,4);
  v_finance_samples integer;
BEGIN
  IF p_claim_id IS NULL OR btrim(p_claim_id) = '' THEN
    RETURN;
  END IF;

  SELECT
    c.id AS claim_id,
    coalesce(c.submitted_at, c.created_at) AS submitted_on,
    coalesce(
      c.hod_action_at,
      CASE
        WHEN c.status = 'HOD approved - Awaiting finance approval'::public.claim_status THEN c.updated_at
        WHEN c.status IN (
          'Rejected - Resubmission Not Allowed'::public.claim_status,
          'Rejected - Resubmission Allowed'::public.claim_status
        ) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at
        ELSE NULL
      END
    ) AS resolved_hod_action_at,
    coalesce(
      c.finance_action_at,
      CASE
        WHEN c.status IN (
          'Finance Approved - Payment under process'::public.claim_status,
          'Payment Done - Closed'::public.claim_status
        ) THEN c.updated_at
        WHEN c.status IN (
          'Rejected - Resubmission Not Allowed'::public.claim_status,
          'Rejected - Resubmission Allowed'::public.claim_status
        ) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at
        ELSE NULL
      END
    ) AS resolved_finance_action_at,
    coalesce(c.submitted_at, c.created_at)::date AS date_key,
    c.status,
    c.department_id,
    c.payment_mode_id,
    ed.expense_category_id,
    coalesce(ed.product_id, ad.product_id) AS product_id,
    c.assigned_l2_approver_id,
    coalesce(ed.total_amount, ad.requested_amount, 0)::numeric(14,2) AS total_amount
  INTO v_claim
  FROM public.claims c
  LEFT JOIN public.expense_details ed
    ON ed.claim_id = c.id
    AND ed.is_active = true
  LEFT JOIN public.advance_details ad
    ON ad.claim_id = c.id
    AND ad.is_active = true
  WHERE c.id = p_claim_id
    AND c.is_active = true;

  IF NOT FOUND THEN
    DELETE FROM public.claims_analytics_snapshot
    WHERE claim_id = p_claim_id;
    RETURN;
  END IF;

  IF v_claim.resolved_hod_action_at IS NOT NULL
     AND v_claim.resolved_hod_action_at >= v_claim.submitted_on THEN
    v_hod_hours := round(
      (extract(epoch FROM (v_claim.resolved_hod_action_at - v_claim.submitted_on)) / 3600.0)::numeric,
      4
    );
    v_hod_samples := 1;
  ELSE
    v_hod_hours := 0;
    v_hod_samples := 0;
  END IF;

  IF v_claim.resolved_finance_action_at IS NOT NULL
     AND v_claim.resolved_hod_action_at IS NOT NULL
     AND v_claim.resolved_finance_action_at >= v_claim.resolved_hod_action_at THEN
    v_finance_hours := round(
      (extract(epoch FROM (v_claim.resolved_finance_action_at - v_claim.resolved_hod_action_at)) / 3600.0)::numeric,
      4
    );
    v_finance_samples := 1;
  ELSE
    v_finance_hours := 0;
    v_finance_samples := 0;
  END IF;

  INSERT INTO public.claims_analytics_snapshot (
    claim_id,
    date_key,
    status,
    department_id,
    payment_mode_id,
    expense_category_id,
    product_id,
    assigned_l2_approver_id,
    claim_count,
    total_amount,
    hod_approval_hours_sum,
    hod_approval_sample_count,
    finance_approval_hours,
    finance_approval_samples,
    created_at,
    updated_at
  )
  VALUES (
    v_claim.claim_id,
    v_claim.date_key,
    v_claim.status,
    v_claim.department_id,
    v_claim.payment_mode_id,
    v_claim.expense_category_id,
    v_claim.product_id,
    v_claim.assigned_l2_approver_id,
    1,
    v_claim.total_amount,
    v_hod_hours,
    v_hod_samples,
    v_finance_hours,
    v_finance_samples,
    now(),
    now()
  )
  ON CONFLICT (claim_id)
  DO UPDATE SET
    date_key = EXCLUDED.date_key,
    status = EXCLUDED.status,
    department_id = EXCLUDED.department_id,
    payment_mode_id = EXCLUDED.payment_mode_id,
    expense_category_id = EXCLUDED.expense_category_id,
    product_id = EXCLUDED.product_id,
    assigned_l2_approver_id = EXCLUDED.assigned_l2_approver_id,
    claim_count = EXCLUDED.claim_count,
    total_amount = EXCLUDED.total_amount,
    hod_approval_hours_sum = EXCLUDED.hod_approval_hours_sum,
    hod_approval_sample_count = EXCLUDED.hod_approval_sample_count,
    finance_approval_hours = EXCLUDED.finance_approval_hours,
    finance_approval_samples = EXCLUDED.finance_approval_samples,
    updated_at = now();
END;
$$;

ALTER FUNCTION public.refresh_claim_analytics_snapshot(text) OWNER TO postgres;


CREATE OR REPLACE FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") IS 'Atomically updates claims and corresponding detail table rows for finance edit actions.';


CREATE OR REPLACE FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") IS 'Atomically updates claim detail data and appends FINANCE_EDITED audit log with mandatory reason.';


CREATE OR REPLACE VIEW "public"."vw_admin_claims_dashboard" WITH ("security_invoker"='on') AS
 SELECT "c"."id" AS "claim_id",
    COALESCE(NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text"), NULLIF(TRIM(BOTH FROM "split_part"("u"."email", '@'::"text", 1)), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), 'N/A'::"text") AS "employee_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_employee_code"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text"), 'N/A'::"text") AS "employee_id",
    "c"."employee_id" AS "claim_employee_id_raw",
    "c"."on_behalf_employee_code" AS "on_behalf_employee_code_raw",
    NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") AS "submitter_name_raw",
    NULLIF(TRIM(BOTH FROM "beneficiary"."full_name"), ''::"text") AS "beneficiary_name_raw",
    COALESCE(NULLIF(TRIM(BOTH FROM "md"."name"), ''::"text"), 'Unknown Department'::"text") AS "department_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "mpm"."name"), ''::"text"),
        CASE
            WHEN ("c"."detail_type" = 'advance'::"text") THEN 'Advance'::"text"
            WHEN ("c"."detail_type" = 'expense'::"text") THEN 'Expense'::"text"
            ELSE 'Unknown'::"text"
        END) AS "type_of_claim",
    (COALESCE("ed"."total_amount", "ad"."requested_amount", (0)::numeric))::numeric(14,2) AS "amount",
    "c"."status",
    COALESCE("c"."submitted_at", "c"."created_at") AS "submitted_on",
    COALESCE("c"."hod_action_at",
        CASE
            WHEN ("c"."status" = 'HOD approved - Awaiting finance approval'::"public"."claim_status") THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "hod_action_date",
    COALESCE("c"."finance_action_at",
        CASE
            WHEN ("c"."status" = ANY (ARRAY['Finance Approved - Payment under process'::"public"."claim_status", 'Payment Done - Closed'::"public"."claim_status"])) THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NOT NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "finance_action_date",
    COALESCE("ed"."location_id", "ad"."location_id") AS "location_id",
    COALESCE("ed"."product_id", "ad"."product_id") AS "product_id",
    "ed"."expense_category_id",
    "c"."submitted_by",
    "c"."on_behalf_of_id",
    "c"."on_behalf_email",
    "c"."assigned_l1_approver_id",
    "c"."assigned_l2_approver_id",
    "c"."department_id",
    "c"."payment_mode_id",
    "c"."detail_type",
    "c"."submission_type",
    "c"."is_active",
    "c"."created_at",
    "c"."updated_at",
    "c"."deleted_by",
    "c"."deleted_at",
    NULLIF(TRIM(BOTH FROM "deleted_by_user"."full_name"), ''::"text") AS "deleted_by_name",
    CASE
        WHEN ("c"."deleted_by" IS NULL) THEN NULL::"text"
        WHEN EXISTS (
            SELECT 1
              FROM "public"."admins" "a"
             WHERE ("a"."user_id" = "c"."deleted_by")
        ) THEN 'admin'::"text"
        WHEN EXISTS (
            SELECT 1
              FROM "public"."master_finance_approvers" "f"
             WHERE (("f"."user_id" = "c"."deleted_by") AND ("f"."is_active" = true))
        ) THEN 'finance'::"text"
        ELSE 'employee'::"text"
    END AS "deleted_by_role",
    "u"."email" AS "submitter_email",
    "hod"."email" AS "hod_email",
    "finance"."email" AS "finance_email",
        CASE
            WHEN ((NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL)) THEN (((TRIM(BOTH FROM "u"."full_name") || ' ('::"text") || TRIM(BOTH FROM "u"."email")) || ')'::"text")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."full_name")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."email")
            ELSE "c"."employee_id"
        END AS "submitter_label",
        CASE
            WHEN ("c"."detail_type" = 'expense'::"text") THEN COALESCE(NULLIF(TRIM(BOTH FROM "mec_name"."name"), ''::"text"), 'Uncategorized'::"text")
            ELSE 'Advance'::"text"
        END AS "category_name",
    COALESCE("ed"."purpose", "ad"."purpose") AS "purpose",
    "ed"."receipt_file_path",
    "ed"."bank_statement_file_path",
    "ad"."supporting_document_path"
   FROM (((((((((("public"."claims" "c"
     LEFT JOIN "public"."users" "u" ON (("u"."id" = "c"."submitted_by")))
     LEFT JOIN "public"."users" "beneficiary" ON (("beneficiary"."id" = "c"."on_behalf_of_id")))
     LEFT JOIN "public"."users" "hod" ON (("hod"."id" = "c"."assigned_l1_approver_id")))
     LEFT JOIN "public"."users" "finance" ON (("finance"."id" = "c"."assigned_l2_approver_id")))
     LEFT JOIN "public"."users" "deleted_by_user" ON (("deleted_by_user"."id" = "c"."deleted_by")))
     LEFT JOIN "public"."master_departments" "md" ON (("md"."id" = "c"."department_id")))
     LEFT JOIN "public"."master_payment_modes" "mpm" ON (("mpm"."id" = "c"."payment_mode_id")))
     LEFT JOIN "public"."expense_details" "ed" ON (("ed"."claim_id" = "c"."id")))
     LEFT JOIN "public"."master_expense_categories" "mec_name" ON (("mec_name"."id" = "ed"."expense_category_id")))
     LEFT JOIN "public"."advance_details" "ad" ON (("ad"."claim_id" = "c"."id")));


ALTER VIEW "public"."vw_admin_claims_dashboard" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_enterprise_claims_dashboard" WITH ("security_invoker"='on') AS
 SELECT "c"."id" AS "claim_id",
    COALESCE(NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text"), NULLIF(TRIM(BOTH FROM "split_part"("u"."email", '@'::"text", 1)), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), 'N/A'::"text") AS "employee_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_employee_code"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text"), 'N/A'::"text") AS "employee_id",
    "c"."employee_id" AS "claim_employee_id_raw",
    "c"."on_behalf_employee_code" AS "on_behalf_employee_code_raw",
    NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") AS "submitter_name_raw",
    NULLIF(TRIM(BOTH FROM "beneficiary"."full_name"), ''::"text") AS "beneficiary_name_raw",
    COALESCE(NULLIF(TRIM(BOTH FROM "md"."name"), ''::"text"), 'Unknown Department'::"text") AS "department_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "mpm"."name"), ''::"text"),
        CASE
            WHEN ("c"."detail_type" = 'advance'::"text") THEN 'Advance'::"text"
            WHEN ("c"."detail_type" = 'expense'::"text") THEN 'Expense'::"text"
            ELSE 'Unknown'::"text"
        END) AS "type_of_claim",
    (COALESCE("ed"."total_amount", "ad"."requested_amount", (0)::numeric))::numeric(14,2) AS "amount",
    "c"."status",
    COALESCE("c"."submitted_at", "c"."created_at") AS "submitted_on",
    COALESCE("c"."hod_action_at",
        CASE
            WHEN ("c"."status" = 'HOD approved - Awaiting finance approval'::"public"."claim_status") THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "hod_action_date",
    COALESCE("c"."finance_action_at",
        CASE
            WHEN ("c"."status" = ANY (ARRAY['Finance Approved - Payment under process'::"public"."claim_status", 'Payment Done - Closed'::"public"."claim_status"])) THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NOT NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "finance_action_date",
    COALESCE("ed"."location_id", "ad"."location_id") AS "location_id",
    COALESCE("ed"."product_id", "ad"."product_id") AS "product_id",
    "ed"."expense_category_id",
    "c"."submitted_by",
    "c"."on_behalf_of_id",
    "c"."on_behalf_email",
    "c"."assigned_l1_approver_id",
    "c"."assigned_l2_approver_id",
    "c"."department_id",
    "c"."payment_mode_id",
    "c"."detail_type",
    "c"."submission_type",
    "c"."is_active",
    "c"."created_at",
    "c"."updated_at",
    "u"."email" AS "submitter_email",
    "hod"."email" AS "hod_email",
    "finance"."email" AS "finance_email",
        CASE
            WHEN ((NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL)) THEN (((TRIM(BOTH FROM "u"."full_name") || ' ('::"text") || TRIM(BOTH FROM "u"."email")) || ')'::"text")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."full_name")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."email")
            ELSE "c"."employee_id"
        END AS "submitter_label",
        CASE
            WHEN ("c"."detail_type" = 'expense'::"text") THEN COALESCE(NULLIF(TRIM(BOTH FROM "mec_name"."name"), ''::"text"), 'Uncategorized'::"text")
            ELSE 'Advance'::"text"
        END AS "category_name",
    COALESCE("ed"."purpose", "ad"."purpose") AS "purpose",
    "ed"."receipt_file_path",
    "ed"."bank_statement_file_path",
    "ad"."supporting_document_path"
   FROM (((((((("public"."claims" "c"
     LEFT JOIN "public"."users" "u" ON (("u"."id" = "c"."submitted_by")))
     LEFT JOIN "public"."users" "beneficiary" ON (("beneficiary"."id" = "c"."on_behalf_of_id")))
     LEFT JOIN "public"."users" "hod" ON (("hod"."id" = "c"."assigned_l1_approver_id")))
     LEFT JOIN "public"."users" "finance" ON (("finance"."id" = "c"."assigned_l2_approver_id")))
     LEFT JOIN "public"."master_departments" "md" ON (("md"."id" = "c"."department_id")))
     LEFT JOIN "public"."master_payment_modes" "mpm" ON (("mpm"."id" = "c"."payment_mode_id")))
     LEFT JOIN "public"."expense_details" "ed" ON ((("ed"."claim_id" = "c"."id") AND ("ed"."is_active" = true))))
     LEFT JOIN "public"."master_expense_categories" "mec_name" ON (("mec_name"."id" = "ed"."expense_category_id")))
     LEFT JOIN "public"."advance_details" "ad" ON ((("ad"."claim_id" = "c"."id") AND ("ad"."is_active" = true))))
  WHERE ("c"."is_active" = true);


ALTER VIEW "public"."vw_enterprise_claims_dashboard" OWNER TO "postgres";

alter table public.expense_details
  drop column if exists approved_amount,
  drop column if exists requested_total_amount;

alter table public.advance_details
  drop column if exists approved_amount;

create unique index if not exists uq_expense_details_active_bill
  on public.expense_details using btree (bill_no, transaction_date, total_amount)
  where (is_active = true);