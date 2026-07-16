BEGIN;

ALTER TABLE public.api_keys
  DROP COLUMN IF EXISTS callback_url,
  DROP COLUMN IF EXISTS callback_api_key;

COMMIT;
