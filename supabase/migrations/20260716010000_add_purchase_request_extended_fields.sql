BEGIN;

-- BC shared an updated PR field spec (service period, place of supply,
-- CGST/SGST/IGST tax breakup, and per-line line items) beyond what this table
-- and the submission endpoint currently handle. This migration only adds the
-- storage for those fields -- the request validator/repository/route are
-- deliberately left untouched in this pass, so these columns/table sit unused
-- until a follow-up wires up parsing and persistence.

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS service_start_date DATE,
  ADD COLUMN IF NOT EXISTS service_end_date DATE,
  ADD COLUMN IF NOT EXISTS budget_period TEXT,
  ADD COLUMN IF NOT EXISTS pos_as_in_vendor_state TEXT,
  ADD COLUMN IF NOT EXISTS total_amount_including_gst NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS cgst_percentage NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS sgst_percentage NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS igst_percentage NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(15, 2);

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_pos_state_length_check
    CHECK (pos_as_in_vendor_state IS NULL OR char_length(pos_as_in_vendor_state) = 2),
  ADD CONSTRAINT purchase_requests_service_period_order_check
    CHECK (service_start_date IS NULL OR service_end_date IS NULL OR service_start_date <= service_end_date);

-- Line items: a PR can carry multiple lines, so this is a one-to-many table,
-- matching the existing purchase_request_attachments pattern rather than a
-- JSONB blob on purchase_requests.

CREATE TABLE IF NOT EXISTS public.purchase_request_lines (
  id                            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_request_id           UUID        NOT NULL REFERENCES public.purchase_requests (id) ON DELETE CASCADE,
  line_no                       INTEGER     NOT NULL,
  description                   TEXT        NOT NULL,
  gst_group_code                TEXT,
  program_code                  TEXT,
  responsible_dept              TEXT,
  beneficiary_code              TEXT,
  region_code                   TEXT,
  subproduct                    TEXT,
  qty                            NUMERIC(15, 2),
  direct_unit_cost_excl_vat     NUMERIC(15, 2),
  line_amount_excluding_vat     NUMERIC(15, 2),
  fixed_asset_description       TEXT,
  fixed_asset_fa_class_code     TEXT,
  fixed_asset_fa_subclass_code  TEXT,
  depreciation_start_date       DATE,
  no_of_depreciation_years      INTEGER,
  depreciation_end_date         DATE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchase_request_lines_pr_id_line_no_key UNIQUE (purchase_request_id, line_no),
  CONSTRAINT purchase_request_lines_qty_positive_check
    CHECK (qty IS NULL OR qty > 0),
  CONSTRAINT purchase_request_lines_unit_cost_positive_check
    CHECK (direct_unit_cost_excl_vat IS NULL OR direct_unit_cost_excl_vat > 0),
  CONSTRAINT purchase_request_lines_amount_positive_check
    CHECK (line_amount_excluding_vat IS NULL OR line_amount_excluding_vat > 0),
  CONSTRAINT purchase_request_lines_depreciation_years_check
    CHECK (no_of_depreciation_years IS NULL OR (no_of_depreciation_years > 0 AND no_of_depreciation_years <= 50)),
  CONSTRAINT purchase_request_lines_depreciation_period_order_check
    CHECK (depreciation_start_date IS NULL OR depreciation_end_date IS NULL OR depreciation_start_date <= depreciation_end_date)
);

CREATE INDEX IF NOT EXISTS idx_purchase_request_lines_pr_id
  ON public.purchase_request_lines (purchase_request_id);

ALTER TABLE public.purchase_request_lines ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.purchase_request_lines TO service_role;

COMMIT;
