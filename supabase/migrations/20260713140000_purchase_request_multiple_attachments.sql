BEGIN;

-- A PR can carry multiple documents (invoice + supporting proofs, etc.), so
-- attachments move from four single-file columns on purchase_requests into
-- their own one-to-many table. Existing single-attachment data is carried
-- forward before the old columns are dropped.

CREATE TABLE IF NOT EXISTS public.purchase_request_attachments (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_request_id  UUID        NOT NULL REFERENCES public.purchase_requests (id) ON DELETE CASCADE,
  file_name            TEXT        NOT NULL,
  storage_path         TEXT        NOT NULL,
  content_type         TEXT        NOT NULL,
  size_bytes           INTEGER     NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_request_attachments_pr_id
  ON public.purchase_request_attachments (purchase_request_id);

ALTER TABLE public.purchase_request_attachments ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.purchase_request_attachments TO service_role;

INSERT INTO public.purchase_request_attachments
  (purchase_request_id, file_name, storage_path, content_type, size_bytes, created_at)
SELECT id, attachment_file_name, attachment_storage_path, attachment_content_type, attachment_size_bytes, created_at
FROM public.purchase_requests
WHERE attachment_file_name IS NOT NULL;

ALTER TABLE public.purchase_requests
  DROP COLUMN IF EXISTS attachment_file_name,
  DROP COLUMN IF EXISTS attachment_storage_path,
  DROP COLUMN IF EXISTS attachment_content_type,
  DROP COLUMN IF EXISTS attachment_size_bytes;

COMMIT;
