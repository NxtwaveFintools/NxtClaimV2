-- Migration: lane2_bank_statement_verification
-- Adds Lane 2 (bank-statement vs submitted amount/date) to the verification ledger.
-- Lane 1 (receipt) shipped in 20260615130000; this extends the same tables/worker.
--
--   * claim_verification_runs gains bank_statement_file_path + _hash (mirrors receipt).
--   * overall_verdict gains 'statement_mismatch'.
--   * claim_verification_checks gains a `lane` column ('receipt' | 'bank_statement')
--     so the panel can group receipt checks vs statement checks.
--   * enqueue_verification_run now also captures the bank statement path on the run.
--
-- No FX in v1.1 (same as Lane 1): statement amounts compared in document currency.

BEGIN;

-- 1. Bank statement evidence columns on the run -----------------------------
ALTER TABLE public.claim_verification_runs
  ADD COLUMN IF NOT EXISTS bank_statement_file_path text,
  ADD COLUMN IF NOT EXISTS bank_statement_file_hash text;

-- 2. New overall verdict: statement_mismatch --------------------------------
ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_verdict_check;
ALTER TABLE public.claim_verification_runs
  ADD CONSTRAINT claim_verification_runs_verdict_check
  CHECK (overall_verdict IS NULL OR overall_verdict = ANY (ARRAY[
    'verified', 'mismatch', 'statement_mismatch', 'needs_review',
    'extraction_failed', 'no_document']));

-- 3. Lane marker on each per-field check ------------------------------------
ALTER TABLE public.claim_verification_checks
  ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'receipt';
ALTER TABLE public.claim_verification_checks
  DROP CONSTRAINT IF EXISTS claim_verification_checks_lane_check;
ALTER TABLE public.claim_verification_checks
  ADD CONSTRAINT claim_verification_checks_lane_check
  CHECK (lane = ANY (ARRAY['receipt', 'bank_statement']));

-- 4. Capture the bank statement path at enqueue time ------------------------
CREATE OR REPLACE FUNCTION public.enqueue_verification_run(
  p_claim_id text,
  p_trigger  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_snapshot      jsonb;
  v_receipt_path  text;
  v_bank_path     text;
  v_run_id        uuid;
BEGIN
  v_snapshot := public.build_verification_snapshot(p_claim_id);
  IF v_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ed.receipt_file_path, ed.bank_statement_file_path
  INTO   v_receipt_path, v_bank_path
  FROM   public.expense_details ed
  WHERE  ed.claim_id = p_claim_id AND ed.is_active = true
  LIMIT  1;

  UPDATE public.claim_verification_runs
  SET    superseded = true
  WHERE  claim_id = p_claim_id
    AND  status IN ('queued', 'running')
    AND  superseded = false;

  INSERT INTO public.claim_verification_runs (
    claim_id, trigger, status,
    receipt_file_path, bank_statement_file_path,
    submitted_values_snapshot
  )
  VALUES (
    p_claim_id, p_trigger, 'queued',
    v_receipt_path, v_bank_path,
    v_snapshot
  )
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END
$$;

ALTER FUNCTION public.enqueue_verification_run(text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.enqueue_verification_run(text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_verification_run(text, text) TO service_role;

-- 5. complete_verification_run: store bank hash + per-check lane -------------
-- Signature changes (adds p_bank_hash), so drop the old 5-arg version first.
DROP FUNCTION IF EXISTS public.complete_verification_run(uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.complete_verification_run(
  p_run_id          uuid,
  p_overall_verdict text,
  p_model           text,
  p_receipt_hash    text,
  p_bank_hash       text,
  p_checks          jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_ai_verifier_id uuid := '11111111-1111-4111-8111-111111111111';
  v_run            public.claim_verification_runs%ROWTYPE;
  v_current_snap   jsonb;
  v_superseded     boolean;
BEGIN
  SELECT * INTO v_run
  FROM public.claim_verification_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification run % not found', p_run_id;
  END IF;

  v_current_snap := public.build_verification_snapshot(v_run.claim_id);
  v_superseded := v_run.superseded
                  OR (v_current_snap IS DISTINCT FROM v_run.submitted_values_snapshot);

  UPDATE public.claim_verification_runs
  SET    status = 'completed',
         overall_verdict = p_overall_verdict,
         model = p_model,
         receipt_file_hash = p_receipt_hash,
         bank_statement_file_hash = p_bank_hash,
         superseded = v_superseded,
         finished_at = now(),
         error_detail = NULL
  WHERE  id = p_run_id;

  DELETE FROM public.claim_verification_checks WHERE run_id = p_run_id;

  INSERT INTO public.claim_verification_checks (
    run_id, field, lane, submitted_value, extracted_raw, extracted_normalized,
    verdict, hardness, confidence, tolerance_applied, mismatch_reason
  )
  SELECT
    p_run_id,
    c->>'field',
    coalesce(c->>'lane', 'receipt'),
    c->>'submitted_value',
    c->>'extracted_raw',
    c->>'extracted_normalized',
    c->>'verdict',
    coalesce(c->>'hardness', 'soft'),
    nullif(c->>'confidence', '')::integer,
    c->>'tolerance_applied',
    c->>'mismatch_reason'
  FROM jsonb_array_elements(coalesce(p_checks, '[]'::jsonb)) AS c;

  IF NOT v_superseded THEN
    INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
    VALUES (
      v_run.claim_id, v_ai_verifier_id, 'AI_VERIFICATION_COMPLETED',
      format('AI verification: %s', p_overall_verdict)
    );
  END IF;
END
$$;

ALTER FUNCTION public.complete_verification_run(uuid, text, text, text, text, jsonb) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, jsonb) TO service_role;

COMMIT;
