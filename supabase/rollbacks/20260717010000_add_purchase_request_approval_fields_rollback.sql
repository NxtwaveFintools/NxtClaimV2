BEGIN;

ALTER TABLE public.purchase_requests
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS sequence_1_approval,
  DROP COLUMN IF EXISTS sequence_2_approval,
  DROP COLUMN IF EXISTS sequence_3_approval,
  DROP COLUMN IF EXISTS sequence_4_approval,
  DROP COLUMN IF EXISTS sequence_5_approval;

COMMIT;
