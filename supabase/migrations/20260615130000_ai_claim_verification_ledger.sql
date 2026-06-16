-- Migration: ai_claim_verification_ledger
-- AI Claim Verification — Finance-Stage Verification Ledger (v1 = Lane 1, receipt only).
-- Adds two append-only tables, the enqueue/dequeue/complete RPCs, the canonical
-- snapshot builder, the reconciliation + reaper helpers, the latest-verdict view,
-- the AI Verifier system user, the audit-log action-type extension, and RLS.
--
-- Decisions locked in /plan-eng-review 2026-06-15:
--  * superseded is a BOOLEAN orthogonal to status (a run can be completed AND superseded).
--  * snapshot canonicalization lives in ONE SQL function (build_verification_snapshot)
--    called by BOTH the app trigger and the reconciliation sweep — no TS/SQL drift.
--  * all state transitions go through SECURITY DEFINER RPCs (repo convention).
--  * v1 is Lane 1 only: no bank-statement columns / no statement_mismatch verdict yet.
--
-- The pg_cron + pg_net scheduling (worker tick, reconciliation, reaper) is a separate,
-- environment-specific migration (20260615131000_ai_claim_verification_schedule.sql).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.claim_verification_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id                 text NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  trigger                  text NOT NULL,
  status                   text NOT NULL DEFAULT 'queued',
  superseded               boolean NOT NULL DEFAULT false,
  attempts                 integer NOT NULL DEFAULT 0,
  next_attempt_at          timestamptz NOT NULL DEFAULT now(),
  receipt_file_path        text,
  receipt_file_hash        text,
  submitted_values_snapshot jsonb NOT NULL,
  model                    text,
  overall_verdict          text,
  error_detail             text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  started_at               timestamptz,
  finished_at              timestamptz,
  CONSTRAINT claim_verification_runs_trigger_check
    CHECK (trigger = ANY (ARRAY['l1_approved', 'finance_edit', 'manual_rerun'])),
  CONSTRAINT claim_verification_runs_status_check
    CHECK (status = ANY (ARRAY['queued', 'running', 'completed', 'failed'])),
  CONSTRAINT claim_verification_runs_verdict_check
    CHECK (overall_verdict IS NULL OR overall_verdict = ANY (ARRAY[
      'verified', 'mismatch', 'needs_review', 'extraction_failed', 'no_document']))
);

ALTER TABLE public.claim_verification_runs OWNER TO postgres;

COMMENT ON TABLE public.claim_verification_runs IS
  'Append-only ledger of AI verification runs. Latest non-superseded completed run drives the finance badge. History is the phase-2 auto-approval trust dataset.';
COMMENT ON COLUMN public.claim_verification_runs.superseded IS
  'True when a newer trigger changed the claim inputs after this run was queued/while it ran. Superseded runs never drive the badge but are retained.';
COMMENT ON COLUMN public.claim_verification_runs.next_attempt_at IS
  'Backoff gate. Dequeue skips queued runs until now() >= next_attempt_at (used for Gemini 429 backoff).';

CREATE TABLE IF NOT EXISTS public.claim_verification_checks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               uuid NOT NULL REFERENCES public.claim_verification_runs(id) ON DELETE CASCADE,
  field                text NOT NULL,
  submitted_value      text,
  extracted_raw        text,
  extracted_normalized text,
  verdict              text NOT NULL,
  hardness             text NOT NULL DEFAULT 'soft',
  confidence           integer,
  tolerance_applied    text,
  mismatch_reason      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_verification_checks_verdict_check
    CHECK (verdict = ANY (ARRAY['match', 'mismatch', 'fuzzy_match', 'unavailable'])),
  CONSTRAINT claim_verification_checks_hardness_check
    CHECK (hardness = ANY (ARRAY['hard', 'soft'])),
  CONSTRAINT claim_verification_checks_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))
);

ALTER TABLE public.claim_verification_checks OWNER TO postgres;

COMMENT ON TABLE public.claim_verification_checks IS
  'Per-field evidence rows for a verification run: submitted vs extracted (raw + normalized), verdict, confidence, tolerance and mismatch reason.';

