-- Add location_type and location_details columns to expense_details.
-- Both are nullable to preserve backward compatibility with legacy production data.

ALTER TABLE public.expense_details
  ADD COLUMN location_type text NULL,
  ADD COLUMN location_details text NULL;

-- Data integrity: location_details is only valid when location_type = 'Out Station'.
-- Prevents orphaned location_details values.
ALTER TABLE public.expense_details
  ADD CONSTRAINT chk_expense_location_details_requires_out_station
    CHECK (
      location_type = 'Out Station'
      OR location_details IS NULL
    );

COMMENT ON COLUMN public.expense_details.location_type IS 'Per-expense location classification: Base Location or Out Station. NULL for legacy claims.';
COMMENT ON COLUMN public.expense_details.location_details IS 'Free-text details required when location_type is Out Station. NULL otherwise.';
