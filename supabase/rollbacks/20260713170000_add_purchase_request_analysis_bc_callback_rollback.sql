BEGIN;

ALTER TABLE public.purchase_request_analyses
  DROP COLUMN IF EXISTS bc_callback_status,
  DROP COLUMN IF EXISTS bc_callback_attempts,
  DROP COLUMN IF EXISTS bc_callback_sent_at,
  DROP COLUMN IF EXISTS bc_callback_error;

COMMIT;
