-- Hardening: Add covering FK indexes for analytics snapshot and lock function search_path.

create index if not exists idx_claims_analytics_snapshot_department_id
  on public.claims_analytics_snapshot (department_id);

create index if not exists idx_claims_analytics_snapshot_payment_mode_id
  on public.claims_analytics_snapshot (payment_mode_id);

create index if not exists idx_claims_analytics_snapshot_expense_category_id
  on public.claims_analytics_snapshot (expense_category_id);

create index if not exists idx_claims_analytics_snapshot_product_id
  on public.claims_analytics_snapshot (product_id);

create index if not exists idx_claims_analytics_snapshot_assigned_l2_approver_id
  on public.claims_analytics_snapshot (assigned_l2_approver_id);

alter function public.make_claims_analytics_bucket_key(
  date,
  public.claim_status,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
)
  set search_path = public;

alter function public.apply_claims_analytics_delta(
  date,
  public.claim_status,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  integer,
  numeric,
  numeric,
  integer
)
  set search_path = public;

alter function public.refresh_claim_analytics_snapshot(text)
  set search_path = public;

alter function public.trg_rollup_claims_analytics_snapshot()
  set search_path = public;

alter function public.trg_refresh_claim_analytics_snapshot()
  set search_path = public;

alter function public.rebuild_claims_analytics_cache()
  set search_path = public;

-- Rollback (manual)
-- alter function public.make_claims_analytics_bucket_key(date, public.claim_status, uuid, uuid, uuid, uuid, uuid) reset search_path;
-- alter function public.apply_claims_analytics_delta(date, public.claim_status, uuid, uuid, uuid, uuid, uuid, integer, numeric, numeric, integer) reset search_path;
-- alter function public.refresh_claim_analytics_snapshot(text) reset search_path;
-- alter function public.trg_rollup_claims_analytics_snapshot() reset search_path;
-- alter function public.trg_refresh_claim_analytics_snapshot() reset search_path;
-- alter function public.rebuild_claims_analytics_cache() reset search_path;
-- drop index if exists public.idx_claims_analytics_snapshot_assigned_l2_approver_id;
-- drop index if exists public.idx_claims_analytics_snapshot_product_id;
-- drop index if exists public.idx_claims_analytics_snapshot_expense_category_id;
-- drop index if exists public.idx_claims_analytics_snapshot_payment_mode_id;
-- drop index if exists public.idx_claims_analytics_snapshot_department_id;
