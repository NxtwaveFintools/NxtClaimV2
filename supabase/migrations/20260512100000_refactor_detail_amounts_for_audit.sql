alter table public.expense_details
  add column if not exists requested_total_amount numeric(10, 2),
  add column if not exists approved_amount numeric(10, 2);

alter table public.advance_details
  add column if not exists approved_amount numeric(10, 2);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advance_details'
      and column_name = 'requested_amount'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advance_details'
      and column_name = 'requested_total_amount'
  ) then
    alter table public.advance_details
      rename column requested_amount to requested_total_amount;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_trigger tg
    join pg_class rel
      on rel.oid = tg.tgrelid
    join pg_namespace ns
      on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'expense_details'
      and tg.tgname = 'trg_expense_details_refresh_analytics_snapshot'
      and not tg.tgisinternal
  ) then
    alter table public.expense_details
      disable trigger trg_expense_details_refresh_analytics_snapshot;
  end if;

  if exists (
    select 1
    from pg_trigger tg
    join pg_class rel
      on rel.oid = tg.tgrelid
    join pg_namespace ns
      on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'advance_details'
      and tg.tgname = 'trg_advance_details_refresh_analytics_snapshot'
      and not tg.tgisinternal
  ) then
    alter table public.advance_details
      disable trigger trg_advance_details_refresh_analytics_snapshot;
  end if;
end;
$$;

update public.expense_details
set
  requested_total_amount = coalesce(requested_total_amount, total_amount),
  approved_amount = coalesce(approved_amount, total_amount);

update public.advance_details
set approved_amount = coalesce(approved_amount, requested_total_amount);

alter table public.expense_details
  alter column requested_total_amount set not null,
  alter column approved_amount set not null;

alter table public.advance_details
  alter column approved_amount set not null;

alter table public.expense_details
  add constraint expense_details_requested_total_amount_check
    check (requested_total_amount > 0),
  add constraint expense_details_approved_amount_check
    check (approved_amount >= 0);

alter table public.advance_details
  add constraint advance_details_approved_amount_check
    check (approved_amount >= 0);

create or replace function public.bulk_process_claims(
  p_action text,
  p_actor_id uuid,
  p_claim_ids text[],
  p_reason text default null,
  p_allow_resubmission boolean default false
) returns integer
    language plpgsql security definer
    set search_path to 'public'
