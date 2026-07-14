BEGIN;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS attachment_file_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS attachment_content_type TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size_bytes INTEGER;

-- Only the first attachment per PR survives the rollback (the single-attachment
-- columns can't represent more than one file).
UPDATE public.purchase_requests pr
SET attachment_file_name = a.file_name,
    attachment_storage_path = a.storage_path,
    attachment_content_type = a.content_type,
    attachment_size_bytes = a.size_bytes
FROM (
  SELECT DISTINCT ON (purchase_request_id) *
  FROM public.purchase_request_attachments
  ORDER BY purchase_request_id, created_at ASC
) a
WHERE pr.id = a.purchase_request_id;

DROP TABLE IF EXISTS public.purchase_request_attachments;

COMMIT;
