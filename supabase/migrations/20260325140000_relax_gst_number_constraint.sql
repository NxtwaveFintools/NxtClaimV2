-- Migration: relax_gst_number_constraint
-- Reason: GST Number is now optional on the frontend. The previous constraint
--         blocked inserts when is_gst_applicable = true but no GST number was
--         supplied. The new constraint only enforces that GST tax amounts
--         (cgst, sgst, igst) are zero when GST is not applicable, and are
--         non-negative at all times. The GST number field is no longer gated.

ALTER TABLE public.expense_details
  DROP CONSTRAINT IF EXISTS expense_details_gst_fields;

ALTER TABLE public.expense_details
  ADD CONSTRAINT expense_details_gst_fields CHECK (
    (
      -- When GST is NOT applicable, all tax amounts must be zero.
      is_gst_applicable = false
      AND cgst_amount = 0
      AND sgst_amount = 0
      AND igst_amount = 0
    )
    OR
    (
      -- When GST IS applicable, tax amounts must be non-negative (>= 0).
      -- GST number is intentionally not required.
      is_gst_applicable = true
      AND cgst_amount >= 0
      AND sgst_amount >= 0
      AND igst_amount >= 0
    )
  );

-- Rollback (manual, run if this migration must be reverted):
-- ALTER TABLE public.expense_details DROP CONSTRAINT IF EXISTS expense_details_gst_fields;
-- ALTER TABLE public.expense_details ADD CONSTRAINT expense_details_gst_fields CHECK (
--   (
--     is_gst_applicable = false
--     AND coalesce(gst_number, 'N/A') = 'N/A'
--     AND cgst_amount = 0
--     AND sgst_amount = 0
--     AND igst_amount = 0
--   )
--   OR
--   (
--     is_gst_applicable = true
--     AND coalesce(gst_number, 'N/A') <> 'N/A'
--   )
-- );