-- Indexes -------------------------------------------------------------------
-- Latest-run-per-claim lookup (badge view) and finance-queue join.
CREATE INDEX IF NOT EXISTS idx_verification_runs_claim_created
  ON public.claim_verification_runs (claim_id, created_at DESC);
-- Worker dequeue ordering: queued + backoff-ready, oldest first.
CREATE INDEX IF NOT EXISTS idx_verification_runs_queue
  ON public.claim_verification_runs (status, next_attempt_at, created_at)
  WHERE status = 'queued';
-- Reaper: find stuck running rows.
CREATE INDEX IF NOT EXISTS idx_verification_runs_running
  ON public.claim_verification_runs (status, started_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_verification_checks_run
  ON public.claim_verification_checks (run_id);

-- ---------------------------------------------------------------------------
-- 2. Audit-log action-type extension
-- ---------------------------------------------------------------------------
-- Extend the CHECK constraint with the AI verification action types.
ALTER TABLE public.claim_audit_logs
  DROP CONSTRAINT IF EXISTS claim_audit_logs_action_type_check;

-- Preserve ALL existing action types (10 base + BC_* from migration 20260517074417)
-- and add the AI verification types. Dropping any existing value would violate the
-- constraint against live rows.
ALTER TABLE public.claim_audit_logs
  ADD CONSTRAINT claim_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'SUBMITTED', 'UPDATED', 'L1_APPROVED', 'L1_REJECTED', 'L2_APPROVED',
    'L2_REJECTED', 'L2_MARK_PAID', 'FINANCE_EDITED', 'ADMIN_SOFT_DELETED',
    'ADMIN_PAYMENT_MODE_OVERRIDDEN', 'BC_SUBMITTED', 'BC_SUBMISSION_FAILED',
    'AI_VERIFICATION_COMPLETED', 'AI_VERIFICATION_OVERRIDDEN', 'AI_VERIFICATION_RERUN'
  ]));

-- ---------------------------------------------------------------------------
-- 3. AI Verifier system user
-- ---------------------------------------------------------------------------
-- claim_audit_logs.actor_id is NOT NULL and FKs public.users(id) -> auth.users(id)
-- (ON DELETE RESTRICT). Automated verification events need a stable system actor.
-- Fixed UUID (all-ones) marks it unmistakably as the system account. The account
-- carries an empty encrypted_password and an internal email so it can never log in.
DO $$
DECLARE
  v_ai_verifier_id uuid := '11111111-1111-4111-8111-111111111111';
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000', v_ai_verifier_id,
    'authenticated', 'authenticated', 'ai-verifier@nxtclaim.internal', '',
    now(), now(), now(),
    '{"provider":"system","providers":["system"]}'::jsonb,
    '{"full_name":"AI Verifier"}'::jsonb, false,
    '', '', '', ''
  )
  ON CONFLICT (id) DO NOTHING;

  -- public.users has no `role` column on this database (roles live in
  -- master_finance_approvers / admins). The AI Verifier only needs to exist as a
  -- valid actor_id FK target.
  INSERT INTO public.users (id, email, full_name, is_active)
  VALUES (v_ai_verifier_id, 'ai-verifier@nxtclaim.internal', 'AI Verifier', true)
  ON CONFLICT (id) DO NOTHING;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Canonical snapshot builder (single source of truth for compared fields)
-- ---------------------------------------------------------------------------
-- Builds a deterministic jsonb of the compared fields from the ACTIVE expense
-- detail. Numeric amounts are rounded to 2dp so representation drift never
-- triggers a false supersession. Returns NULL if the claim has no active
-- expense detail (defensive; callers treat that as nothing-to-verify).
CREATE OR REPLACE FUNCTION public.build_verification_snapshot(p_claim_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'bill_no',              ed.bill_no,
    'transaction_date',     ed.transaction_date,
    'total_amount',         round(ed.total_amount::numeric, 2),
    'cgst_amount',          round(ed.cgst_amount::numeric, 2),
    'sgst_amount',          round(ed.sgst_amount::numeric, 2),
    'igst_amount',          round(ed.igst_amount::numeric, 2),
    'gst_number',           ed.gst_number,
    'vendor_name',          ed.vendor_name,
    'transaction_id',       ed.transaction_id,
    'is_gst_applicable',    ed.is_gst_applicable,
    'foreign_total_amount', CASE WHEN ed.foreign_total_amount IS NULL THEN NULL
                                 ELSE round(ed.foreign_total_amount::numeric, 2) END,
    'foreign_currency_code', ed.foreign_currency_code
  )
  FROM public.expense_details ed
  WHERE ed.claim_id = p_claim_id AND ed.is_active = true
  LIMIT 1;
