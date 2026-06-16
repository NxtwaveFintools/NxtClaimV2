-- Migration: verification_worker_lease
-- Single-flight guard for the verification worker. pg_cron may ping the worker
-- route while a previous tick is still running (Codex review #2); a DB-backed
-- lease bounds concurrency to one active worker, working across pooled
-- connections where session advisory locks would not.

BEGIN;

CREATE TABLE IF NOT EXISTS public.verification_worker_lease (
  id           boolean PRIMARY KEY DEFAULT true,
  locked_until timestamptz NOT NULL DEFAULT to_timestamp(0),
  holder       uuid,
  CONSTRAINT verification_worker_lease_singleton CHECK (id = true)
);

ALTER TABLE public.verification_worker_lease OWNER TO postgres;
ALTER TABLE public.verification_worker_lease ENABLE ROW LEVEL SECURITY;

INSERT INTO public.verification_worker_lease (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON public.verification_worker_lease FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.verification_worker_lease TO service_role;

-- Acquire the lease iff free or expired. Returns true when this caller now holds it.
CREATE OR REPLACE FUNCTION public.acquire_verification_worker_lease(p_ttl_seconds integer DEFAULT 90)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_got boolean := false;
BEGIN
  UPDATE public.verification_worker_lease
  SET    locked_until = now() + make_interval(secs => p_ttl_seconds),
         holder = gen_random_uuid()
  WHERE  id = true
    AND  locked_until < now();
  GET DIAGNOSTICS v_got = ROW_COUNT;
  RETURN v_got;
END
$$;

ALTER FUNCTION public.acquire_verification_worker_lease(integer) OWNER TO postgres;

-- Release early so the next tick can run immediately after a fast batch.
CREATE OR REPLACE FUNCTION public.release_verification_worker_lease()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE public.verification_worker_lease
  SET locked_until = to_timestamp(0), holder = NULL
  WHERE id = true;
$$;

ALTER FUNCTION public.release_verification_worker_lease() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.acquire_verification_worker_lease(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_verification_worker_lease()         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.acquire_verification_worker_lease(integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.release_verification_worker_lease()         TO service_role;

COMMIT;
