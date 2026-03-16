ALTER TABLE public.expense_details
  DROP CONSTRAINT IF EXISTS expense_details_gst_fields;

ALTER TABLE public.expense_details
  ADD CONSTRAINT expense_details_gst_fields CHECK (
    (
      is_gst_applicable = false
      AND coalesce(gst_number, 'N/A') = 'N/A'
      AND cgst_amount = 0
      AND sgst_amount = 0
      AND igst_amount = 0
    )
    OR
    (
      is_gst_applicable = true
      AND coalesce(gst_number, 'N/A') <> 'N/A'
    )
  );

-- Rollback (manual):
-- 1) alter table public.expense_details drop constraint if exists expense_details_gst_fields;
-- 2) restore previous gst constraint if required.
