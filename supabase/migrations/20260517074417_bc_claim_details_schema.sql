-- 0. Drop dashboard views first — they depend on claims.bc_payments_flag / is_vendor_payment
--    which step 7 below removes. Task 3's migration (20260517090200) recreates them with
--    the new schema (LEFT JOIN bc_claim_details).
DROP VIEW IF EXISTS public.vw_admin_claims_dashboard;
DROP VIEW IF EXISTS public.vw_enterprise_claims_dashboard;

-- 1. Drop old structures (orphan after this migration).
DROP TABLE IF EXISTS public.bc_claim_vendors;
DROP TABLE IF EXISTS public.bc_payment_audit_log;
DROP TYPE  IF EXISTS public.bc_payment_audit_status;
DROP TYPE  IF EXISTS public.bc_bal_account_type;

-- 2. Create bc_claim_status ENUM.
--    'submitting' = in-flight BC POST. Inserted BEFORE the API call to claim the slot.
--    'success'    = BC accepted (HTTP 2xx). Updated from 'submitting' on the same row.
--    'failed'     = BC rejected or network error. Updated from 'submitting' on the same row.
CREATE TYPE public.bc_claim_status AS ENUM ('submitting', 'success', 'failed');

-- 3. Create bc_claim_details. No is_active column — rows are immutable audit records.
CREATE TABLE public.bc_claim_details (
  id                UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          TEXT                     NOT NULL REFERENCES public.claims(id),
  is_vendor_payment BOOLEAN                  NOT NULL DEFAULT false,
  bc_status         public.bc_claim_status   NOT NULL DEFAULT 'submitting',
  bc_payload_json   JSONB,
  bc_response_json  JSONB,
  created_at        TIMESTAMPTZ              NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ              NOT NULL DEFAULT now()
);

-- 4. Partial UNIQUE index — at most one in-flight OR successful submission per claim.
--    Inserting a second 'submitting' row while one is still in-flight raises unique_violation.
--    This serializes concurrent Finance Submit clicks at the DB level (no application lock needed).
CREATE UNIQUE INDEX bc_claim_details_one_active_per_claim
  ON public.bc_claim_details (claim_id)
  WHERE bc_status IN ('submitting', 'success');

-- 5. Lookup index for "latest attempt for this claim" / dashboard joins.
CREATE INDEX bc_claim_details_claim_id_created_at
  ON public.bc_claim_details (claim_id, created_at DESC);

-- 6. Per-table updated_at trigger (matches existing repo pattern).
CREATE OR REPLACE FUNCTION public.bc_claim_details_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bc_claim_details_set_updated_at ON public.bc_claim_details;
CREATE TRIGGER trg_bc_claim_details_set_updated_at
  BEFORE UPDATE ON public.bc_claim_details
  FOR EACH ROW EXECUTE FUNCTION public.bc_claim_details_set_updated_at();

-- 7. Remove old flags from claims, add FK to the successful bc_claim_details row.
--    NULL = no successful submission yet (may have submitting or failed attempts).
--    Non-NULL = FK points to the success row.
ALTER TABLE public.claims DROP COLUMN IF EXISTS bc_payments_flag;
ALTER TABLE public.claims DROP COLUMN IF EXISTS is_vendor_payment;
ALTER TABLE public.claims
  ADD COLUMN bc_claim_details_id UUID REFERENCES public.bc_claim_details(id) ON DELETE SET NULL;

-- 8. Extend claim_audit_logs CHECK constraint with BC action types.
ALTER TABLE public.claim_audit_logs DROP CONSTRAINT claim_audit_logs_action_type_check;
ALTER TABLE public.claim_audit_logs ADD CONSTRAINT claim_audit_logs_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'SUBMITTED', 'UPDATED', 'L1_APPROVED', 'L1_REJECTED',
    'L2_APPROVED', 'L2_REJECTED', 'L2_MARK_PAID',
    'FINANCE_EDITED', 'ADMIN_SOFT_DELETED', 'ADMIN_PAYMENT_MODE_OVERRIDDEN',
    'BC_SUBMITTED', 'BC_SUBMISSION_FAILED'
  ]));

-- 9. RLS on bc_claim_details.
ALTER TABLE public.bc_claim_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY bc_claim_details_admin_finance_read
  ON public.bc_claim_details FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.master_finance_approvers f
               WHERE f.user_id = auth.uid() AND f.is_active = true)
  );

CREATE POLICY bc_claim_details_submitter_read
  ON public.bc_claim_details FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.claims c
      WHERE c.id = bc_claim_details.claim_id
        AND (c.submitted_by = auth.uid() OR c.on_behalf_of_id = auth.uid())
    )
  );

-- No INSERT/UPDATE policies. Edge function uses service_role (bypasses RLS)
-- and only ever calls the SECURITY DEFINER functions in Section 1.2.