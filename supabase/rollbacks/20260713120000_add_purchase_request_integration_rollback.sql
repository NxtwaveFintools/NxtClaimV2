BEGIN;

DROP TABLE IF EXISTS public.purchase_requests;
DROP TABLE IF EXISTS public.api_keys;

DELETE FROM storage.buckets WHERE id = 'purchase-request-attachments';

COMMIT;
