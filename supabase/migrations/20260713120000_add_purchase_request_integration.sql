BEGIN;

-- Purchase Request (PR) Document Validation integration: first endpoint of a
-- multi-endpoint integration between Dynamics 365 Business Central and this
-- portal. api_keys scopes each BC client to a company; purchase_requests
-- stores the PR + attachment metadata BC submits, pending AI analysis
-- (a later feature). Both tables are service-role only — no end user of
-- this app reads or writes them, so RLS is enabled with no policies and
-- only service_role is granted access.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_hash   TEXT        NOT NULL UNIQUE,
  label      TEXT        NOT NULL,
  company_id TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.api_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id                       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id               UUID        NOT NULL REFERENCES public.api_keys (id) ON DELETE RESTRICT,
  pr_id                    TEXT        NOT NULL UNIQUE,
  request_date             DATE        NOT NULL,
  vendor_code               TEXT        NOT NULL,
  vendor_name               TEXT        NOT NULL,
  vendor_gstin               TEXT        NOT NULL,
  company_gstin              TEXT        NOT NULL,
  department                TEXT,
  pr_type                   TEXT        NOT NULL CHECK (pr_type IN ('Invoice', 'Quotation')),
  vendor_invoice_number      TEXT        NOT NULL,
  document_date              DATE        NOT NULL,
  direct_unit_cost           NUMERIC(15, 2) NOT NULL,
  gst_percentage              INTEGER     NOT NULL CHECK (gst_percentage IN (5, 12, 18, 28)),
  gst_amount                  NUMERIC(15, 2) NOT NULL,
  purchase_request_amount     NUMERIC(15, 2) NOT NULL,
  description                 TEXT        NOT NULL CHECK (char_length(description) >= 10),
  bank_account_number          TEXT,
  bank_ifsc                    TEXT,
  bank_name                    TEXT,
  attachment_file_name         TEXT        NOT NULL,
  attachment_storage_path      TEXT        NOT NULL,
  attachment_content_type      TEXT        NOT NULL,
  attachment_size_bytes        INTEGER     NOT NULL,
  status                       TEXT        NOT NULL DEFAULT 'pending_analysis'
                                 CHECK (status IN ('pending_analysis', 'analyzing', 'analyzed')),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_pr_id ON public.purchase_requests (pr_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_vendor_gstin ON public.purchase_requests (vendor_gstin);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_api_key_created_at
  ON public.purchase_requests (api_key_id, created_at);

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.purchase_requests TO service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('purchase-request-attachments', 'purchase-request-attachments', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
