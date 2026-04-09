-- Performance: Trigger-maintained analytics cache tables.
-- This migration creates:
-- 1) claim-level analytics snapshots (1 row per active claim)
-- 2) daily aggregated analytics stats for fast dashboard reads
-- 3) trigger pipeline to keep both structures in sync

create table if not exists public.claims_analytics_snapshot (
  claim_id text primary key references public.claims(id) on delete cascade,
  date_key date not null,
  status public.claim_status not null,
  department_id uuid not null references public.master_departments(id) on delete restrict,
  payment_mode_id uuid not null references public.master_payment_modes(id) on delete restrict,
  expense_category_id uuid references public.master_expense_categories(id) on delete restrict,
  product_id uuid references public.master_products(id) on delete restrict,
  assigned_l2_approver_id uuid references public.master_finance_approvers(id) on delete restrict,
  claim_count integer not null default 1 check (claim_count = 1),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  hod_approval_hours_sum numeric(14,4) not null default 0 check (hod_approval_hours_sum >= 0),
  hod_approval_sample_count integer not null default 0 check (hod_approval_sample_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.claims_analytics_daily_stats (
  bucket_key text primary key,
  date_key date not null,
  status public.claim_status not null,
  department_id uuid references public.master_departments(id) on delete restrict,
  payment_mode_id uuid references public.master_payment_modes(id) on delete restrict,
  expense_category_id uuid references public.master_expense_categories(id) on delete restrict,
  product_id uuid references public.master_products(id) on delete restrict,
  assigned_l2_approver_id uuid references public.master_finance_approvers(id) on delete restrict,
  claim_count integer not null default 0 check (claim_count >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  hod_approval_hours_sum numeric(14,4) not null default 0 check (hod_approval_hours_sum >= 0),
  hod_approval_sample_count integer not null default 0 check (hod_approval_sample_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.claims_analytics_snapshot enable row level security;
alter table public.claims_analytics_daily_stats enable row level security;

create index if not exists idx_claims_analytics_daily_stats_date_key
  on public.claims_analytics_daily_stats (date_key desc);

create index if not exists idx_claims_analytics_daily_stats_status
  on public.claims_analytics_daily_stats (status);

create index if not exists idx_claims_analytics_daily_stats_department_date
  on public.claims_analytics_daily_stats (department_id, date_key desc);

create index if not exists idx_claims_analytics_daily_stats_payment_mode_date
  on public.claims_analytics_daily_stats (payment_mode_id, date_key desc);

create index if not exists idx_claims_analytics_daily_stats_expense_category_date
  on public.claims_analytics_daily_stats (expense_category_id, date_key desc);

create index if not exists idx_claims_analytics_daily_stats_product_date
  on public.claims_analytics_daily_stats (product_id, date_key desc);

create index if not exists idx_claims_analytics_daily_stats_finance_approver_date
  on public.claims_analytics_daily_stats (assigned_l2_approver_id, date_key desc);

create or replace function public.make_claims_analytics_bucket_key(
  p_date_key date,
  p_status public.claim_status,
  p_department_id uuid,
  p_payment_mode_id uuid,
  p_expense_category_id uuid,
  p_product_id uuid,
  p_assigned_l2_approver_id uuid
)
returns text
language sql
immutable
as $$
  select concat_ws(
    '|',
    to_char(p_date_key, 'YYYY-MM-DD'),
    p_status::text,
    coalesce(p_department_id::text, '__null__'),
    coalesce(p_payment_mode_id::text, '__null__'),
    coalesce(p_expense_category_id::text, '__null__'),
    coalesce(p_product_id::text, '__null__'),
    coalesce(p_assigned_l2_approver_id::text, '__null__')
  );
$$;

create or replace function public.apply_claims_analytics_delta(
  p_date_key date,
  p_status public.claim_status,
  p_department_id uuid,
  p_payment_mode_id uuid,
  p_expense_category_id uuid,
  p_product_id uuid,
  p_assigned_l2_approver_id uuid,
  p_claim_count_delta integer,
  p_total_amount_delta numeric,
  p_hod_approval_hours_delta numeric,
  p_hod_approval_sample_delta integer
)
returns void
language plpgsql
as $$
declare
  v_bucket_key text;
begin
  if p_date_key is null or p_status is null then
    return;
  end if;

  if coalesce(p_claim_count_delta, 0) = 0
     and coalesce(p_total_amount_delta, 0) = 0
     and coalesce(p_hod_approval_hours_delta, 0) = 0
     and coalesce(p_hod_approval_sample_delta, 0) = 0 then
    return;
  end if;

  v_bucket_key := public.make_claims_analytics_bucket_key(
    p_date_key,
    p_status,
    p_department_id,
    p_payment_mode_id,
    p_expense_category_id,
    p_product_id,
    p_assigned_l2_approver_id
  );

  update public.claims_analytics_daily_stats
  set
    claim_count = greatest(0, claim_count + coalesce(p_claim_count_delta, 0)),
    total_amount = greatest(
      0::numeric,
      round(total_amount + coalesce(p_total_amount_delta, 0), 2)
    ),
    hod_approval_hours_sum = greatest(
      0::numeric,
      round(hod_approval_hours_sum + coalesce(p_hod_approval_hours_delta, 0), 4)
    ),
    hod_approval_sample_count = greatest(
      0,
      hod_approval_sample_count + coalesce(p_hod_approval_sample_delta, 0)
    ),
    updated_at = now()
  where bucket_key = v_bucket_key;

  if not found then
    if coalesce(p_claim_count_delta, 0) > 0
       or coalesce(p_total_amount_delta, 0) > 0
       or coalesce(p_hod_approval_hours_delta, 0) > 0
       or coalesce(p_hod_approval_sample_delta, 0) > 0 then
      insert into public.claims_analytics_daily_stats (
        bucket_key,
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
        v_bucket_key,
        p_date_key,
        p_status,
        p_department_id,
        p_payment_mode_id,
        p_expense_category_id,
        p_product_id,
        p_assigned_l2_approver_id,
        greatest(0, coalesce(p_claim_count_delta, 0)),
        greatest(0::numeric, round(coalesce(p_total_amount_delta, 0), 2)),
        greatest(0::numeric, round(coalesce(p_hod_approval_hours_delta, 0), 4)),
        greatest(0, coalesce(p_hod_approval_sample_delta, 0)),
        now(),
        now()
      );
    end if;
  end if;

  delete from public.claims_analytics_daily_stats
  where bucket_key = v_bucket_key
    and claim_count = 0
    and total_amount = 0
    and hod_approval_hours_sum = 0
    and hod_approval_sample_count = 0;
end;
$$;

create or replace function public.refresh_claim_analytics_snapshot(p_claim_id text)
returns void
language plpgsql
as $$
declare
  v_claim record;
  v_hod_hours numeric(14,4);
  v_hod_samples integer;
begin
  if p_claim_id is null or btrim(p_claim_id) = '' then
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
    coalesce(ed.total_amount, ad.requested_amount, 0)::numeric(14,2) as total_amount
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

create or replace function public.trg_rollup_claims_analytics_snapshot()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_claims_analytics_delta(
      new.date_key,
      new.status,
      new.department_id,
      new.payment_mode_id,
      new.expense_category_id,
      new.product_id,
      new.assigned_l2_approver_id,
      new.claim_count,
      new.total_amount,
      new.hod_approval_hours_sum,
      new.hod_approval_sample_count
    );
    return null;
  end if;

  if tg_op = 'UPDATE' then
    perform public.apply_claims_analytics_delta(
      old.date_key,
      old.status,
      old.department_id,
      old.payment_mode_id,
      old.expense_category_id,
      old.product_id,
      old.assigned_l2_approver_id,
      -old.claim_count,
      -old.total_amount,
      -old.hod_approval_hours_sum,
      -old.hod_approval_sample_count
    );

    perform public.apply_claims_analytics_delta(
      new.date_key,
      new.status,
      new.department_id,
      new.payment_mode_id,
      new.expense_category_id,
      new.product_id,
      new.assigned_l2_approver_id,
      new.claim_count,
      new.total_amount,
      new.hod_approval_hours_sum,
      new.hod_approval_sample_count
    );

    return null;
  end if;

  perform public.apply_claims_analytics_delta(
    old.date_key,
    old.status,
    old.department_id,
    old.payment_mode_id,
    old.expense_category_id,
    old.product_id,
    old.assigned_l2_approver_id,
    -old.claim_count,
    -old.total_amount,
    -old.hod_approval_hours_sum,
    -old.hod_approval_sample_count
  );

  return null;
end;
$$;

create or replace function public.trg_refresh_claim_analytics_snapshot()
returns trigger
language plpgsql
as $$
declare
  v_claim_id text;
begin
  if tg_table_name = 'claims' then
    v_claim_id := coalesce(new.id, old.id);
  else
    v_claim_id := coalesce(new.claim_id, old.claim_id);
  end if;

  perform public.refresh_claim_analytics_snapshot(v_claim_id);

  return null;
end;
$$;

drop trigger if exists trg_claims_analytics_snapshot_rollup
  on public.claims_analytics_snapshot;

create trigger trg_claims_analytics_snapshot_rollup
after insert or update or delete
on public.claims_analytics_snapshot
for each row
execute function public.trg_rollup_claims_analytics_snapshot();

drop trigger if exists trg_claims_refresh_analytics_snapshot
  on public.claims;

create trigger trg_claims_refresh_analytics_snapshot
after insert or update or delete
on public.claims
for each row
execute function public.trg_refresh_claim_analytics_snapshot();

drop trigger if exists trg_expense_details_refresh_analytics_snapshot
  on public.expense_details;

create trigger trg_expense_details_refresh_analytics_snapshot
after insert or update or delete
on public.expense_details
for each row
execute function public.trg_refresh_claim_analytics_snapshot();

drop trigger if exists trg_advance_details_refresh_analytics_snapshot
  on public.advance_details;

create trigger trg_advance_details_refresh_analytics_snapshot
after insert or update or delete
on public.advance_details
for each row
execute function public.trg_refresh_claim_analytics_snapshot();

-- Rollback (manual)
-- drop trigger if exists trg_advance_details_refresh_analytics_snapshot on public.advance_details;
-- drop trigger if exists trg_expense_details_refresh_analytics_snapshot on public.expense_details;
-- drop trigger if exists trg_claims_refresh_analytics_snapshot on public.claims;
-- drop trigger if exists trg_claims_analytics_snapshot_rollup on public.claims_analytics_snapshot;
-- drop function if exists public.trg_refresh_claim_analytics_snapshot();
-- drop function if exists public.trg_rollup_claims_analytics_snapshot();
-- drop function if exists public.refresh_claim_analytics_snapshot(text);
-- drop function if exists public.apply_claims_analytics_delta(date, public.claim_status, uuid, uuid, uuid, uuid, uuid, integer, numeric, numeric, integer);
-- drop function if exists public.make_claims_analytics_bucket_key(date, public.claim_status, uuid, uuid, uuid, uuid, uuid);
-- drop table if exists public.claims_analytics_daily_stats;
-- drop table if exists public.claims_analytics_snapshot;
