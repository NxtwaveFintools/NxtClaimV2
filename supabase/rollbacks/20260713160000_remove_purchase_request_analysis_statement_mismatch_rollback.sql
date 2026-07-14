BEGIN;

ALTER TABLE public.purchase_request_analyses
  DROP CONSTRAINT IF EXISTS purchase_request_analyses_overall_status_check;

ALTER TABLE public.purchase_request_analyses
  ADD CONSTRAINT purchase_request_analyses_overall_status_check CHECK (
    overall_status IN (
      'verified', 'needs_review', 'mismatch',
      'statement_mismatch', 'extraction_failed', 'no_document'
    )
  );

COMMIT;
