BEGIN;

-- pos_as_in_vendor_state was originally modeled as the vendor's 2-character GST
-- state code (string), matching the pasted spec literally. The correct semantics
-- is a boolean: whether the Place of Supply matches the vendor's own state
-- (intra-state -> CGST+SGST) or differs (inter-state -> IGST). Only 2 rows have
-- a non-null value so far (both test data from this feature's own development,
-- not real BC submissions), so dropping and re-adding is safe -- a string->boolean
-- cast would fail on values like '09'/'27' anyway.

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_pos_state_length_check;

ALTER TABLE public.purchase_requests
  DROP COLUMN IF EXISTS pos_as_in_vendor_state;

ALTER TABLE public.purchase_requests
  ADD COLUMN pos_as_in_vendor_state BOOLEAN;

COMMIT;
