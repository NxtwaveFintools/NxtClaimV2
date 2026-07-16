BEGIN;

-- Tracks delivery of the completed analysis result back to BC (Business Central).
-- BC's actual receiving endpoint isn't available yet -- these columns exist so the
-- callback attempt is observable/retryable once it is, without another migration.

ALTER TABLE public.purchase_request_analyses
  ADD COLUMN IF NOT EXISTS bc_callback_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (bc_callback_status IN ('pending', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS bc_callback_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bc_callback_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bc_callback_error TEXT;

COMMIT;
