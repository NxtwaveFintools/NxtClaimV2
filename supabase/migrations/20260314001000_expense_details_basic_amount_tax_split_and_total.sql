alter table public.expense_details
  drop constraint if exists expense_details_gst_fields;

alter table public.expense_details
  rename column claimed_amount to basic_amount;

alter table public.expense_details
  add column if not exists purpose text not null default 'General Expense',
  add column if not exists cgst_amount numeric(12, 2) not null default 0,
  add column if not exists sgst_amount numeric(12, 2) not null default 0,
  add column if not exists igst_amount numeric(12, 2) not null default 0,
  add column if not exists total_amount numeric(12, 2) not null default 0;

alter table public.expense_details
  drop column if exists gst_amount;

update public.expense_details
set total_amount = coalesce(basic_amount, 0) + coalesce(cgst_amount, 0) + coalesce(sgst_amount, 0) + coalesce(igst_amount, 0)
where total_amount = 0;

alter table public.expense_details
  add constraint expense_details_gst_fields check (
    (
      is_gst_applicable = false
      and gst_number is null
      and cgst_amount = 0
      and sgst_amount = 0
      and igst_amount = 0
    )
    or
    (
      is_gst_applicable = true
      and gst_number is not null
    )
  );

create or replace function public.create_claim_with_detail(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid;
  v_payment_mode_name text;
  v_expected_detail_type text;
  v_detail_type text;
  v_basic_amount numeric;
  v_cgst_amount numeric;
  v_sgst_amount numeric;
  v_igst_amount numeric;
  v_is_gst_applicable boolean;
  v_total_amount numeric;
begin
  select name
    into v_payment_mode_name
  from public.master_payment_modes
  where id = (p_payload->>'payment_mode_id')::uuid
    and is_active = true;

  if v_payment_mode_name is null then
    raise exception 'Invalid or inactive payment_mode_id';
  end if;

  if lower(v_payment_mode_name) in ('reimbursement', 'corporate card', 'happay', 'forex') then
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
    status,
    submission_type,
    detail_type,
    submitted_by,
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
    'Submitted - Awaiting HOD approval',
    p_payload->>'submission_type',
    v_detail_type,
    (p_payload->>'submitted_by')::uuid,
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
      receipt_file_path,
      bank_statement_file_path,
      people_involved,
      remarks
    )
    values (
      v_claim_id,
      p_payload->'expense'->>'bill_no',
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
      nullif(p_payload->'expense'->>'receipt_file_path', ''),
      nullif(p_payload->'expense'->>'bank_statement_file_path', ''),
      nullif(p_payload->'expense'->>'people_involved', ''),
      nullif(p_payload->'expense'->>'remarks', '')
    );
  end if;

  if v_detail_type = 'advance' then
    insert into public.advance_details (
      claim_id,
      requested_amount,
      budget_month,
      budget_year,
      expected_usage_date,
      purpose,
      product_id,
      location_id,
      remarks
    )
    values (
      v_claim_id,
      (p_payload->'advance'->>'requested_amount')::numeric,
      (p_payload->'advance'->>'budget_month')::integer,
      (p_payload->'advance'->>'budget_year')::integer,
      (p_payload->'advance'->>'expected_usage_date')::date,
      p_payload->'advance'->>'purpose',
      nullif(p_payload->'advance'->>'product_id', '')::uuid,
      nullif(p_payload->'advance'->>'location_id', '')::uuid,
      nullif(p_payload->'advance'->>'remarks', '')
    );
  end if;

  return v_claim_id;
end;
$$;

grant execute on function public.create_claim_with_detail(jsonb) to authenticated;

comment on function public.create_claim_with_detail(jsonb) is
  'Transaction-safe claim submission function that inserts claims + exactly one child detail row based on payment_mode_id mapping.';

-- Rollback guidance (execute manually when safe):
-- 1) alter table public.expense_details drop constraint if exists expense_details_gst_fields;
-- 2) alter table public.expense_details rename column basic_amount to claimed_amount;
-- 3) alter table public.expense_details add column gst_amount numeric(12, 2) not null default 0;
-- 4) alter table public.expense_details drop column if exists purpose;
-- 5) alter table public.expense_details drop column if exists cgst_amount;
-- 6) alter table public.expense_details drop column if exists sgst_amount;
-- 7) alter table public.expense_details drop column if exists igst_amount;
-- 8) alter table public.expense_details drop column if exists total_amount;
