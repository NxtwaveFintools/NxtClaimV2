BEGIN;

-- Backfills a stale migration file: 'statement_mismatch' was dropped as an
-- overall_status value (bank-detail mismatches are warning-only field_validations
-- now, never escalating overall_status) and this constraint change had already
-- been applied directly to the database, but was never captured as a migration
-- file until now -- so a fresh DB replay would have recreated the wrong,
-- 6-value constraint. This migration makes the file match reality.

UPDATE public.purchase_request_analyses
SET overall_status = 'verified'
WHERE overall_status = 'statement_mismatch';

ALTER TABLE public.purchase_request_analyses
  DROP CONSTRAINT IF EXISTS purchase_request_analyses_overall_status_check;

ALTER TABLE public.purchase_request_analyses
  ADD CONSTRAINT purchase_request_analyses_overall_status_check CHECK (
    overall_status IN (
      'verified', 'needs_review', 'mismatch', 'extraction_failed', 'no_document'
    )
  );

COMMIT;
