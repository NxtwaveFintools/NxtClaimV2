BEGIN;

ALTER TABLE public.purchase_request_lines
  ADD COLUMN IF NOT EXISTS fixed_asset_description TEXT,
  ADD COLUMN IF NOT EXISTS fixed_asset_fa_class_code TEXT,
  ADD COLUMN IF NOT EXISTS fixed_asset_fa_subclass_code TEXT,
  ADD COLUMN IF NOT EXISTS depreciation_start_date DATE,
  ADD COLUMN IF NOT EXISTS no_of_depreciation_years INTEGER,
  ADD COLUMN IF NOT EXISTS depreciation_end_date DATE;

ALTER TABLE public.purchase_request_lines
  ADD CONSTRAINT purchase_request_lines_depreciation_years_check
    CHECK (no_of_depreciation_years IS NULL OR (no_of_depreciation_years > 0 AND no_of_depreciation_years <= 50)),
  ADD CONSTRAINT purchase_request_lines_depreciation_period_order_check
    CHECK (depreciation_start_date IS NULL OR depreciation_end_date IS NULL OR depreciation_start_date <= depreciation_end_date);

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_depreciation_years_check,
  DROP CONSTRAINT IF EXISTS purchase_requests_depreciation_period_order_check,
  DROP COLUMN IF EXISTS fixed_asset_description,
  DROP COLUMN IF EXISTS fixed_asset_fa_class_code,
  DROP COLUMN IF EXISTS fixed_asset_fa_subclass_code,
  DROP COLUMN IF EXISTS depreciation_start_date,
  DROP COLUMN IF EXISTS no_of_depreciation_years,
  DROP COLUMN IF EXISTS depreciation_end_date;

COMMIT;
