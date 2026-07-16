BEGIN;

-- Each BC integration (e.g. dev/staging/prod, or a different company entirely)
-- can point analysis-result callbacks at its own endpoint -- scoped per api_keys
-- row rather than a single global env var, matching the existing company_id
-- scoping on this table. Both nullable: BC hasn't shared any receiving endpoint
-- yet, so every existing/new key starts with no callback configured (the
-- callback sender no-ops until an admin sets callback_url on the relevant key).

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS callback_url TEXT,
  ADD COLUMN IF NOT EXISTS callback_api_key TEXT;

COMMIT;
