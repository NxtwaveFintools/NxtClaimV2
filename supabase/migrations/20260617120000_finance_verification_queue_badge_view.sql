-- Migration: finance_verification_queue_badge_view
-- Backs the finance-queue AI-verdict count chips + server-side verdict filter.
-- One row per claim currently in the finance verification queue (active expense,
-- HOD-approved-awaiting-finance), with its derived badge state. Centralizes the
-- badge derivation in SQL so the counts and the filter can never disagree.

BEGIN;

CREATE OR REPLACE VIEW public.finance_verification_queue_badge
  WITH (security_invoker = on) AS
SELECT
  c.id AS claim_id,
  CASE
    WHEN clv.claim_id IS NULL THEN 'pending'                       -- in queue, no run yet
    WHEN clv.status IN ('queued', 'running') THEN 'pending'
    WHEN clv.overall_verdict IN (
      'verified', 'mismatch', 'statement_mismatch', 'needs_review', 'no_document'
    ) THEN clv.overall_verdict
    ELSE 'extraction_failed'
  END AS badge_state
FROM public.claims c
LEFT JOIN public.claim_latest_verification clv ON clv.claim_id = c.id
WHERE c.is_active = true
  AND c.detail_type = 'expense'
  AND c.status = 'HOD approved - Awaiting finance approval'::public.claim_status;

ALTER VIEW public.finance_verification_queue_badge OWNER TO postgres;

GRANT SELECT ON public.finance_verification_queue_badge TO authenticated, service_role;

COMMIT;
