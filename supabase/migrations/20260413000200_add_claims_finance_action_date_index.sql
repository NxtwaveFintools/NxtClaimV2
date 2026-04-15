-- Add concurrent btree index for finance action-date filtering on claims.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_finance_action_at
  ON public.claims USING btree (finance_action_at);

-- Rollback (manual):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_claims_finance_action_at;
