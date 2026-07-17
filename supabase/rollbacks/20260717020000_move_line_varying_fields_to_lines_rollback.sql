BEGIN;

-- Schema-only rollback: recreates the header columns (nullable -- the original
-- NOT NULL constraints can't be safely restored since the data itself was
-- dropped, not preserved) and removes the line-level columns/constraints added
-- by the forward migration.

ALTER TABLE public.purchase_request_lines
  DROP CONSTRAINT IF EXISTS purchase_request_lines_gst_percentage_check,
  DROP CONSTRAINT IF EXISTS purchase_request_lines_depreciation_years_check,
  DROP CONSTRAINT IF EXISTS purchase_request_lines_depreciation_period_order_check;

ALTER TABLE public.purchase_request_lines
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS gst_percentage,
  DROP COLUMN IF EXISTS gst_amount,
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

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS direct_unit_cost NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS gst_percentage INTEGER,
  ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS description TEXT,
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

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_depreciation_years_check
    CHECK (no_of_depreciation_years IS NULL OR (no_of_depreciation_years > 0 AND no_of_depreciation_years <= 50)),
  ADD CONSTRAINT purchase_requests_depreciation_period_order_check
    CHECK (depreciation_start_date IS NULL OR depreciation_end_date IS NULL OR depreciation_start_date <= depreciation_end_date);

COMMIT;
