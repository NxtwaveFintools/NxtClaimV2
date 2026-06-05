-- Rollback: soft_flag_suspected_duplicates
-- Removes the suspected_duplicate_ids column, the sync RPC, and its support index.
-- Run ONLY if rolling back migration 20260526000000_soft_flag_suspected_duplicates.sql.

BEGIN;

DROP FUNCTION IF EXISTS public.sync_duplicate_flags(text, text, date);

DROP INDEX IF EXISTS public.idx_expense_details_dup_lookup;

ALTER TABLE public.expense_details
  DROP COLUMN IF EXISTS suspected_duplicate_ids;

COMMIT;
