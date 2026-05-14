BEGIN;

-- Enums used by the BC payload + audit log.
DO $$ BEGIN
  CREATE TYPE public.bc_account_type AS ENUM ('Employee', 'Vendor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.bc_employee_transaction_type AS ENUM ('ADVANCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.bc_bal_account_type AS ENUM ('G/L Account');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.bc_payment_audit_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Audit log: row written BEFORE BC call, updated to SUCCESS / FAILED after.
-- FK uses ON DELETE NO ACTION so audit history blocks claim hard-deletes
-- and is never silently orphaned. Claims should be soft-deleted via is_active.
CREATE TABLE IF NOT EXISTS public.bc_payment_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          TEXT NOT NULL REFERENCES public.claims(id) ON DELETE NO ACTION,
  idempotency_key   UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status            public.bc_payment_audit_status NOT NULL,
  payload_json      JSONB NOT NULL,
  bc_response_json  JSONB,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

-- Index supports the stuck-row monitoring query (see runbook).
CREATE INDEX IF NOT EXISTS idx_bc_payment_audit_log_status_created
  ON public.bc_payment_audit_log (status, created_at);

CREATE INDEX IF NOT EXISTS idx_bc_payment_audit_log_claim_id
  ON public.bc_payment_audit_log (claim_id);

-- Service-role-only table: RLS is enabled with NO policies, so anon and
-- authenticated roles get no access by default. Edge Functions use the
-- service_role key which bypasses RLS.
ALTER TABLE public.bc_payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role only — Edge Function reads/writes via service role key.
GRANT ALL ON TABLE public.bc_payment_audit_log TO service_role;

COMMIT;
