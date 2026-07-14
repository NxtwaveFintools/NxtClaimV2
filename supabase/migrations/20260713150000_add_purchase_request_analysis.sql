BEGIN;

-- Second endpoint of the BC integration: AI analysis of a PR's attachments
-- (Gemini 3.5 Flash, 17-check validation). One row per analysis run; a PR can
-- be re-analyzed (e.g. after a fix), so this is append-only, not upserted.
-- analyzed_attachment_id is nullable because extraction_failed/no_document
-- outcomes may not resolve to any specific attachment.

CREATE TABLE IF NOT EXISTS public.purchase_request_analyses (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_request_id    UUID        NOT NULL REFERENCES public.purchase_requests (id) ON DELETE CASCADE,
  analyzed_attachment_id UUID        REFERENCES public.purchase_request_attachments (id) ON DELETE SET NULL,
  analysis_id            TEXT        NOT NULL UNIQUE,
  overall_status         TEXT        NOT NULL CHECK (
                            overall_status IN (
                              'verified', 'needs_review', 'mismatch',
                              'statement_mismatch', 'extraction_failed', 'no_document'
                            )
                          ),
  confidence_score       NUMERIC(5, 1) NOT NULL,
  document_summary       TEXT        NOT NULL,
  field_validations      JSONB       NOT NULL,
  remarks                TEXT        NOT NULL,
  model                  TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_request_analyses_pr_id
  ON public.purchase_request_analyses (purchase_request_id, created_at DESC);

ALTER TABLE public.purchase_request_analyses ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.purchase_request_analyses TO service_role;

COMMIT;
