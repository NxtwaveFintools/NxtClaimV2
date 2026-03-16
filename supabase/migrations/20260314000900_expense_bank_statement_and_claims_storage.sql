alter table public.expense_details
  add column if not exists bank_statement_file_path text,
  add column if not exists people_involved text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claims',
  'claims',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'authenticated users can upload own claim files'
  ) then
    create policy "authenticated users can upload own claim files"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'claims'
        and split_part(name, '/', 1) in ('expenses', 'advances')
        and split_part(name, '/', 2) = auth.uid()::text
        and split_part(name, '/', 3) <> ''
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'authenticated users can read claim files'
  ) then
    create policy "authenticated users can read claim files"
      on storage.objects
      for select
      to authenticated
      using (bucket_id = 'claims');
  end if;
end $$;

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
    insert into public.expense_details (
      claim_id,
      bill_no,
      expense_category_id,
      product_id,
      location_id,
      is_gst_applicable,
      gst_number,
      gst_amount,
      transaction_date,
      claimed_amount,
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
      coalesce((p_payload->'expense'->>'is_gst_applicable')::boolean, false),
      nullif(p_payload->'expense'->>'gst_number', ''),
      coalesce((p_payload->'expense'->>'gst_amount')::numeric, 0),
      (p_payload->'expense'->>'transaction_date')::date,
      (p_payload->'expense'->>'claimed_amount')::numeric,
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
-- 1) alter table public.expense_details drop column if exists bank_statement_file_path;
-- 2) alter table public.expense_details drop column if exists people_involved;
-- 3) drop policy if exists "authenticated users can upload own claim files" on storage.objects;
-- 4) drop policy if exists "authenticated users can read claim files" on storage.objects;
-- 5) delete from storage.buckets where id = 'claims';
