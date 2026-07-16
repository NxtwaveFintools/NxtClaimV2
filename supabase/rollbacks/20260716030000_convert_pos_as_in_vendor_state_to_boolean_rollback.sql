BEGIN;

ALTER TABLE public.purchase_requests
  DROP COLUMN IF EXISTS pos_as_in_vendor_state;

ALTER TABLE public.purchase_requests
  ADD COLUMN pos_as_in_vendor_state TEXT;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_pos_state_length_check
    CHECK (pos_as_in_vendor_state IS NULL OR char_length(pos_as_in_vendor_state) = 2);

COMMIT;
