-- Performance: make submitted_on range filters sargable against the enterprise dashboard view.
create index concurrently if not exists idx_claims_dashboard_active_submitted_on_expr
  on public.claims using btree ((coalesce(submitted_at, created_at)))
  where is_active = true;

-- Rollback (manual):
-- drop index concurrently if exists public.idx_claims_dashboard_active_submitted_on_expr;
