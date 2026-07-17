BEGIN;

-- Approval-sequence data arrives later, via a separate API call keyed by pr_id
-- (not at initial PR submission time) -- a different system tracks the multi-step
-- approval chain and pushes updates back to this table as each step completes.
-- All nullable/free-text: no enum constraint since the exact values that system
-- will send aren't known yet.

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS sequence_1_approval TEXT,
  ADD COLUMN IF NOT EXISTS sequence_2_approval TEXT,
  ADD COLUMN IF NOT EXISTS sequence_3_approval TEXT,
  ADD COLUMN IF NOT EXISTS sequence_4_approval TEXT,
  ADD COLUMN IF NOT EXISTS sequence_5_approval TEXT;

COMMIT;