as $$
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
            select coalesce(ed.approved_amount, ed.requested_total_amount)
            from public.expense_details ed
            where ed.claim_id = c.id
              and ed.is_active = true
            limit 1
          ),
          0
        ),
        coalesce(
          (
            select coalesce(ad.approved_amount, ad.requested_total_amount)
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

create or replace function public.create_claim_with_detail(p_payload jsonb) returns text
    language plpgsql security definer
    set search_path to 'public'
as $_$
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
  v_expense_requested_total_amount numeric;
  v_advance_requested_total_amount numeric;
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
    v_basic_amount := coalesce((p_payload->'expense'->>'basic_amount')::numeric, 0);
    v_cgst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'cgst_amount')::numeric, 0) else 0 end;
    v_sgst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'sgst_amount')::numeric, 0) else 0 end;
    v_igst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'igst_amount')::numeric, 0) else 0 end;
    v_expense_requested_total_amount := round(v_basic_amount + v_cgst_amount + v_sgst_amount + v_igst_amount, 2);

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
      requested_total_amount,
      approved_amount,
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
      v_expense_requested_total_amount,
      v_expense_requested_total_amount,
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
    v_advance_requested_total_amount := (p_payload->'advance'->>'requested_total_amount')::numeric;
    v_advance_budget_month := (p_payload->'advance'->>'budget_month')::integer;
    v_advance_budget_year := (p_payload->'advance'->>'budget_year')::integer;

    if v_advance_requested_total_amount is null then
      raise exception 'Advance requested_total_amount is required';
    end if;
    if v_advance_requested_total_amount <= 0 then
      raise exception 'Advance requested_total_amount must be greater than zero';
    end if;
    if v_advance_budget_month is null then
      raise exception 'Advance budget_month is required';
    end if;
    if v_advance_budget_year is null then
      raise exception 'Advance budget_year is required';
    end if;

    insert into public.advance_details (
      claim_id,
      requested_total_amount,
      approved_amount,
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
      v_advance_requested_total_amount,
      v_advance_requested_total_amount,
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

create or replace function public.refresh_claim_analytics_snapshot(p_claim_id text) returns void
    language plpgsql
    set search_path to 'public'
as $$
declare
  v_claim record;
  v_hod_hours numeric := 0;
  v_hod_samples integer := 0;
begin
  if p_claim_id is null or trim(p_claim_id) = '' then
    return;
  end if;

  select
    c.id as claim_id,
    coalesce(c.submitted_at, c.created_at) as submitted_on,
    coalesce(
      c.hod_action_at,
      case
        when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
        when c.status in (
          'Rejected - Resubmission Not Allowed'::public.claim_status,
          'Rejected - Resubmission Allowed'::public.claim_status
        ) and c.assigned_l2_approver_id is null then c.updated_at
        else null
      end
    ) as resolved_hod_action_at,
    coalesce(c.submitted_at, c.created_at)::date as date_key,
    c.status,
    c.department_id,
    c.payment_mode_id,
    ed.expense_category_id,
    coalesce(ed.product_id, ad.product_id) as product_id,
    c.assigned_l2_approver_id,
    coalesce(ed.approved_amount, ed.requested_total_amount, ad.approved_amount, ad.requested_total_amount, 0)::numeric(14,2) as total_amount
  into v_claim
  from public.claims c
  left join public.expense_details ed
    on ed.claim_id = c.id
    and ed.is_active = true
  left join public.advance_details ad
    on ad.claim_id = c.id
    and ad.is_active = true
  where c.id = p_claim_id
    and c.is_active = true;

  if not found then
    delete from public.claims_analytics_snapshot
    where claim_id = p_claim_id;
    return;
  end if;

  if v_claim.resolved_hod_action_at is not null
     and v_claim.resolved_hod_action_at >= v_claim.submitted_on then
    v_hod_hours := round(
      (extract(epoch from (v_claim.resolved_hod_action_at - v_claim.submitted_on)) / 3600.0)::numeric,
      4
    );
    v_hod_samples := 1;
  else
    v_hod_hours := 0;
    v_hod_samples := 0;
  end if;

  insert into public.claims_analytics_snapshot (
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
    created_at,
    updated_at
  )
  values (
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
    now(),
    now()
  )
  on conflict (claim_id)
  do update set
    date_key = excluded.date_key,
    status = excluded.status,
    department_id = excluded.department_id,
    payment_mode_id = excluded.payment_mode_id,
    expense_category_id = excluded.expense_category_id,
    product_id = excluded.product_id,
    assigned_l2_approver_id = excluded.assigned_l2_approver_id,
    claim_count = excluded.claim_count,
    total_amount = excluded.total_amount,
    hod_approval_hours_sum = excluded.hod_approval_hours_sum,
    hod_approval_sample_count = excluded.hod_approval_sample_count,
    updated_at = now();
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_trigger tg
    join pg_class rel
      on rel.oid = tg.tgrelid
    join pg_namespace ns
      on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'expense_details'
      and tg.tgname = 'trg_expense_details_refresh_analytics_snapshot'
      and not tg.tgisinternal
  ) then
    alter table public.expense_details
      enable trigger trg_expense_details_refresh_analytics_snapshot;
  end if;

  if exists (
    select 1
    from pg_trigger tg
    join pg_class rel
      on rel.oid = tg.tgrelid
    join pg_namespace ns
      on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'advance_details'
      and tg.tgname = 'trg_advance_details_refresh_analytics_snapshot'
      and not tg.tgisinternal
  ) then
    alter table public.advance_details
      enable trigger trg_advance_details_refresh_analytics_snapshot;
  end if;
end;
$$;

create or replace function public.update_claim_by_finance(p_claim_id text, p_payload jsonb) returns void
    language plpgsql security definer
    set search_path to 'public'
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
      approved_amount = (p_payload ->> 'approvedAmount')::numeric,
      updated_at = now()
    where claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Active expense detail not found for claim: %', p_claim_id;
    end if;
  else
    update public.advance_details
    set
      approved_amount = (p_payload ->> 'approvedAmount')::numeric,
      updated_at = now()
    where claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Active advance detail not found for claim: %', p_claim_id;
    end if;
  end if;
end;
$$;

comment on function public.update_claim_by_finance(text, jsonb)
  is 'Atomically updates claims and corresponding detail table rows for finance edit actions.';

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
      approved_amount = (p_payload ->> 'approvedAmount')::numeric,
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
      approved_amount = (p_payload ->> 'approvedAmount')::numeric,
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

