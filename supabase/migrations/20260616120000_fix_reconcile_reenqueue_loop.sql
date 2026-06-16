-- Migration: fix_reconcile_reenqueue_loop
-- Bug: reconcile_verification_runs only treated queued/running/completed-non-superseded
-- runs as "covered", so a claim whose latest run FAILED was re-enqueued on every 5-min
-- sweep — a runaway loop (262 failed claims generated 4,549 rows in ~16h).
--
-- Fix: a FAILED run also counts as covered. Reconcile is a backstop for claims that
-- never got a run (best-effort trigger dropped), NOT a retry mechanism — finance has an
-- explicit "Re-run verification" action, and the worker already backs off transient
-- errors via next_attempt_at. A superseded failed run does NOT block (inputs changed,
-- so a fresh run is wanted).

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_verification_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_claim_id text;
  v_count    integer := 0;
BEGIN
  FOR v_claim_id IN
    SELECT c.id
    FROM   public.claims c
    WHERE  c.is_active = true
      AND  c.detail_type = 'expense'
      AND  c.status = 'HOD approved - Awaiting finance approval'::public.claim_status
      AND  NOT EXISTS (
             SELECT 1 FROM public.claim_verification_runs r
             WHERE  r.claim_id = c.id
               AND  r.superseded = false
               AND  r.status IN ('queued', 'running', 'completed', 'failed')
           )
  LOOP
    IF public.enqueue_verification_run(v_claim_id, 'l1_approved') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END
$$;

ALTER FUNCTION public.reconcile_verification_runs() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reconcile_verification_runs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reconcile_verification_runs() TO service_role;

COMMIT;
