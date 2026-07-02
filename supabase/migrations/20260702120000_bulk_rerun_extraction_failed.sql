-- Migration: bulk_rerun_extraction_failed
-- One-click bulk re-queue of every extraction-failed claim in the finance queue.
-- Targets come from finance_verification_queue_badge — the same view that drives
-- the AI-check chip counts — so the set re-queued always matches the count the
-- finance approver is looking at. Enqueueing goes through the existing
-- enqueue_verification_run, which supersedes queued/running runs first, making
-- this idempotent under double-clicks.

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_rerun_extraction_failed(
  p_actor_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_claim_id text;
  v_run_id   uuid;
  v_count    integer := 0;
BEGIN
  FOR v_claim_id IN
    SELECT claim_id
    FROM public.finance_verification_queue_badge
    WHERE badge_state = 'extraction_failed'
  LOOP
    v_run_id := public.enqueue_verification_run(v_claim_id, 'manual_rerun');
    IF v_run_id IS NOT NULL THEN
      INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
      VALUES (v_claim_id, p_actor_id, 'AI_VERIFICATION_RERUN', 'Manual re-run requested (bulk)');
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END
$$;

ALTER FUNCTION public.bulk_rerun_extraction_failed(uuid) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.bulk_rerun_extraction_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_rerun_extraction_failed(uuid) TO service_role;

COMMIT;
