BEGIN;

-- Fixed-asset and depreciation fields were originally modeled per-line
-- (purchase_request_lines), matching the spec's lines[].fixed_asset.*/
-- lines[].depreciation.* shape. They belong on the PR header instead.
-- purchase_request_lines has zero rows in production, so this is a pure
-- schema relocation -- no data migration needed.

ALTER TABLE public.purchase_requests
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

ALTER TABLE public.purchase_request_lines
  DROP CONSTRAINT IF EXISTS purchase_request_lines_depreciation_years_check,
  DROP CONSTRAINT IF EXISTS purchase_request_lines_depreciation_period_order_check,
  DROP COLUMN IF EXISTS fixed_asset_description,
  DROP COLUMN IF EXISTS fixed_asset_fa_class_code,
  DROP COLUMN IF EXISTS fixed_asset_fa_subclass_code,
  DROP COLUMN IF EXISTS depreciation_start_date,
  DROP COLUMN IF EXISTS no_of_depreciation_years,
  DROP COLUMN IF EXISTS depreciation_end_date;

COMMIT;
