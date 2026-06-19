-- Migration: dual_duplicate_detection
-- Run BOTH duplicate arms independently (invoice AND amount+date), instead of
-- invoice-first-with-amount+date-fallback. Surface each arm separately.
--   * find_claim_duplicates(): amount+date arm no longer gated on invoice being absent.
--   * claim_verification_runs gains two typed column-pairs (one per arm). Legacy
--     duplicate_status / duplicate_claim_ids are KEPT (avoids view cascade) but unused.
--   * claim_latest_verification view APPENDS the four new columns.
--   * complete_verification_run() takes the four new params (one write per run).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper: both arms always run (drop the `norm.inv IS NULL` gate on arm 2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_claim_duplicates(
  p_exclude_claim_id text,
  p_bill_no          text,
  p_transaction_date date,
  p_total_amount     numeric
)
RETURNS TABLE (claim_id text, submitted_by uuid, match_kind text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH norm AS (SELECT public.normalize_invoice_no(p_bill_no) AS inv)
  -- invoice present → invoice match (any submitter)
  SELECT c.id, c.submitted_by, 'invoice_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  CROSS JOIN norm
  WHERE norm.inv IS NOT NULL
    AND ed.is_active = true
    AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status
    )
    AND ed.claim_id <> p_exclude_claim_id
    AND public.normalize_invoice_no(ed.bill_no) = norm.inv
  UNION
  -- amount + date match (runs regardless of invoice presence)
  SELECT c.id, c.submitted_by, 'amount_date_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  WHERE p_transaction_date IS NOT NULL
    AND p_total_amount IS NOT NULL
    AND ed.is_active = true
    AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status
    )
    AND ed.claim_id <> p_exclude_claim_id
    AND ed.transaction_date = p_transaction_date
    AND ed.total_amount = p_total_amount;
$$;

ALTER FUNCTION public.find_claim_duplicates(text, text, date, numeric) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 2. Two typed column-pairs on the run (legacy columns kept untouched)
-- ---------------------------------------------------------------------------
ALTER TABLE public.claim_verification_runs
  ADD COLUMN IF NOT EXISTS invoice_duplicate_status        text   NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS invoice_duplicate_claim_ids     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS amount_date_duplicate_status    text   NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS amount_date_duplicate_claim_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_invoice_duplicate_status_check;
ALTER TABLE public.claim_verification_runs
  ADD CONSTRAINT claim_verification_runs_invoice_duplicate_status_check
  CHECK (invoice_duplicate_status = ANY (ARRAY['none', 'match', 'unavailable']));

ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_amount_date_duplicate_status_check;
ALTER TABLE public.claim_verification_runs
  ADD CONSTRAINT claim_verification_runs_amount_date_duplicate_status_check
  CHECK (amount_date_duplicate_status = ANY (ARRAY['none', 'match', 'unavailable']));

-- ---------------------------------------------------------------------------
-- 3. View: APPEND the four new columns at the end (append-only; 42P16 on reorder)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claim_latest_verification
  WITH (security_invoker = on) AS
SELECT DISTINCT ON (r.claim_id)
  r.claim_id,
  r.id              AS run_id,
  r.status,
  r.overall_verdict,
  r.created_at,
  r.finished_at,
  r.duplicate_status,
  r.duplicate_claim_ids,
  r.invoice_duplicate_status,
  r.invoice_duplicate_claim_ids,
  r.amount_date_duplicate_status,
  r.amount_date_duplicate_claim_ids
FROM public.claim_verification_runs r
WHERE r.superseded = false
ORDER BY r.claim_id, r.created_at DESC;

ALTER VIEW public.claim_latest_verification OWNER TO postgres;
GRANT SELECT ON public.claim_latest_verification TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. complete_verification_run(): four new params replace the single pair
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb);

CREATE OR REPLACE FUNCTION public.complete_verification_run(
  p_run_id          uuid,
  p_overall_verdict text,
  p_model           text,
  p_receipt_hash    text,
  p_bank_hash       text,
  p_invoice_duplicate_status     text,
  p_invoice_duplicate_claim_ids  text[],
  p_amount_date_duplicate_status text,
  p_amount_date_duplicate_claim_ids text[],
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
  SELECT * INTO v_run FROM public.claim_verification_runs WHERE id = p_run_id FOR UPDATE;
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
         invoice_duplicate_status = coalesce(p_invoice_duplicate_status, 'unavailable'),
         invoice_duplicate_claim_ids = coalesce(p_invoice_duplicate_claim_ids, '{}'),
         amount_date_duplicate_status = coalesce(p_amount_date_duplicate_status, 'unavailable'),
         amount_date_duplicate_claim_ids = coalesce(p_amount_date_duplicate_claim_ids, '{}'),
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
    p_run_id, c->>'field', coalesce(c->>'lane', 'receipt'),
    c->>'submitted_value', c->>'extracted_raw', c->>'extracted_normalized',
    c->>'verdict', coalesce(c->>'hardness', 'soft'),
    nullif(c->>'confidence', '')::integer, c->>'tolerance_applied', c->>'mismatch_reason'
  FROM jsonb_array_elements(coalesce(p_checks, '[]'::jsonb)) AS c;

  IF NOT v_superseded THEN
    INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
    VALUES (v_run.claim_id, v_ai_verifier_id, 'AI_VERIFICATION_COMPLETED',
            format('AI verification: %s | invoice dup: %s | amount+date dup: %s',
                   p_overall_verdict,
                   coalesce(p_invoice_duplicate_status, 'unavailable'),
                   coalesce(p_amount_date_duplicate_status, 'unavailable')));
  END IF;
END
$$;

ALTER FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 5. Grants (mirror existing posture)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.find_claim_duplicates(text, text, date, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.find_claim_duplicates(text, text, date, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb) TO service_role;

COMMIT;