create or replace view public.vw_admin_claims_dashboard
with (security_invoker = 'on') as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(both from u.full_name), ''),
    nullif(trim(both from split_part(u.email, '@', 1)), ''),
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_employee_code), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    nullif(trim(both from u.email), ''),
    'N/A'
  ) as employee_id,
  c.employee_id as claim_employee_id_raw,
  c.on_behalf_employee_code as on_behalf_employee_code_raw,
  nullif(trim(both from u.full_name), '') as submitter_name_raw,
  nullif(trim(both from beneficiary.full_name), '') as beneficiary_name_raw,
  coalesce(nullif(trim(both from md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(both from mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(ed.approved_amount, ed.requested_total_amount, ad.approved_amount, ad.requested_total_amount, 0)::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is null then c.updated_at
      else null::timestamp with time zone
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status = any(array[
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ]) then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is not null then c.updated_at
      else null::timestamp with time zone
    end
  ) as finance_action_date,
  coalesce(ed.location_id, ad.location_id) as location_id,
  coalesce(ed.product_id, ad.product_id) as product_id,
  ed.expense_category_id,
  c.submitted_by,
  c.on_behalf_of_id,
  c.on_behalf_email,
  c.assigned_l1_approver_id,
  c.assigned_l2_approver_id,
  c.department_id,
  c.payment_mode_id,
  c.detail_type,
  c.submission_type,
  c.is_active,
  c.created_at,
  c.updated_at,
  c.deleted_by,
  c.deleted_at,
  nullif(trim(both from deleted_by_user.full_name), '') as deleted_by_name,
  case
    when c.deleted_by is null then null::text
    when exists (
      select 1
      from public.admins a
      where a.user_id = c.deleted_by
    ) then 'admin'
    when exists (
      select 1
      from public.master_finance_approvers f
      where f.user_id = c.deleted_by
        and f.is_active = true
    ) then 'finance'
    else 'employee'
  end as deleted_by_role,
  u.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(both from u.full_name), '') is not null and nullif(trim(both from u.email), '') is not null then trim(both from u.full_name) || ' (' || trim(both from u.email) || ')'
    when nullif(trim(both from u.full_name), '') is not null then trim(both from u.full_name)
    when nullif(trim(both from u.email), '') is not null then trim(both from u.email)
    else c.employee_id
  end as submitter_label,
  case
    when c.detail_type = 'expense' then coalesce(nullif(trim(both from mec_name.name), ''), 'Uncategorized')
    else 'Advance'
  end as category_name,
  coalesce(ed.purpose, ad.purpose) as purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path
from public.claims c
left join public.users u on u.id = c.submitted_by
left join public.users beneficiary on beneficiary.id = c.on_behalf_of_id
left join public.users hod on hod.id = c.assigned_l1_approver_id
left join public.users finance on finance.id = c.assigned_l2_approver_id
left join public.users deleted_by_user on deleted_by_user.id = c.deleted_by
left join public.master_departments md on md.id = c.department_id
left join public.master_payment_modes mpm on mpm.id = c.payment_mode_id
left join public.expense_details ed on ed.claim_id = c.id
left join public.master_expense_categories mec_name on mec_name.id = ed.expense_category_id
left join public.advance_details ad on ad.claim_id = c.id;

create or replace view public.vw_enterprise_claims_dashboard
with (security_invoker = 'on') as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(both from u.full_name), ''),
    nullif(trim(both from split_part(u.email, '@', 1)), ''),
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_employee_code), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    nullif(trim(both from u.email), ''),
    'N/A'
  ) as employee_id,
  c.employee_id as claim_employee_id_raw,
  c.on_behalf_employee_code as on_behalf_employee_code_raw,
  nullif(trim(both from u.full_name), '') as submitter_name_raw,
  nullif(trim(both from beneficiary.full_name), '') as beneficiary_name_raw,
  coalesce(nullif(trim(both from md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(both from mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(ed.approved_amount, ed.requested_total_amount, ad.approved_amount, ad.requested_total_amount, 0)::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is null then c.updated_at
      else null::timestamp with time zone
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status = any(array[
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ]) then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is not null then c.updated_at
      else null::timestamp with time zone
    end
  ) as finance_action_date,
  coalesce(ed.location_id, ad.location_id) as location_id,
  coalesce(ed.product_id, ad.product_id) as product_id,
  ed.expense_category_id,
  c.submitted_by,
  c.on_behalf_of_id,
  c.on_behalf_email,
  c.assigned_l1_approver_id,
  c.assigned_l2_approver_id,
  c.department_id,
  c.payment_mode_id,
  c.detail_type,
  c.submission_type,
  c.is_active,
  c.created_at,
  c.updated_at,
  u.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(both from u.full_name), '') is not null and nullif(trim(both from u.email), '') is not null then trim(both from u.full_name) || ' (' || trim(both from u.email) || ')'
    when nullif(trim(both from u.full_name), '') is not null then trim(both from u.full_name)
    when nullif(trim(both from u.email), '') is not null then trim(both from u.email)
    else c.employee_id
  end as submitter_label,
  case
    when c.detail_type = 'expense' then coalesce(nullif(trim(both from mec_name.name), ''), 'Uncategorized')
    else 'Advance'
  end as category_name,
  coalesce(ed.purpose, ad.purpose) as purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path
from public.claims c
left join public.users u on u.id = c.submitted_by
left join public.users beneficiary on beneficiary.id = c.on_behalf_of_id
left join public.users hod on hod.id = c.assigned_l1_approver_id
left join public.users finance on finance.id = c.assigned_l2_approver_id
left join public.master_departments md on md.id = c.department_id
left join public.master_payment_modes mpm on mpm.id = c.payment_mode_id
left join public.expense_details ed on ed.claim_id = c.id and ed.is_active = true
left join public.master_expense_categories mec_name on mec_name.id = ed.expense_category_id
left join public.advance_details ad on ad.claim_id = c.id and ad.is_active = true
where c.is_active = true;

drop index if exists public.uq_expense_details_active_bill;

alter table public.expense_details
  drop column total_amount;

create unique index uq_expense_details_active_bill
  on public.expense_details using btree (bill_no, transaction_date, requested_total_amount)
  where (is_active = true);