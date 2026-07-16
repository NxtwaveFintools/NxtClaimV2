BEGIN;

DROP TABLE IF EXISTS public.purchase_request_lines;

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_pos_state_length_check,
  DROP CONSTRAINT IF EXISTS purchase_requests_service_period_order_check,
  DROP COLUMN IF EXISTS service_start_date,
  DROP COLUMN IF EXISTS service_end_date,
  DROP COLUMN IF EXISTS budget_period,
  DROP COLUMN IF EXISTS pos_as_in_vendor_state,
  DROP COLUMN IF EXISTS total_amount_including_gst,
  DROP COLUMN IF EXISTS cgst_percentage,
  DROP COLUMN IF EXISTS cgst_amount,
  DROP COLUMN IF EXISTS sgst_percentage,
  DROP COLUMN IF EXISTS sgst_amount,
  DROP COLUMN IF EXISTS igst_percentage,
  DROP COLUMN IF EXISTS igst_amount;

COMMIT;
