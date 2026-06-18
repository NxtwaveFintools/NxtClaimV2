-- Migration: ai_claim_verification_schedule
-- Wires the verification worker to a schedule: pg_cron ticks an authenticated
-- Next.js worker route via pg_net every minute, and runs the reconciliation +
-- reaper SQL helpers every 5 minutes.
--
-- This is intentionally separate from the schema migration because it depends on
-- the pg_cron and pg_net extensions (enabled per-project) and on a deploy-specific
-- worker URL + shared secret. After deploy, set the config row:
--
--   UPDATE public.verification_worker_config
--   SET worker_url = 'https://<app-host>/api/internal/verify-worker',
--       cron_secret = '<same value as CRON_SECRET env on the app>',
--       enabled = true;
--
-- Until that row is populated, the worker tick is a safe no-op (the reconciliation
-- + reaper jobs still run, so nothing is lost — runs just sit queued).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extensions (no-op if already enabled)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 2. Worker config (single row, service-role only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_worker_config (
  id          boolean PRIMARY KEY DEFAULT true,
  worker_url  text,
  cron_secret text,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_worker_config_singleton CHECK (id = true)
);

ALTER TABLE public.verification_worker_config OWNER TO postgres;
ALTER TABLE public.verification_worker_config ENABLE ROW LEVEL SECURITY;

-- Seed the singleton row (unconfigured -> worker tick no-ops).
INSERT INTO public.verification_worker_config (id, worker_url, cron_secret, enabled)
VALUES (true, NULL, NULL, true)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON public.verification_worker_config FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.verification_worker_config TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Worker tick — POST the authenticated worker route with the shared secret
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tick_verification_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_cfg public.verification_worker_config%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM public.verification_worker_config WHERE id = true;

  IF NOT FOUND OR v_cfg.enabled = false
     OR v_cfg.worker_url IS NULL OR v_cfg.cron_secret IS NULL THEN
    RETURN; -- unconfigured or disabled: safe no-op
  END IF;

  -- Only ping when there is backoff-ready queued work, to avoid idle traffic.
  IF NOT EXISTS (
    SELECT 1 FROM public.claim_verification_runs
    WHERE status = 'queued' AND superseded = false AND next_attempt_at <= now()
  ) THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_cfg.worker_url,
    body    := '{}'::jsonb,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', v_cfg.cron_secret
               ),
    timeout_milliseconds := 5000
  );
END
$$;

ALTER FUNCTION public.tick_verification_worker() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.tick_verification_worker() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tick_verification_worker() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Schedule the three jobs (idempotent: unschedule by name first)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('verify-worker-tick', 'verify-reconcile', 'verify-reaper')
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule('verify-worker-tick', '* * * * *',
    $cron$ SELECT public.tick_verification_worker(); $cron$);

  PERFORM cron.schedule('verify-reconcile', '*/5 * * * *',
    $cron$ SELECT public.reconcile_verification_runs(); $cron$);

  PERFORM cron.schedule('verify-reaper', '*/5 * * * *',
    $cron$ SELECT public.reap_stuck_verification_runs(); $cron$);
END
$$;

COMMIT;
