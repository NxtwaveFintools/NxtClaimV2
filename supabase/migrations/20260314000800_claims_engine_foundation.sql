create extension if not exists pgcrypto;

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  status public.claim_status not null default 'Submitted - Awaiting HOD approval',
  submission_type text not null check (submission_type in ('Self', 'On Behalf')),
  detail_type text not null check (detail_type in ('expense', 'advance')),
  submitted_by uuid not null references public.users(id) on delete restrict,
  on_behalf_email text,
  on_behalf_employee_code text,
  department_id uuid not null references public.master_departments(id) on delete restrict,
  payment_mode_id uuid not null references public.master_payment_modes(id) on delete restrict,
  assigned_l1_approver_id uuid not null references public.users(id) on delete restrict,
  assigned_l2_approver_id uuid references public.master_finance_approvers(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claims_on_behalf_fields check (
    (submission_type = 'Self' and on_behalf_email is null and on_behalf_employee_code is null)
    or
    (submission_type = 'On Behalf' and on_behalf_email is not null and on_behalf_employee_code is not null)
  )
);

create table if not exists public.expense_details (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims(id) on delete restrict,
  bill_no text not null,
  expense_category_id uuid not null references public.master_expense_categories(id) on delete restrict,
  product_id uuid references public.master_products(id) on delete restrict,
  location_id uuid not null references public.master_locations(id) on delete restrict,
  is_gst_applicable boolean not null default false,
  gst_number text,
  gst_amount numeric(12, 2) not null default 0 check (gst_amount >= 0),
  transaction_date date not null,
  claimed_amount numeric(12, 2) not null check (claimed_amount > 0),
  currency_code text not null default 'INR',
  vendor_name text,
  receipt_file_path text,
  remarks text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_details_gst_fields check (
    (is_gst_applicable = false and gst_number is null and gst_amount = 0)
    or
    (is_gst_applicable = true and gst_number is not null)
  )
);

create table if not exists public.advance_details (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims(id) on delete restrict,
  requested_amount numeric(12, 2) not null check (requested_amount > 0),
  budget_month integer not null check (budget_month between 1 and 12),
  budget_year integer not null check (budget_year between 2000 and 2200),
  expected_usage_date date not null,
  purpose text not null,
  product_id uuid references public.master_products(id) on delete restrict,
  location_id uuid references public.master_locations(id) on delete restrict,
  remarks text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_claims_status on public.claims(status);
create index if not exists idx_claims_submitted_by on public.claims(submitted_by);
create index if not exists idx_claims_assigned_l1_approver_id on public.claims(assigned_l1_approver_id);
create index if not exists idx_claims_payment_mode_id on public.claims(payment_mode_id);
create index if not exists idx_claims_created_at on public.claims(created_at);
create index if not exists idx_claims_is_active on public.claims(is_active);

create index if not exists idx_expense_details_claim_id on public.expense_details(claim_id);
create index if not exists idx_expense_details_expense_category_id on public.expense_details(expense_category_id);
create index if not exists idx_expense_details_location_id on public.expense_details(location_id);

create index if not exists idx_advance_details_claim_id on public.advance_details(claim_id);
create index if not exists idx_advance_details_location_id on public.advance_details(location_id);

create or replace function public.validate_claim_detail_consistency()
returns trigger
language plpgsql
as $$
declare
  claim_detail_type text;
begin
  select detail_type into claim_detail_type
  from public.claims
  where id = new.claim_id;

  if claim_detail_type is null then
    raise exception 'Claim % does not exist', new.claim_id;
  end if;

  if tg_table_name = 'expense_details' then
    if claim_detail_type <> 'expense' then
      raise exception 'Claim % is not marked for expense details', new.claim_id;
    end if;

    if exists (select 1 from public.advance_details where claim_id = new.claim_id) then
      raise exception 'Claim % already has advance details', new.claim_id;
    end if;
  end if;

  if tg_table_name = 'advance_details' then
    if claim_detail_type <> 'advance' then
      raise exception 'Claim % is not marked for advance details', new.claim_id;
    end if;

    if exists (select 1 from public.expense_details where claim_id = new.claim_id) then
      raise exception 'Claim % already has expense details', new.claim_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_expense_claim_detail on public.expense_details;
create trigger trg_validate_expense_claim_detail
before insert or update on public.expense_details
for each row
execute function public.validate_claim_detail_consistency();

drop trigger if exists trg_validate_advance_claim_detail on public.advance_details;
create trigger trg_validate_advance_claim_detail
before insert or update on public.advance_details
for each row
execute function public.validate_claim_detail_consistency();

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

alter table public.claims enable row level security;
alter table public.expense_details enable row level security;
alter table public.advance_details enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'claims'
      and policyname = 'submitters and approvers can read claims'
  ) then
    create policy "submitters and approvers can read claims"
      on public.claims
      for select
      to authenticated
      using (
        auth.uid() = submitted_by
        or auth.uid() = assigned_l1_approver_id
        or exists (
          select 1
          from public.master_finance_approvers mfa
          where mfa.id = assigned_l2_approver_id
            and mfa.user_id = auth.uid()
            and mfa.is_active = true
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'claims'
      and policyname = 'submitters can create claims'
  ) then
    create policy "submitters can create claims"
      on public.claims
      for insert
      to authenticated
      with check (auth.uid() = submitted_by);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'expense_details'
      and policyname = 'submitters and approvers can read expense details'
  ) then
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
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'advance_details'
      and policyname = 'submitters and approvers can read advance details'
  ) then
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
  end if;
end $$;

comment on table public.claims is
  'Claim header table. Strict 1 claim = 1 transaction via child-table uniqueness and consistency triggers. No draft state supported.';

comment on table public.expense_details is
  'Expense branch details for reimbursement/corporate card/happay/forex payment modes.';

comment on table public.advance_details is
  'Advance branch details for petty cash request/bulk petty cash request payment modes.';

comment on function public.create_claim_with_detail(jsonb) is
  'Transaction-safe claim submission function that inserts claims + exactly one child detail row based on payment_mode_id mapping.';

-- Rollback guidance (execute manually in reverse dependency order when safe):
-- 1) drop function if exists public.create_claim_with_detail(jsonb);
-- 2) drop trigger if exists trg_validate_expense_claim_detail on public.expense_details;
-- 3) drop trigger if exists trg_validate_advance_claim_detail on public.advance_details;
-- 4) drop function if exists public.validate_claim_detail_consistency();
-- 5) drop table if exists public.expense_details;
-- 6) drop table if exists public.advance_details;
-- 7) drop table if exists public.claims;
