-- Migration: dedup_helper_and_run_duplicate_status
-- Invoice-first duplicate detection (design 20260617-144208):
--   * IMMUTABLE normalize_invoice_no() — sentinel→null, strip case/punctuation.
--   * ONE dedup helper find_claim_duplicates() — called by BOTH the create/edit RPCs
--     (submitted values, submitter-scoped hard reject) and the worker (extracted values,
--     finance-stage graded status). Returns matched claim ids + submitter + match kind;
--     callers apply their own scoping.
--   * duplicate_status + duplicate_claim_ids on claim_verification_runs (orthogonal to the
--     verify verdict), surfaced on the latest-verification view.
--   * complete_verification_run() gains the two duplicate params (one write per run).
--
-- The backstop unique index swap is a SEPARATE migration (20260617161000) so a
-- historical-collision failure can't roll back this schema.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Normalizer (IMMUTABLE so it's indexable + usable in the helper)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_invoice_no(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN lower(btrim(p_value)) IN ('', '-', 'n/a', 'na', 'none', 'null') THEN NULL
    WHEN regexp_replace(upper(p_value), '[^A-Z0-9]', '', 'g') = '' THEN NULL
    ELSE regexp_replace(upper(p_value), '[^A-Z0-9]', '', 'g')
  END;
$$;

ALTER FUNCTION public.normalize_invoice_no(text) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 2. Dedup helper — invoice-first, amount+date fallback.
-- ---------------------------------------------------------------------------
-- Returns one row per matching OTHER claim. match_kind:
--   'invoice_match'      — normalized invoice equals (invoice present)
--   'amount_date_match'  — invoice absent; transaction_date + total_amount equal
-- Scope: active, non-rejected claims (paid/closed INCLUDED), excluding p_exclude_claim_id.
-- Callers scope further: the create RPC keeps only invoice_match for the SAME submitter;
-- the worker takes the strongest match across all submitters.
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
  -- invoice absent → amount + date match
  SELECT c.id, c.submitted_by, 'amount_date_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  CROSS JOIN norm
  WHERE norm.inv IS NULL
    AND p_transaction_date IS NOT NULL
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

-- Accelerate the amount+date arm and the normalized-invoice probe.
CREATE INDEX IF NOT EXISTS idx_expense_details_dedup_amount_date
  ON public.expense_details (transaction_date, total_amount) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_expense_details_norm_invoice
  ON public.expense_details (public.normalize_invoice_no(bill_no)) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 3. Duplicate status on the run + exposure on the latest-verification view
-- ---------------------------------------------------------------------------
ALTER TABLE public.claim_verification_runs
  ADD COLUMN IF NOT EXISTS duplicate_status text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS duplicate_claim_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_duplicate_status_check;
ALTER TABLE public.claim_verification_runs
  ADD CONSTRAINT claim_verification_runs_duplicate_status_check
  CHECK (duplicate_status = ANY (ARRAY[
    'none', 'invoice_match', 'amount_date_match', 'unavailable']));

-- CREATE OR REPLACE VIEW can only APPEND columns at the end (it cannot insert
-- in the middle or rename existing positions — SQLSTATE 42P16). The duplicate_*
-- columns therefore go AFTER finished_at. A dependent view (20260617120000)
-- LEFT JOINs this one, so a DROP+CREATE would cascade — reorder instead.
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
  r.duplicate_claim_ids
FROM public.claim_verification_runs r
WHERE r.superseded = false
ORDER BY r.claim_id, r.created_at DESC;

ALTER VIEW public.claim_latest_verification OWNER TO postgres;
GRANT SELECT ON public.claim_latest_verification TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. complete_verification_run() gains the duplicate params (8-arg)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_verification_run(uuid, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.complete_verification_run(
  p_run_id          uuid,
  p_overall_verdict text,
  p_model           text,
  p_receipt_hash    text,
  p_bank_hash       text,
  p_duplicate_status text,
  p_duplicate_claim_ids text[],
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
         duplicate_status = coalesce(p_duplicate_status, 'unavailable'),
         duplicate_claim_ids = coalesce(p_duplicate_claim_ids, '{}'),
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
            format('AI verification: %s | duplicate: %s', p_overall_verdict,
                   coalesce(p_duplicate_status, 'unavailable')));
  END IF;
END
$$;

ALTER FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 5. Grants (service_role only, mirrors the rest of the ledger)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.find_claim_duplicates(text, text, date, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.find_claim_duplicates(text, text, date, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) TO service_role;
-- normalize_invoice_no is pure/safe; allow authenticated (used in views/indexes).
GRANT  EXECUTE ON FUNCTION public.normalize_invoice_no(text) TO authenticated, service_role;

COMMIT;
