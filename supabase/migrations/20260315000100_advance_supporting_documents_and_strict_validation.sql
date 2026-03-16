alter table if exists public.advance_details
  add column if not exists supporting_document_path text,
  add column if not exists supporting_document_hash text;

alter table if exists public.advance_details
  alter column expected_usage_date drop not null;

drop policy if exists "authenticated users can upload own claim files" on storage.objects;

create policy "authenticated users can upload own claim files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'claims'
    and split_part(name, '/', 1) in ('expenses', 'petty_cash_requests')
    and split_part(name, '/', 2) = auth.uid()::text
    and split_part(name, '/', 3) <> ''
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
  v_advance_requested_amount numeric;
  v_advance_budget_month integer;
  v_advance_budget_year integer;
  v_advance_purpose text;
begin
  select name
    into v_payment_mode_name
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

grant execute on function public.create_claim_with_detail(jsonb) to authenticated;

comment on function public.create_claim_with_detail(jsonb) is
'Creates claim header and strict detail rows; advance requires amount, budget month/year, and purpose, with optional supporting document path/hash.';

-- Rollback guidance (execute manually when safe):
-- 0) drop policy if exists "authenticated users can upload own claim files" on storage.objects;
-- 0.1) create policy "authenticated users can upload own claim files" on storage.objects for insert to authenticated with check (bucket_id = 'claims' and split_part(name, '/', 1) in ('expenses', 'advances') and split_part(name, '/', 2) = auth.uid()::text and split_part(name, '/', 3) <> '');
-- 1) alter table public.advance_details drop column if exists supporting_document_path;
-- 2) alter table public.advance_details drop column if exists supporting_document_hash;
-- 3) alter table public.advance_details alter column expected_usage_date set not null;
-- 4) restore previous function body for public.create_claim_with_detail(jsonb).