$$;

ALTER FUNCTION public.build_verification_snapshot(text) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 5. Enqueue RPC (trigger + reconciliation share this one path)
-- ---------------------------------------------------------------------------
-- Marks any prior non-terminal run for the claim as superseded, then inserts a
-- fresh queued run carrying the current canonical snapshot + receipt path.
-- Returns the new run id, or NULL when the claim has no active expense detail.
CREATE OR REPLACE FUNCTION public.enqueue_verification_run(
  p_claim_id text,
  p_trigger  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_snapshot     jsonb;
  v_receipt_path text;
  v_run_id       uuid;
BEGIN
  v_snapshot := public.build_verification_snapshot(p_claim_id);
  IF v_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ed.receipt_file_path INTO v_receipt_path
  FROM public.expense_details ed
  WHERE ed.claim_id = p_claim_id AND ed.is_active = true
  LIMIT 1;

  -- Proactively supersede any in-flight or queued run for this claim.
  UPDATE public.claim_verification_runs
  SET    superseded = true
  WHERE  claim_id = p_claim_id
    AND  status IN ('queued', 'running')
    AND  superseded = false;

  INSERT INTO public.claim_verification_runs (
    claim_id, trigger, status, receipt_file_path, submitted_values_snapshot
  )
  VALUES (p_claim_id, p_trigger, 'queued', v_receipt_path, v_snapshot)
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END
$$;

ALTER FUNCTION public.enqueue_verification_run(text, text) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 6. Dequeue RPC — atomic claim of N queued runs (FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------------
-- Overlap-safe: concurrent worker ticks get disjoint batches. Skips superseded
-- rows and rows whose backoff window has not elapsed.
CREATE OR REPLACE FUNCTION public.dequeue_verification_runs(p_limit integer)
RETURNS SETOF public.claim_verification_runs
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE public.claim_verification_runs
  SET    status = 'running',
         started_at = now(),
         attempts = attempts + 1
  WHERE  id IN (
    SELECT id
    FROM   public.claim_verification_runs
    WHERE  status = 'queued'
      AND  superseded = false
      AND  next_attempt_at <= now()
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT  p_limit
  )
  RETURNING *;
$$;

ALTER FUNCTION public.dequeue_verification_runs(integer) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 7. Completion RPC — persist checks + verdict, supersession guard, audit log
-- ---------------------------------------------------------------------------
-- p_checks is a jsonb array of objects matching claim_verification_checks columns.
-- Re-checks the live snapshot at completion: if inputs changed since this run was
-- queued, the run is marked superseded (it still records its result for history).
CREATE OR REPLACE FUNCTION public.complete_verification_run(
  p_run_id          uuid,
  p_overall_verdict text,
  p_model           text,
  p_receipt_hash    text,
  p_checks          jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_ai_verifier_id uuid := '11111111-1111-4111-8111-111111111111';
  v_run            public.claim_verification_runs%ROWTYPE;
  v_current_snap   jsonb;
  v_superseded     boolean;
BEGIN
  SELECT * INTO v_run
  FROM public.claim_verification_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification run % not found', p_run_id;
  END IF;

  -- Supersession guard: did the compared inputs change since enqueue?
  v_current_snap := public.build_verification_snapshot(v_run.claim_id);
  v_superseded := v_run.superseded
                  OR (v_current_snap IS DISTINCT FROM v_run.submitted_values_snapshot);

  UPDATE public.claim_verification_runs
  SET    status = 'completed',
         overall_verdict = p_overall_verdict,
         model = p_model,
         receipt_file_hash = p_receipt_hash,
         superseded = v_superseded,
         finished_at = now(),
         error_detail = NULL
  WHERE  id = p_run_id;

  -- Replace any prior checks for idempotent re-completion.
  DELETE FROM public.claim_verification_checks WHERE run_id = p_run_id;

  INSERT INTO public.claim_verification_checks (
    run_id, field, submitted_value, extracted_raw, extracted_normalized,
    verdict, hardness, confidence, tolerance_applied, mismatch_reason
  )
  SELECT
    p_run_id,
    c->>'field',
    c->>'submitted_value',
    c->>'extracted_raw',
    c->>'extracted_normalized',
    c->>'verdict',
    coalesce(c->>'hardness', 'soft'),
    nullif(c->>'confidence', '')::integer,
    c->>'tolerance_applied',
    c->>'mismatch_reason'
  FROM jsonb_array_elements(coalesce(p_checks, '[]'::jsonb)) AS c;

  -- Audit only the run that actually drives the badge (skip superseded noise).
  IF NOT v_superseded THEN
    INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
    VALUES (
      v_run.claim_id, v_ai_verifier_id, 'AI_VERIFICATION_COMPLETED',
      format('AI verification: %s', p_overall_verdict)
    );
  END IF;
END
$$;

ALTER FUNCTION public.complete_verification_run(uuid, text, text, text, jsonb) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 8. Failure RPC — backoff requeue or terminal failure
-- ---------------------------------------------------------------------------
-- p_retryable=true (e.g. Gemini 429/503): requeue with exponential backoff until
-- max attempts, then fail. p_retryable=false: fail immediately with the verdict.
CREATE OR REPLACE FUNCTION public.fail_verification_run(
  p_run_id    uuid,
  p_error     text,
  p_retryable boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_max_attempts constant integer := 3;
  v_run          public.claim_verification_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run
  FROM public.claim_verification_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification run % not found', p_run_id;
  END IF;

  IF p_retryable AND v_run.attempts < v_max_attempts THEN
    -- Exponential backoff: 1m, 2m, 4m ... from now.
    UPDATE public.claim_verification_runs
    SET    status = 'queued',
           next_attempt_at = now() + (power(2, v_run.attempts) * interval '1 minute'),
           error_detail = p_error
    WHERE  id = p_run_id;
  ELSE
    UPDATE public.claim_verification_runs
    SET    status = 'failed',
           overall_verdict = 'extraction_failed',
           error_detail = p_error,
           finished_at = now()
    WHERE  id = p_run_id;
  END IF;
END
$$;

ALTER FUNCTION public.fail_verification_run(uuid, text, boolean) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 9. Reconciliation sweep — enqueue L1-approved expense claims missing a run
-- ---------------------------------------------------------------------------
-- Belt-and-suspenders for best-effort triggers: any HOD-approved expense claim
-- with no live (queued/running/completed-non-superseded) run gets enqueued.
CREATE OR REPLACE FUNCTION public.reconcile_verification_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_claim_id text;
  v_count    integer := 0;
BEGIN
  FOR v_claim_id IN
    SELECT c.id
    FROM   public.claims c
    WHERE  c.is_active = true
      AND  c.detail_type = 'expense'
      AND  c.status = 'HOD approved - Awaiting finance approval'::public.claim_status
      AND  NOT EXISTS (
             SELECT 1 FROM public.claim_verification_runs r
             WHERE  r.claim_id = c.id
               AND  (r.status IN ('queued', 'running')
                     OR (r.status = 'completed' AND r.superseded = false))
           )
  LOOP
    IF public.enqueue_verification_run(v_claim_id, 'l1_approved') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END
$$;

ALTER FUNCTION public.reconcile_verification_runs() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 10. Reaper — reset stuck running rows
-- ---------------------------------------------------------------------------
-- Runs stuck >15 minutes are requeued; after max attempts they fail.
CREATE OR REPLACE FUNCTION public.reap_stuck_verification_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_max_attempts constant integer := 3;
  v_count        integer := 0;
BEGIN
  WITH stuck AS (
    SELECT id, attempts
    FROM   public.claim_verification_runs
    WHERE  status = 'running'
      AND  started_at < now() - interval '15 minutes'
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.claim_verification_runs r
    SET    status = CASE WHEN s.attempts >= v_max_attempts THEN 'failed' ELSE 'queued' END,
           overall_verdict = CASE WHEN s.attempts >= v_max_attempts THEN 'extraction_failed' ELSE r.overall_verdict END,
           next_attempt_at = now(),
           finished_at = CASE WHEN s.attempts >= v_max_attempts THEN now() ELSE r.finished_at END,
           error_detail = 'reset by reaper: stuck in running > 15m'
    FROM   stuck s
    WHERE  r.id = s.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END
$$;

ALTER FUNCTION public.reap_stuck_verification_runs() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 11. Manual override / re-run RPCs (finance-actioned, human actor)
-- ---------------------------------------------------------------------------
-- Mark-verified-anyway: records an override audit entry attributed to the finance
-- user who clicked. Does not mutate run rows (history stays truthful).
CREATE OR REPLACE FUNCTION public.override_verification_run(
  p_claim_id text,
  p_actor_id uuid,
  p_reason   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
  VALUES (p_claim_id, p_actor_id, 'AI_VERIFICATION_OVERRIDDEN',
          nullif(trim(coalesce(p_reason, '')), ''));
END
$$;

ALTER FUNCTION public.override_verification_run(text, uuid, text) OWNER TO postgres;

-- Manual re-run: enqueue a fresh run attributed to the finance user.
CREATE OR REPLACE FUNCTION public.rerun_verification(
  p_claim_id text,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  v_run_id := public.enqueue_verification_run(p_claim_id, 'manual_rerun');
  IF v_run_id IS NOT NULL THEN
    INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
    VALUES (p_claim_id, p_actor_id, 'AI_VERIFICATION_RERUN', 'Manual re-run requested');
  END IF;
  RETURN v_run_id;
END
$$;

ALTER FUNCTION public.rerun_verification(text, uuid) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 12. Latest-verdict view (drives the finance-queue badge column)
-- ---------------------------------------------------------------------------
-- One row per claim: the most recent NON-superseded run (any terminal/in-flight
-- status), so the badge reflects the run that actually applies to current inputs.
CREATE OR REPLACE VIEW public.claim_latest_verification
  WITH (security_invoker = on) AS
SELECT DISTINCT ON (r.claim_id)
  r.claim_id,
  r.id              AS run_id,
  r.status,
  r.overall_verdict,
  r.created_at,
  r.finished_at
FROM public.claim_verification_runs r
WHERE r.superseded = false
ORDER BY r.claim_id, r.created_at DESC;

ALTER VIEW public.claim_latest_verification OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 13. RLS — finance-approver read, service-role-only write
-- ---------------------------------------------------------------------------
ALTER TABLE public.claim_verification_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_verification_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance approvers read verification runs"
  ON public.claim_verification_runs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.master_finance_approvers mfa
    WHERE mfa.user_id = (SELECT auth.uid()) AND mfa.is_active = true
  ));

CREATE POLICY "finance approvers read verification checks"
  ON public.claim_verification_checks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.master_finance_approvers mfa
    WHERE mfa.user_id = (SELECT auth.uid()) AND mfa.is_active = true
  ));

-- ---------------------------------------------------------------------------
-- 14. Grants — service_role writes; authenticated reads (gated by RLS)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.claim_verification_runs   FROM PUBLIC, anon;
REVOKE ALL ON public.claim_verification_checks FROM PUBLIC, anon;
GRANT  SELECT ON public.claim_verification_runs   TO authenticated;
GRANT  SELECT ON public.claim_verification_checks TO authenticated;
GRANT  SELECT ON public.claim_latest_verification TO authenticated;
GRANT  ALL    ON public.claim_verification_runs   TO service_role;
GRANT  ALL    ON public.claim_verification_checks TO service_role;
GRANT  SELECT ON public.claim_latest_verification TO service_role;

-- Functions: service_role only (mirrors sync_duplicate_flags posture).
REVOKE EXECUTE ON FUNCTION public.build_verification_snapshot(text)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_verification_run(text, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dequeue_verification_runs(integer)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_verification_run(uuid, text, boolean)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_verification_runs()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_verification_runs()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.override_verification_run(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rerun_verification(text, uuid)              FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.build_verification_snapshot(text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_verification_run(text, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.dequeue_verification_runs(integer)          TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_verification_run(uuid, text, boolean)  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_verification_runs()              TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stuck_verification_runs()             TO service_role;
GRANT EXECUTE ON FUNCTION public.override_verification_run(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rerun_verification(text, uuid)              TO service_role;

COMMIT;
