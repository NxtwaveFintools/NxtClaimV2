-- Rollback for: 20260513100000_create_bc_claim_vendors.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

DROP TRIGGER IF EXISTS trg_bc_claim_vendors_set_updated_at
  ON public.bc_claim_vendors;

DROP FUNCTION IF EXISTS public.bc_claim_vendors_set_updated_at();

DROP TABLE IF EXISTS public.bc_claim_vendors;

COMMIT;