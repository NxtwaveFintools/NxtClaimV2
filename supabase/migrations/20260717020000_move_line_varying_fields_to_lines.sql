BEGIN;

-- Several header fields actually vary per line item (different lines can have
-- different departments, tax treatment, or be different capital assets), so
-- they move from purchase_requests (one value per PR) to purchase_request_lines
-- (one value per line). Per explicit instruction: existing header data in these
-- columns (41 real rows) is NOT backfilled into lines -- dropped directly.
--
-- description: NOT re-added on lines -- purchase_request_lines.description
-- already exists and serves this role at the line level; the header-level
-- "overall PR description" is simply removed as redundant.
--
-- fixed_asset_*/depreciation_*: these were moved TO this table (from lines) in
-- 20260716020000_move_purchase_request_asset_fields_to_header.sql. This
-- reverses that move per explicit updated instruction -- they vary per line
-- (different lines can be different assets), not per PR.

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_depreciation_years_check,
  DROP CONSTRAINT IF EXISTS purchase_requests_depreciation_period_order_check;

ALTER TABLE public.purchase_requests
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS direct_unit_cost,
  DROP COLUMN IF EXISTS gst_percentage,
  DROP COLUMN IF EXISTS gst_amount,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS cgst_percentage,
  DROP COLUMN IF EXISTS cgst_amount,
  DROP COLUMN IF EXISTS sgst_percentage,
  DROP COLUMN IF EXISTS sgst_amount,
  DROP COLUMN IF EXISTS igst_percentage,
  DROP COLUMN IF EXISTS igst_amount,
  DROP COLUMN IF EXISTS fixed_asset_description,
  DROP COLUMN IF EXISTS fixed_asset_fa_class_code,
  DROP COLUMN IF EXISTS fixed_asset_fa_subclass_code,
  DROP COLUMN IF EXISTS depreciation_start_date,
  DROP COLUMN IF EXISTS no_of_depreciation_years,
  DROP COLUMN IF EXISTS depreciation_end_date;

ALTER TABLE public.purchase_request_lines
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS gst_percentage INTEGER,
  ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS cgst_percentage NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS sgst_percentage NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS igst_percentage NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS fixed_asset_description TEXT,
  ADD COLUMN IF NOT EXISTS fixed_asset_fa_class_code TEXT,
  ADD COLUMN IF NOT EXISTS fixed_asset_fa_subclass_code TEXT,
  ADD COLUMN IF NOT EXISTS depreciation_start_date DATE,
  ADD COLUMN IF NOT EXISTS no_of_depreciation_years INTEGER,
  ADD COLUMN IF NOT EXISTS depreciation_end_date DATE;

ALTER TABLE public.purchase_request_lines
  ADD CONSTRAINT purchase_request_lines_gst_percentage_check
    CHECK (gst_percentage IS NULL OR gst_percentage IN (5, 12, 18, 28)),
  ADD CONSTRAINT purchase_request_lines_depreciation_years_check
    CHECK (no_of_depreciation_years IS NULL OR (no_of_depreciation_years > 0 AND no_of_depreciation_years <= 50)),
  ADD CONSTRAINT purchase_request_lines_depreciation_period_order_check
    CHECK (depreciation_start_date IS NULL OR depreciation_end_date IS NULL OR depreciation_start_date <= depreciation_end_date);

COMMIT;
