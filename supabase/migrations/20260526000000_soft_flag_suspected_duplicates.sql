-- Migration: soft_flag_suspected_duplicates
-- Adds suspected_duplicate_ids array to expense_details, a sync RPC, and a historical backfill.
-- DOES NOT touch or drop uq_expense_details_active_bill or any existing constraint.

BEGIN;

-- 1. New column
ALTER TABLE public.expense_details
  ADD COLUMN IF NOT EXISTS suspected_duplicate_ids text[] NOT NULL DEFAULT '{}';

-- 2. RPC: atomically syncs bidirectional duplicate arrays for one claim.
--    Clears stale back-references first (handles Finance edits that change bill_no or date),
--    then writes fresh bidirectional links for the new bill_no + transaction_date.
CREATE OR REPLACE FUNCTION public.sync_duplicate_flags(
  p_claim_id text,
  p_bill_no  text,
  p_transaction_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match       RECORD;
  v_matched_ids text[] := '{}';
BEGIN
  -- Remove p_claim_id from any claim that currently references it
  UPDATE public.expense_details
  SET    suspected_duplicate_ids = array_remove(suspected_duplicate_ids, p_claim_id)
  WHERE  p_claim_id = ANY(suspected_duplicate_ids)
    AND  claim_id   != p_claim_id
    AND  is_active  = true;

  -- Find all active peers with the same bill_no + transaction_date
  FOR v_match IN
    SELECT claim_id
    FROM   public.expense_details
    WHERE  bill_no           = p_bill_no
      AND  transaction_date  = p_transaction_date
      AND  claim_id          != p_claim_id
      AND  is_active         = true
  LOOP
    -- Add p_claim_id into each peer's array (deduplicated)
    UPDATE public.expense_details
    SET    suspected_duplicate_ids =
             array_remove(suspected_duplicate_ids, p_claim_id) || ARRAY[p_claim_id]
    WHERE  claim_id  = v_match.claim_id
      AND  is_active = true;

    v_matched_ids := v_matched_ids || ARRAY[v_match.claim_id];
  END LOOP;

  -- Overwrite this claim's array with all current peer IDs
  UPDATE public.expense_details
  SET    suspected_duplicate_ids = v_matched_ids
  WHERE  claim_id  = p_claim_id
    AND  is_active = true;
END;
$$;

-- Revoke anon execute, consistent with codebase security posture
REVOKE EXECUTE ON FUNCTION public.sync_duplicate_flags(text, text, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_duplicate_flags(text, text, date) TO   service_role;

-- Index to accelerate RPC lookups and the historical backfill
CREATE INDEX IF NOT EXISTS idx_expense_details_dup_lookup
  ON public.expense_details (bill_no, transaction_date)
  WHERE is_active = true;

-- 3. Historical backfill: link all existing pairs that share bill_no + transaction_date
UPDATE public.expense_details AS target
SET    suspected_duplicate_ids = agg.other_ids
FROM (
  SELECT
    a.claim_id,
    array_agg(DISTINCT b.claim_id ORDER BY b.claim_id) AS other_ids
  FROM  public.expense_details a
  JOIN  public.expense_details b
    ON  a.bill_no          = b.bill_no
    AND a.transaction_date = b.transaction_date
    AND a.claim_id         != b.claim_id
    AND b.is_active        = true
  WHERE a.is_active = true
  GROUP BY a.claim_id
) agg
WHERE target.claim_id = agg.claim_id
  AND target.is_active = true;

COMMIT;
