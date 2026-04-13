-- Add concurrent btree index for HOD action-date filtering on claims.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_hod_action_at
  ON public.claims USING btree (hod_action_at);

-- Rollback (manual):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_claims_hod_action_at;
