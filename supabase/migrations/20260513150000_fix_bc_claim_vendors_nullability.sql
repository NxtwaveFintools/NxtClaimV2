BEGIN;

ALTER TABLE public.bc_claim_vendors
  ALTER COLUMN bc_vendor_id   DROP NOT NULL,
  ALTER COLUMN bc_vendor_name DROP NOT NULL;

COMMIT;
