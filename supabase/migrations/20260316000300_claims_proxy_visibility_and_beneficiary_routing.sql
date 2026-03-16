alter table public.claims
  add column if not exists on_behalf_of_id uuid references public.users(id) on delete restrict;

update public.claims
set on_behalf_of_id = submitted_by
where on_behalf_of_id is null;

alter table public.claims
  alter column on_behalf_of_id set not null;

create index if not exists idx_claims_on_behalf_of_id on public.claims(on_behalf_of_id);

alter table public.claims
  drop constraint if exists claims_on_behalf_fields;

alter table public.claims
  add constraint claims_on_behalf_fields check (
    (submission_type = 'Self' and on_behalf_email is null and on_behalf_employee_code is null and on_behalf_of_id = submitted_by)
    or
    (submission_type = 'On Behalf' and on_behalf_email is not null and on_behalf_employee_code is not null and on_behalf_of_id is not null)
  );

drop policy if exists "submitters and approvers can read claims" on public.claims;
create policy "submitters and approvers can read claims"
on public.claims
for select
to authenticated
using (
  auth.uid() = submitted_by
  or auth.uid() = on_behalf_of_id
  or auth.uid() = assigned_l1_approver_id
  or exists (
    select 1
    from public.master_finance_approvers mfa
    where mfa.id = claims.assigned_l2_approver_id
      and mfa.user_id = auth.uid()
      and mfa.is_active = true
  )
);

drop policy if exists "submitters and approvers can read expense details" on public.expense_details;
create policy "submitters and approvers can read expense details"
on public.expense_details
for select
to authenticated
using (
  exists (
    select 1
    from public.claims c
    where c.id = expense_details.claim_id
      and (
        auth.uid() = c.submitted_by
        or auth.uid() = c.on_behalf_of_id
        or auth.uid() = c.assigned_l1_approver_id
        or exists (
          select 1
          from public.master_finance_approvers mfa
          where mfa.id = c.assigned_l2_approver_id
            and mfa.user_id = auth.uid()
            and mfa.is_active = true
        )
      )
  )
);

drop policy if exists "submitters and approvers can read advance details" on public.advance_details;
create policy "submitters and approvers can read advance details"
on public.advance_details
for select
to authenticated
using (
  exists (
    select 1
    from public.claims c
    where c.id = advance_details.claim_id
      and (
        auth.uid() = c.submitted_by
        or auth.uid() = c.on_behalf_of_id
        or auth.uid() = c.assigned_l1_approver_id
        or exists (
          select 1
          from public.master_finance_approvers mfa
          where mfa.id = c.assigned_l2_approver_id
            and mfa.user_id = auth.uid()
            and mfa.is_active = true
        )
      )
  )
);

create or replace function public.create_claim_with_detail(p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
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
  v_total_amount numeric;
  v_advance_requested_amount numeric;
  v_advance_budget_month integer;
  v_advance_budget_year integer;
  v_advance_purpose text;
begin
  v_claim_id := nullif(trim(p_payload->>'claim_id'), '');

  if v_claim_id is null then
    raise exception 'claim_id is required';
  end if;

  if v_claim_id !~ '^CLAIM-[A-Za-z0-9]+-[0-9]{8}-[A-Za-z0-9]+$' then
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
    p_payload->>'on_behalf_email',
    p_payload->>'on_behalf_employee_code',
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
    v_total_amount := v_basic_amount + v_cgst_amount + v_sgst_amount + v_igst_amount;

    insert into public.expense_details (
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
    values (
      v_claim_id,
      p_payload->'expense'->>'bill_no',
      nullif(p_payload->'expense'->>'transaction_id', ''),
      (p_payload->'expense'->>'expense_category_id')::uuid,
      nullif(p_payload->'expense'->>'product_id', '')::uuid,
      (p_payload->'expense'->>'location_id')::uuid,
      coalesce(nullif(p_payload->'expense'->>'purpose', ''), 'General Expense'),
      v_is_gst_applicable,
      nullif(p_payload->'expense'->>'gst_number', ''),
      v_cgst_amount,
      v_sgst_amount,
      v_igst_amount,
      (p_payload->'expense'->>'transaction_date')::date,
      v_basic_amount,
      v_total_amount,
      coalesce(nullif(p_payload->'expense'->>'currency_code', ''), 'INR'),
      nullif(p_payload->'expense'->>'vendor_name', ''),
      nullif(p_payload->'expense'->>'receipt_file_hash', ''),
      nullif(p_payload->'expense'->>'receipt_file_path', ''),
      nullif(p_payload->'expense'->>'bank_statement_file_path', ''),
      nullif(p_payload->'expense'->>'people_involved', ''),
      nullif(p_payload->'expense'->>'remarks', '')
    );
  end if;

  if v_detail_type = 'advance' then
    v_advance_requested_amount := (p_payload->'advance'->>'requested_amount')::numeric;
    v_advance_budget_month := (p_payload->'advance'->>'budget_month')::integer;
    v_advance_budget_year := (p_payload->'advance'->>'budget_year')::integer;
    v_advance_purpose := nullif(trim(coalesce(p_payload->'advance'->>'purpose', '')), '');

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
    if v_advance_purpose is null then
      raise exception 'Advance purpose is required';
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
      supporting_document_hash,
      remarks
    )
    values (
      v_claim_id,
      v_advance_requested_amount,
      v_advance_budget_month,
      v_advance_budget_year,
      nullif(p_payload->'advance'->>'expected_usage_date', '')::date,
      v_advance_purpose,
      nullif(p_payload->'advance'->>'product_id', '')::uuid,
      nullif(p_payload->'advance'->>'location_id', '')::uuid,
      nullif(p_payload->'advance'->>'supporting_document_path', ''),
      nullif(p_payload->'advance'->>'supporting_document_hash', ''),
      nullif(p_payload->'advance'->>'remarks', '')
    );
  end if;

  return v_claim_id;
end;
$$;

-- Rollback (manual):
-- 1) Restore previous create_claim_with_detail function definition from 20260316000200 migration.
-- 2) Drop and recreate claims/expense/advance read policies without on_behalf_of_id.
-- 3) alter table public.claims drop constraint claims_on_behalf_fields;
-- 4) alter table public.claims add previous claims_on_behalf_fields check.
-- 5) drop index if exists idx_claims_on_behalf_of_id;
-- 6) alter table public.claims drop column if exists on_behalf_of_id;