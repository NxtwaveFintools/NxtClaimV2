-- Rollback: dual_duplicate_detection
-- Restores the invoice-first helper + the single-pair complete_verification_run,
-- removes the four new columns and the two CHECK constraints. The view is
-- recreated WITHOUT the four new columns.
BEGIN;

-- 1. Restore invoice-first helper (amount+date arm gated on invoice absent)
CREATE OR REPLACE FUNCTION public.find_claim_duplicates(
  p_exclude_claim_id text,
  p_bill_no          text,
  p_transaction_date date,
  p_total_amount     numeric
)
RETURNS TABLE (claim_id text, submitted_by uuid, match_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  WITH norm AS (SELECT public.normalize_invoice_no(p_bill_no) AS inv)
  SELECT c.id, c.submitted_by, 'invoice_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  CROSS JOIN norm
  WHERE norm.inv IS NOT NULL
    AND ed.is_active = true AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status)
    AND ed.claim_id <> p_exclude_claim_id
    AND public.normalize_invoice_no(ed.bill_no) = norm.inv
  UNION
  SELECT c.id, c.submitted_by, 'amount_date_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  CROSS JOIN norm
  WHERE norm.inv IS NULL
    AND p_transaction_date IS NOT NULL AND p_total_amount IS NOT NULL
    AND ed.is_active = true AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status)
    AND ed.claim_id <> p_exclude_claim_id
    AND ed.transaction_date = p_transaction_date
    AND ed.total_amount = p_total_amount;
$$;
ALTER FUNCTION public.find_claim_duplicates(text, text, date, numeric) OWNER TO postgres;

-- 2. Recreate the view without the four new columns
CREATE OR REPLACE VIEW public.claim_latest_verification
  WITH (security_invoker = on) AS
SELECT DISTINCT ON (r.claim_id)
  r.claim_id, r.id AS run_id, r.status, r.overall_verdict,
  r.created_at, r.finished_at, r.duplicate_status, r.duplicate_claim_ids
FROM public.claim_verification_runs r
WHERE r.superseded = false
ORDER BY r.claim_id, r.created_at DESC;
ALTER VIEW public.claim_latest_verification OWNER TO postgres;
GRANT SELECT ON public.claim_latest_verification TO authenticated, service_role;

-- 3. Restore the single-pair complete_verification_run
DROP FUNCTION IF EXISTS public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb);
CREATE OR REPLACE FUNCTION public.complete_verification_run(
  p_run_id uuid, p_overall_verdict text, p_model text, p_receipt_hash text,
  p_bank_hash text, p_duplicate_status text, p_duplicate_claim_ids text[], p_checks jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_ai_verifier_id uuid := '11111111-1111-4111-8111-111111111111';
  v_run public.claim_verification_runs%ROWTYPE;
  v_current_snap jsonb; v_superseded boolean;
BEGIN
  SELECT * INTO v_run FROM public.claim_verification_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'verification run % not found', p_run_id; END IF;
  v_current_snap := public.build_verification_snapshot(v_run.claim_id);
  v_superseded := v_run.superseded OR (v_current_snap IS DISTINCT FROM v_run.submitted_values_snapshot);
  UPDATE public.claim_verification_runs
  SET status='completed', overall_verdict=p_overall_verdict, model=p_model,
      receipt_file_hash=p_receipt_hash, bank_statement_file_hash=p_bank_hash,
      duplicate_status=coalesce(p_duplicate_status,'unavailable'),
      duplicate_claim_ids=coalesce(p_duplicate_claim_ids,'{}'),
      superseded=v_superseded, finished_at=now(), error_detail=NULL
  WHERE id=p_run_id;
  DELETE FROM public.claim_verification_checks WHERE run_id = p_run_id;
  INSERT INTO public.claim_verification_checks (
    run_id, field, lane, submitted_value, extracted_raw, extracted_normalized,
    verdict, hardness, confidence, tolerance_applied, mismatch_reason)
  SELECT p_run_id, c->>'field', coalesce(c->>'lane','receipt'),
    c->>'submitted_value', c->>'extracted_raw', c->>'extracted_normalized',
    c->>'verdict', coalesce(c->>'hardness','soft'),
    nullif(c->>'confidence','')::integer, c->>'tolerance_applied', c->>'mismatch_reason'
  FROM jsonb_array_elements(coalesce(p_checks,'[]'::jsonb)) AS c;
  IF NOT v_superseded THEN
    INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
    VALUES (v_run.claim_id, v_ai_verifier_id, 'AI_VERIFICATION_COMPLETED',
            format('AI verification: %s | duplicate: %s', p_overall_verdict,
                   coalesce(p_duplicate_status,'unavailable')));
  END IF;
END $$;
ALTER FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) TO service_role;

-- 4. Drop the four columns + their constraints
ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_invoice_duplicate_status_check,
  DROP CONSTRAINT IF EXISTS claim_verification_runs_amount_date_duplicate_status_check,
  DROP COLUMN IF EXISTS invoice_duplicate_status,
  DROP COLUMN IF EXISTS invoice_duplicate_claim_ids,
  DROP COLUMN IF EXISTS amount_date_duplicate_status,
  DROP COLUMN IF EXISTS amount_date_duplicate_claim_ids;

COMMIT;
