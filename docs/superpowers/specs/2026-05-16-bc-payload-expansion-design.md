# BC Payload Expansion Design

**Date:** 2026-05-16
**Status:** Approved — ready for implementation planning

## Context

The Business Central integration currently sends a fixed set of fields per claim (1–2 line items per claim). The BC API has been updated with a richer schema. This spec covers expanding the payload to match the new schema.

Key decisions:

- **One BC POST per claim** — each claim has exactly one `expense_detail` row, so exactly one JSON object is sent to BC.
- **`bc_claim_vendors` replaced → `bc_claim_details`** — lean table: only `is_vendor_payment` is a separate column; everything else (vendor fields, payload, response) lives in JSONB columns. No schema migration needed when BC payload evolves.
- **No separate audit log** — `bc_claim_details` stores `bc_status`, `bc_payload_json`, `bc_response_json` directly. `bc_payment_audit_log` is dropped entirely.
- **Finance user selects** Currency Code, GST Group Code, HSN/SAC Code, Vendor Code/Name in the modal — only shown when vendor payment is chosen.
- A new **`bc-reference` edge function** serves dropdown options from BC OData using `$select=Code,Description` (BC returns 35+ fields per record; we only need 2).
- `amount`, `postingDate`, `accountType`, `accountNo` **removed** from the new BC API.
- `locationCode` is **fixed `"HBT"`** — no DB lookup needed.
- Vendor-only fields are **omitted entirely** (not set to null) for non-vendor claims.

---

## 1. Database Schema

### 1.1 Migration: Replace `bc_claim_vendors` with `bc_claim_details`

No existing data to preserve — BC is test-env only. Drop and recreate cleanly.

**Design decisions baked in:**

- `bc_status` is a real PG ENUM (`bc_claim_status`) with **three values**: `submitting`, `success`, `failed`. The `submitting` state solves both the **TOCTOU race** between concurrent Finance submissions AND the **outbox** problem (BC POST succeeds but RPC update fails) — see Section 3.4 for the lifecycle.
- Multiple `bc_claim_details` rows per claim are allowed (full failure-attempt history). A partial UNIQUE index covers BOTH `submitting` and `success` — at most one in-flight or successful submission per claim, ever.
- `claims.bc_claim_details_id` is set **only after a successful submission**. NULL during in-flight (`submitting`) and after failures. The FK points to the success row.
- `updated_at` is maintained by a per-table trigger function `bc_claim_details_set_updated_at()` (mirrors the existing pattern from `20260513100000_create_bc_claim_vendors.sql`; this repo does not have a generic `set_updated_at()`).
- No `is_active` column — `bc_claim_details` rows are immutable audit records of attempts; nothing is ever soft-deleted.
- RLS is enabled on `bc_claim_details` mirroring the read patterns on `bc_claim_vendors`.
- `claim_audit_logs` CHECK constraint is extended with two new `action_type` values: `BC_SUBMITTED`, `BC_SUBMISSION_FAILED`.
- `claims.is_vendor_payment` is **dropped** — `is_vendor_payment` lives only on `bc_claim_details` (per-attempt snapshot). Dashboard reads it via JOIN on the success row.
- `bc_bal_account_type` enum is **dropped entirely**, not renamed. It was only consumed by `bc_payment_audit_log` (also dropped). The new payload uses a TS literal `"G/L Account"` exposed via `BcType.GLAccount`; the DB enum is orphan after this migration.

```sql
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
```

**Example `bc_claim_details` row after a successful vendor payment:**

```json
{
  "id": "d1e2f3a4-...",
  "claim_id": "CLM-000145",
  "is_vendor_payment": true,
  "bc_status": "success",
  "bc_payload_json": {
    "documentType": "Invoice",
    "locationCode": "HBT",
    "currencyCode": "INR",
    "vendorInvoiceNo": "INV-2026-001",
    "documentDate": "2026-05-10",
    "type": "G/L Account",
    "quantity": 1,
    "gstGroupCode": "GST18",
    "gstCredit": "Non-Availment",
    "hsnSacCode": "998314",
    "gstSubcategory": "Ineligible-43/44",
    "employeeId": "NW0001234",
    "employeeName": "Arjun Chander",
    "vendorCode": "V0001",
    "vendorName": "Twilio Inc",
    "glCode": "503063",
    "employeeTransactionType": "Advance",
    "remarks": "CLM-000145 - Software subscription\nbill - https://xyz.supabase.co/storage/v1/object/public/receipts/inv.pdf\nbank statement - https://xyz.supabase.co/storage/v1/object/public/bank/stmt.pdf",
    "claimNo": "CLM-000145",
    "programCode": "COMMON",
    "subproductCode": "COMMON",
    "responsibleDepartment": "GENAI",
    "beneficiaryDepartment": "GENAI",
    "regionCode": "TELUGU",
    "invoiceRequired": true,
    "paymentRequired": true
  },
  "bc_response_json": { "id": "bc-internal-id-xyz", "status": "created" },
  "created_at": "2026-05-16T10:00:00Z",
  "updated_at": "2026-05-16T10:00:05Z"
}
```

**Example row for a failed non-vendor payment:**

```json
{
  "id": "a9b8c7d6-...",
  "claim_id": "CLM-000200",
  "is_vendor_payment": false,
  "bc_status": "failed",
  "bc_payload_json": {
    "documentType": "Invoice",
    "locationCode": "HBT",
    "documentDate": "2026-05-12",
    "type": "G/L Account",
    "quantity": 1,
    "gstCredit": "Non-Availment",
    "gstSubcategory": "Ineligible-43/44",
    "employeeId": "NW0005678",
    "employeeName": "Priya Sharma",
    "glCode": "503040",
    "employeeTransactionType": "Advance",
    "remarks": "CLM-000200 - Team lunch\nbill - https://xyz.supabase.co/storage/v1/object/public/receipts/lunch.pdf",
    "claimNo": "CLM-000200",
    "programCode": "COMMON",
    "subproductCode": "COMMON",
    "responsibleDepartment": "HR",
    "beneficiaryDepartment": "HR",
    "regionCode": "TELUGU",
    "invoiceRequired": false,
    "paymentRequired": true
  },
  "bc_response_json": { "error": "InvalidGLCode", "message": "GL code 503040 not found" },
  "created_at": "2026-05-16T11:00:00Z",
  "updated_at": "2026-05-16T11:00:03Z"
}
```

---

### 1.2 DB functions — three-step lifecycle: `start` → `complete` / `record_failure`

The 3-state enum (`submitting` → `success` | `failed`) requires three DB functions, all `SECURITY DEFINER`. Each wraps its writes in a single transaction so the `bc_claim_details` row and the `claim_audit_logs` entry are atomic.

Column names below match the **actual** `public.claim_audit_logs` schema: `actor_id` (not `actor_user_id`), `action_type` (not `action`), `remarks` TEXT (not JSONB).

#### Start of attempt (claims the in-flight slot, called BEFORE the BC API POST)

```sql
CREATE OR REPLACE FUNCTION public.start_bc_claim_attempt(
  p_claim_id          TEXT,
  p_is_vendor_payment BOOLEAN,
  p_payload_json      JSONB
)
RETURNS UUID   -- returns the new bc_claim_details.id (status = 'submitting')
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bc_details_id UUID;
BEGIN
  -- Insert the in-flight marker row. If another submission is already
  -- 'submitting' or 'success', the partial UNIQUE index raises unique_violation.
  -- This is the canonical concurrency guard — no app-level lock needed.
  INSERT INTO public.bc_claim_details
    (claim_id, is_vendor_payment, bc_status, bc_payload_json, bc_response_json)
  VALUES
    (p_claim_id, p_is_vendor_payment, 'submitting', p_payload_json, NULL)
  RETURNING id INTO v_bc_details_id;

  RETURN v_bc_details_id;
END;
$$;
```

#### Success path (called AFTER BC returns 2xx; updates the in-flight row to `success`)

```sql
CREATE OR REPLACE FUNCTION public.complete_bc_claim(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim_id TEXT;
BEGIN
  -- Step 1: flip the in-flight row to success and capture BC's response body.
  UPDATE public.bc_claim_details
  SET    bc_status        = 'success',
         bc_response_json = p_response_json
  WHERE  id        = p_bc_details_id
    AND  bc_status = 'submitting'
  RETURNING claim_id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'BC_DETAILS_NOT_IN_FLIGHT: %', p_bc_details_id USING ERRCODE = 'P0004';
  END IF;

  -- Step 2: link the claim to the success row and advance status.
  UPDATE public.claims
  SET    bc_claim_details_id = p_bc_details_id,
         status              = 'Finance Approved - Payment under process',
         updated_at          = now()
  WHERE  id = v_claim_id;

  -- Step 3: audit log entry.
  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
  VALUES (v_claim_id, p_actor_user_id, 'BC_SUBMITTED',
          'bc_claim_details_id: ' || p_bc_details_id::text);
END;
$$;
```

#### Failure path (called when BC returns non-2xx, throws, or times out; updates the in-flight row to `failed`)

```sql
CREATE OR REPLACE FUNCTION public.record_bc_claim_failure(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB    -- BC error body, parsed error, or { raw_body: "..." } / { error: "timeout" }
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim_id TEXT;
BEGIN
  UPDATE public.bc_claim_details
  SET    bc_status        = 'failed',
         bc_response_json = p_response_json
  WHERE  id        = p_bc_details_id
    AND  bc_status = 'submitting'
  RETURNING claim_id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'BC_DETAILS_NOT_IN_FLIGHT: %', p_bc_details_id USING ERRCODE = 'P0004';
  END IF;

  -- NOTE: claims.bc_claim_details_id stays NULL; claims.status unchanged.
  --       Finance can retry — the partial UNIQUE index allows a new 'submitting' row
  --       only after the previous one has flipped to 'failed'.

  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
  VALUES (v_claim_id, p_actor_user_id, 'BC_SUBMISSION_FAILED',
          'bc_claim_details_id: ' || p_bc_details_id::text);
END;
$$;
```

#### Why the 'submitting' row solves both race AND outbox problems

- **Race (two Finance users hit Submit at once):** First call inserts `'submitting'`. Second call's INSERT raises `unique_violation` on `bc_claim_details_one_active_per_claim` — never reaches the BC API.
- **Outbox (BC POST succeeds but RPC fails before update):** A `'submitting'` row is now stuck in the DB. An admin tool / cron can query `WHERE bc_status = 'submitting' AND created_at < now() - interval '5 minutes'` to find orphans and reconcile manually (look up the BC record, then call `complete_bc_claim` or `record_bc_claim_failure` directly). Without the `'submitting'` state, the DB would have no record at all that an attempt happened.

#### Drop old function

```sql
DROP FUNCTION IF EXISTS public.complete_bc_payment(TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB);
```

---

### 1.3 Recreate DB views (clean slate)

Both dashboard views currently `SELECT c.bc_payments_flag, c.is_vendor_payment` from `claims`. Section 1.1 drops those columns, so the views break the instant the migration runs. Fix: drop and recreate both views with `bc_claim_details` joined in. No backward-compat aliases.

The view bodies below are copied verbatim from the current authoritative definitions in `supabase/migrations/20260512120000_add_payment_flags_to_claims.sql` (admin: lines 7–134, enterprise: lines 136–245), with two surgical changes applied:

- Add `left join public.bc_claim_details bcd on bcd.claim_id = c.id` after the `advance_details` join.
- Replace the trailing `c.bc_payments_flag, c.is_vendor_payment` with `c.bc_claim_details_id, coalesce(bcd.is_vendor_payment, false) as is_vendor_payment`. No derived `is_bc_submitted` boolean — the ID is the single source of truth, and the app derives the boolean as `bcClaimDetailsId != null` wherever it needs one. The `coalesce` on `is_vendor_payment` matches the old column's `NOT NULL DEFAULT false` semantics for claims that have not yet been BC-submitted.

#### `vw_admin_claims_dashboard`

```sql
drop view if exists public.vw_admin_claims_dashboard;

create view public.vw_admin_claims_dashboard
with (security_invoker = 'on') as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(both from u.full_name), ''),
    nullif(trim(both from split_part(u.email, '@', 1)), ''),
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_employee_code), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    nullif(trim(both from u.email), ''),
    'N/A'
  ) as employee_id,
  c.employee_id as claim_employee_id_raw,
  c.on_behalf_employee_code as on_behalf_employee_code_raw,
  nullif(trim(both from u.full_name), '') as submitter_name_raw,
  nullif(trim(both from beneficiary.full_name), '') as beneficiary_name_raw,
  coalesce(nullif(trim(both from md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(both from mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(
    ed.approved_amount,
    ed.requested_total_amount,
    ad.approved_amount,
    ad.requested_total_amount,
    0
  )::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is null then c.updated_at
      else null::timestamp with time zone
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status = any(array[
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ]) then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is not null then c.updated_at
      else null::timestamp with time zone
    end
  ) as finance_action_date,
  coalesce(ed.location_id, ad.location_id) as location_id,
  coalesce(ed.product_id, ad.product_id) as product_id,
  ed.expense_category_id,
  c.submitted_by,
  c.on_behalf_of_id,
  c.on_behalf_email,
  c.assigned_l1_approver_id,
  c.assigned_l2_approver_id,
  c.department_id,
  c.payment_mode_id,
  c.detail_type,
  c.submission_type,
  c.is_active,
  c.created_at,
  c.updated_at,
  c.deleted_by,
  c.deleted_at,
  nullif(trim(both from deleted_by_user.full_name), '') as deleted_by_name,
  case
    when c.deleted_by is null then null::text
    when exists (
      select 1
      from public.admins a
      where a.user_id = c.deleted_by
    ) then 'admin'
    when exists (
      select 1
      from public.master_finance_approvers f
      where f.user_id = c.deleted_by
        and f.is_active = true
    ) then 'finance'
    else 'employee'
  end as deleted_by_role,
  u.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(both from u.full_name), '') is not null and nullif(trim(both from u.email), '') is not null then trim(both from u.full_name) || ' (' || trim(both from u.email) || ')'
    when nullif(trim(both from u.full_name), '') is not null then trim(both from u.full_name)
    when nullif(trim(both from u.email), '') is not null then trim(both from u.email)
    else c.employee_id
  end as submitter_label,
  case
    when c.detail_type = 'expense' then coalesce(nullif(trim(both from mec_name.name), ''), 'Uncategorized')
    else 'Advance'
  end as category_name,
  coalesce(ed.purpose, ad.purpose) as purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path,
  c.bc_claim_details_id,
  coalesce(bcd.is_vendor_payment, false) as is_vendor_payment
from public.claims c
left join public.users u on u.id = c.submitted_by
left join public.users beneficiary on beneficiary.id = c.on_behalf_of_id
left join public.users hod on hod.id = c.assigned_l1_approver_id
left join public.users finance on finance.id = c.assigned_l2_approver_id
left join public.users deleted_by_user on deleted_by_user.id = c.deleted_by
left join public.master_departments md on md.id = c.department_id
left join public.master_payment_modes mpm on mpm.id = c.payment_mode_id
left join public.expense_details ed on ed.claim_id = c.id
left join public.master_expense_categories mec_name on mec_name.id = ed.expense_category_id
left join public.advance_details ad on ad.claim_id = c.id
left join public.bc_claim_details bcd on bcd.claim_id = c.id;
```

#### `vw_enterprise_claims_dashboard`

```sql
drop view if exists public.vw_enterprise_claims_dashboard;

create view public.vw_enterprise_claims_dashboard
with (security_invoker = 'on') as
select
  c.id as claim_id,
  coalesce(
    nullif(trim(both from u.full_name), ''),
    nullif(trim(both from split_part(u.email, '@', 1)), ''),
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    'N/A'
  ) as employee_name,
  coalesce(
    nullif(trim(both from c.employee_id), ''),
    nullif(trim(both from c.on_behalf_employee_code), ''),
    nullif(trim(both from c.on_behalf_email), ''),
    nullif(trim(both from u.email), ''),
    'N/A'
  ) as employee_id,
  c.employee_id as claim_employee_id_raw,
  c.on_behalf_employee_code as on_behalf_employee_code_raw,
  nullif(trim(both from u.full_name), '') as submitter_name_raw,
  nullif(trim(both from beneficiary.full_name), '') as beneficiary_name_raw,
  coalesce(nullif(trim(both from md.name), ''), 'Unknown Department') as department_name,
  coalesce(
    nullif(trim(both from mpm.name), ''),
    case
      when c.detail_type = 'advance' then 'Advance'
      when c.detail_type = 'expense' then 'Expense'
      else 'Unknown'
    end
  ) as type_of_claim,
  coalesce(
    ed.approved_amount,
    ed.requested_total_amount,
    ad.approved_amount,
    ad.requested_total_amount,
    0
  )::numeric(14,2) as amount,
  c.status,
  coalesce(c.submitted_at, c.created_at) as submitted_on,
  coalesce(
    c.hod_action_at,
    case
      when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is null then c.updated_at
      else null::timestamp with time zone
    end
  ) as hod_action_date,
  coalesce(
    c.finance_action_at,
    case
      when c.status = any(array[
        'Finance Approved - Payment under process'::public.claim_status,
        'Payment Done - Closed'::public.claim_status
      ]) then c.updated_at
      when c.status = any(array[
        'Rejected - Resubmission Not Allowed'::public.claim_status,
        'Rejected - Resubmission Allowed'::public.claim_status
      ]) and c.assigned_l2_approver_id is not null then c.updated_at
      else null::timestamp with time zone
    end
  ) as finance_action_date,
  coalesce(ed.location_id, ad.location_id) as location_id,
  coalesce(ed.product_id, ad.product_id) as product_id,
  ed.expense_category_id,
  c.submitted_by,
  c.on_behalf_of_id,
  c.on_behalf_email,
  c.assigned_l1_approver_id,
  c.assigned_l2_approver_id,
  c.department_id,
  c.payment_mode_id,
  c.detail_type,
  c.submission_type,
  c.is_active,
  c.created_at,
  c.updated_at,
  u.email as submitter_email,
  hod.email as hod_email,
  finance.email as finance_email,
  case
    when nullif(trim(both from u.full_name), '') is not null and nullif(trim(both from u.email), '') is not null then trim(both from u.full_name) || ' (' || trim(both from u.email) || ')'
    when nullif(trim(both from u.full_name), '') is not null then trim(both from u.full_name)
    when nullif(trim(both from u.email), '') is not null then trim(both from u.email)
    else c.employee_id
  end as submitter_label,
  case
    when c.detail_type = 'expense' then coalesce(nullif(trim(both from mec_name.name), ''), 'Uncategorized')
    else 'Advance'
  end as category_name,
  coalesce(ed.purpose, ad.purpose) as purpose,
  ed.receipt_file_path,
  ed.bank_statement_file_path,
  ad.supporting_document_path,
  c.bc_claim_details_id,
  coalesce(bcd.is_vendor_payment, false) as is_vendor_payment
from public.claims c
left join public.users u on u.id = c.submitted_by
left join public.users beneficiary on beneficiary.id = c.on_behalf_of_id
left join public.users hod on hod.id = c.assigned_l1_approver_id
left join public.users finance on finance.id = c.assigned_l2_approver_id
left join public.master_departments md on md.id = c.department_id
left join public.master_payment_modes mpm on mpm.id = c.payment_mode_id
left join public.expense_details ed on ed.claim_id = c.id and ed.is_active = true
left join public.master_expense_categories mec_name on mec_name.id = ed.expense_category_id
left join public.advance_details ad on ad.claim_id = c.id and ad.is_active = true
left join public.bc_claim_details bcd on bcd.claim_id = c.id
where c.is_active = true;
```

#### Cascade — every place `bc_payments_flag` / `bcPaymentsFlag` appears

Grouped by change kind. Line numbers reference the state of the repo at spec time; re-grep before editing if drift is possible. Note the type change: the old field was `boolean`, the new field is `string | null` (the FK UUID). App-side boolean checks change from `claim.bcPaymentsFlag` to `claim.bcClaimDetailsId != null`.

**Type field changes** — `bcPaymentsFlag: boolean` → `bcClaimDetailsId: string | null`:

- `src/core/domain/claims/contracts.ts` — 7 occurrences (lines 275, 294, 358, 402, 448, 466, 652)
- `src/modules/claims/repositories/SupabaseClaimRepository.ts` — inline row-type definitions (lines 99, 242, 368, 1741, 3094, 3230, 3342, 3475, 4054). The row-type entry shape becomes `bc_claim_details_id: string | null`.
- `src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts:40` — row-type entry becomes `bc_claim_details_id: string | null`.

**DB column name in SELECT strings** — `bc_payments_flag` → `bc_claim_details_id`:

- `src/modules/claims/repositories/SupabaseClaimRepository.ts` — lines 1808, 3032, 3135, 3274, 3404, 3527, 3631, 3836, 4038
- `src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts:153`

**Row-to-domain mappings** — `bcPaymentsFlag: row.bc_payments_flag` → `bcClaimDetailsId: row.bc_claim_details_id`:

- `src/modules/claims/repositories/SupabaseClaimRepository.ts` — lines 915, 1851, 3064, 3189, 3693, 3917, 4080
- `src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts:266`

**Test fixtures** — `bcPaymentsFlag: false` → `bcClaimDetailsId: null`:

- `tests/unit/claims/supabase-claim-repository.test.ts` (lines 108, 122)
- `tests/unit/claims/supabase-department-viewer-repository.test.ts:198`
- `tests/unit/claims/get-department-view-claims.service.test.ts` (lines 33, 50)
- `tests/unit/claims/get-my-claims.service.test.ts` (lines 20, 34)
- `tests/unit/claims/export-claims.service.test.ts:21`

**Files deleted under the `bc-payment` → `bc-claim` rename (Section 4) — no cascade work needed here:**

- `supabase/functions/bc-payment/types.ts:31` — type field
- `supabase/functions/bc-payment/index.ts:80` — the only conditional read of the field anywhere in the repo (`if (dbPayload.bc_payments_flag)`)
- `supabase/functions/bc-payment/payloadBuilder.test.ts:8` — test fixture

**Verification grep — after the cascade is applied, this command should return zero hits:**

```bash
grep -rn "bc_payments_flag\|bcPaymentsFlag" src/ supabase/functions/bc-claim/ tests/
```

---

### 1.4 TypeScript types (`src/types/database.ts`)

```typescript
// REMOVE:
bc_claim_vendors: { ... }
bc_payment_audit_log: { ... }

// ADD bc_claim_details — bc_status uses the generated enum type, not raw string.
bc_claim_details: {
  Row: {
    id: string
    claim_id: string
    is_vendor_payment: boolean
    bc_status: Database["public"]["Enums"]["bc_claim_status"]   // 'submitting' | 'success' | 'failed'
    bc_payload_json: Json | null
    bc_response_json: Json | null
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    claim_id: string
    is_vendor_payment?: boolean
    bc_status?: Database["public"]["Enums"]["bc_claim_status"]
    bc_payload_json?: Json | null
    bc_response_json?: Json | null
    created_at?: string
    updated_at?: string
  }
  Update: Partial<bc_claim_details['Insert']>
}

// Also add to Enums:
Enums: {
  // ...existing enums
  bc_claim_status: "submitting" | "success" | "failed"
}

// UPDATE claims row type:
// REMOVE: bc_payments_flag: boolean, is_vendor_payment: boolean
// ADD:    bc_claim_details_id: string | null
```

---

## 2. New `bc-reference` Edge Function

**Location:** `supabase/functions/bc-reference/index.ts`

**Purpose:** Serves BC OData reference data for Finance modal dropdowns. Three types supported.

**Request:**

```
GET /bc-reference?type=currencies
GET /bc-reference?type=gstGroupCodes
GET /bc-reference?type=hsnSacCodes
```

**Response shape** (same structure for all three):

```json
{
  "value": [
    { "code": "INR", "description": "Indian Rupee" },
    { "code": "USD", "description": "US Dollar" }
  ]
}
```

**BC OData mapping** (confirmed via live API):

| `type` param  | BC entity path                           | BC fields used        |
| ------------- | ---------------------------------------- | --------------------- |
| currencies    | `/ODataV4/Company('NxtWave')/currencies` | `Code`, `Description` |
| gstGroupCodes | `/ODataV4/Company('NxtWave')/gstGroup`   | `Code`, `Description` |
| hsnSacCodes   | `/ODataV4/Company('NxtWave')/hsnSAC`     | `Code`, `Description` |

All three append `?$select=Code,Description` — BC returns 35 fields for currencies, 9 for gstGroup, 5 for hsnSAC. We return only `code` + `description`.

**Sample edge function logic:**

```typescript
const entityMap: Record<string, string> = {
  currencies: "currencies",
  gstGroupCodes: "gstGroup",
  hsnSacCodes: "hsnSAC",
};

const type = url.searchParams.get("type");
const entity = entityMap[type];
if (!entity) return errorResponse(400, "Unknown type");

const token = await getBcToken();
const bcRes = await fetch(
  `${BC_BASE_URL}/ODataV4/Company('NxtWave')/${entity}?$select=Code,Description`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const data = await bcRes.json();

return Response.json({
  value: data.value.map((r: { Code: string; Description: string }) => ({
    code: r.Code,
    description: r.Description,
  })),
});
```

**Auth + HTTP wrapper:** Reuse `_shared/bcAuth.ts`, `_shared/bcEnv.ts`, and the new generic `_shared/bcClient.ts` (see §5.1). `bcClient.bcFetch()` handles: OAuth2 client-credentials token acquisition with 60-second expiry buffer, single retry on HTTP 401 with a refreshed token, and a 30-second `AbortController` timeout. Both `bc-claim` and `bc-reference` use it.

**In-memory cache (per edge function instance):** Currencies / GST groups / HSN-SAC codes change rarely (weeks to months). The edge function caches each entity's response for **15 minutes** in a module-scoped `Map<entity, { value: ..., expiresAt: number }>`. A cold modal hit on Finance's side may take ~1s; subsequent opens within 15 min are sub-50ms and zero BC traffic. Cache is per Supabase edge-function instance (no shared state — acceptable because BC reference data is idempotent).

**Failure mode:** If the BC call fails (timeout, non-2xx, invalid JSON), the edge function returns HTTP 502 with `{ error: "BC reference fetch failed", type, detail }`. The modal shows an inline "Failed to load — Retry" button per dropdown rather than blocking the whole form.

**Note:** Vendor search continues to be handled by the existing `bc-vendor-search` edge function — kept separate from `bc-reference` because vendor lookup is a search-by-name query (different query semantics, different cache lifetime — vendors change frequently), while `bc-reference` is a small static enumeration.

---

## 3. Edge Function `bc-claim` — Payload Changes

### 3.1 Updated enums (`types.ts`)

```typescript
// DELETE — replaced by BcType below:
// export const BcBalAccountType = { GLAccount: "G/L Account" } as const;

// DELETE — value was "ADVANCE", now "Advance":
// export const BcEmployeeTransactionType = { Advance: "ADVANCE" } as const;

// DELETE — orphan after payload rewrite. The new payload has no `accountType` field;
// `BcAccountType` was only consumed by the old line-item shape.
// export const BcAccountType = { Employee: "Employee", Vendor: "Vendor" } as const;

// NEW fixed-value constants:
export const BcDocumentType = { Invoice: "Invoice" } as const;
export const BcType = { GLAccount: "G/L Account" } as const;
export const BcGstCredit = { NonAvailment: "Non-Availment" } as const;
export const BcGstSubcategory = { Ineligible4344: "Ineligible-43/44" } as const;
export const BcEmployeeTransactionType = { Advance: "Advance" } as const;
export const BcQuantity = 1 as const;
export const BcLocationCode = "HBT" as const;

// Shared between edge function and frontend (mirrored constant).
export const BcReferenceType = {
  Currencies: "currencies",
  GstGroupCodes: "gstGroupCodes",
  HsnSacCodes: "hsnSacCodes",
} as const;
export type BcReferenceType = (typeof BcReferenceType)[keyof typeof BcReferenceType];
```

---

### 3.2 `BcClaimLineItem` interface (`types.ts`)

Full interface for the single object POSTed to BC per claim:

```typescript
export interface BcClaimLineItem {
  // Fixed values — always hardcoded
  documentType: "Invoice"; // BcDocumentType.Invoice
  locationCode: "HBT"; // BcLocationCode
  type: "G/L Account"; // BcType.GLAccount
  quantity: 1; // BcQuantity
  gstCredit: "Non-Availment"; // BcGstCredit.NonAvailment
  gstSubcategory: "Ineligible-43/44"; // BcGstSubcategory.Ineligible4344
  employeeTransactionType: "Advance"; // BcEmployeeTransactionType.Advance

  // From expense_details row
  documentDate: string; // expense_details.transaction_date → "2026-05-10"
  glCode: string; // expense_category_bc_mappings.bc_code → "503063"

  // Employee — depends on submission_type
  // If submission_type = "On_behalf": use on_behalf_employee_code + on_behalf_of_id's full_name
  // If submission_type = "Self":      use claims.employee_id + submitted_by's full_name
  employeeId: string; // e.g. "NW0001234"
  employeeName: string; // e.g. "Arjun Chander"

  // Claim-level fields
  claimNo: string; // claims.id → "CLM-000145"
  remarks: string; // see format below
  programCode: string; // master_program_product_mappings.program_code
  subproductCode: string; // master_sub_product_mappings.sub_product_code
  responsibleDepartment: string; // master_department_responsible_mappings.responsible_department_code
  beneficiaryDepartment: string; // master_department_responsible_mappings.beneficiary_department_code
  regionCode: string; // master_expense_location_mappings.region_code

  // Booleans
  invoiceRequired: boolean; // true if vendor payment, false otherwise
  paymentRequired: boolean; // true if payment_mode_name = "Reimbursement", false otherwise

  // Vendor-only — OMIT ENTIRELY (do not send null/empty) for non-vendor claims
  currencyCode?: string; // Finance modal → bc-reference?type=currencies
  vendorInvoiceNo?: string; // expense_details.bill_no → "INV-2026-001"
  vendorCode?: string; // Finance modal → bc-vendor-search
  vendorName?: string; // Finance modal → bc-vendor-search
  gstGroupCode?: string; // Finance modal → bc-reference?type=gstGroupCodes
  hsnSacCode?: string; // Finance modal → bc-reference?type=hsnSacCodes
}
```

**`remarks` format:**

```
"CLM-000145 - Software subscription
bill - https://xyz.supabase.co/storage/v1/object/public/receipts/inv.pdf
bank statement - https://xyz.supabase.co/storage/v1/object/public/bank/stmt.pdf"
```

Rules:

- Always include: `"{claimId} - {purpose}"`
- Include `bill` line only if `receipt_file_path` is non-null and non-empty
- Include `bank statement` line only if `bank_statement_file_path` is non-null and non-empty
- Use full absolute URLs — not relative storage paths

**Omit pattern for vendor-only fields:**

```typescript
const line: BcClaimLineItem = {
  documentType: "Invoice",
  locationCode: "HBT",
  type: "G/L Account",
  quantity: 1,
  gstCredit: "Non-Availment",
  gstSubcategory: "Ineligible-43/44",
  employeeTransactionType: "Advance",
  documentDate,
  glCode,
  employeeId,
  employeeName,
  claimNo,
  remarks,
  programCode,
  subproductCode,
  responsibleDepartment,
  beneficiaryDepartment,
  regionCode,
  invoiceRequired: isVendorPayment,
  paymentRequired: paymentModeName === "Reimbursement",
  ...(isVendorPayment && {
    currencyCode,
    vendorInvoiceNo: bill_no,
    vendorCode,
    vendorName,
    gstGroupCode,
    hsnSacCode,
  }),
};
```

---

### 3.3 DB function — `get_bc_claim_payload` rewrite

Current function fetches minimal data. Needs a full rewrite to return all fields required to build the payload.

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_already_submitted_id UUID;
  v_payment_mode_name    TEXT;
  v_result               JSONB;
BEGIN
  -- Pre-check 1: claim exists?
  SELECT bc_claim_details_id, mpm.name
    INTO v_already_submitted_id, v_payment_mode_name
  FROM public.claims c
  JOIN public.master_payment_modes mpm ON mpm.id = c.payment_mode_id
  WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: %', p_claim_id USING ERRCODE = 'P0001';
  END IF;

  -- Pre-check 2: already successfully submitted?
  IF v_already_submitted_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: %', v_already_submitted_id USING ERRCODE = 'P0002';
  END IF;

  -- Build payload. DISTINCT ON guards against duplicate mapping rows even
  -- though mapping tables are guaranteed 1:1 per active key (defense in depth).
  SELECT jsonb_build_object(
    'claim_id',                     c.id,
    'payment_mode_name',            v_payment_mode_name,
    'submission_type',              c.submission_type,
    'employee_id',                  c.employee_id,
    'on_behalf_employee_code',      c.on_behalf_employee_code,
    'employee_name',
      CASE WHEN c.submission_type = 'On_behalf'
           THEN COALESCE(onbehalf.full_name, '')
           ELSE COALESCE(submitter.full_name, '')
      END,
    'program_code',                 ppm.program_code,
    'sub_product_code',             spm.sub_product_code,
    'responsible_department_code',  drm.responsible_department_code,
    'beneficiary_department_code',  drm.beneficiary_department_code,
    'region_code',                  elm.region_code,
    'bill_no',                      ed.bill_no,
    'transaction_date',             ed.transaction_date,
    'purpose',                      ed.purpose,
    'receipt_file_path',            ed.receipt_file_path,
    'bank_statement_file_path',     ed.bank_statement_file_path,
    'bc_code',                      ecm.bc_code
  )
  INTO v_result
  FROM public.claims c
  JOIN public.expense_details ed                    ON ed.claim_id = c.id AND ed.is_active = true
  JOIN public.users submitter                       ON submitter.id = c.submitted_by
  LEFT JOIN public.users onbehalf                   ON onbehalf.id = c.on_behalf_of_id
  JOIN public.expense_category_bc_mappings ecm      ON ecm.expense_category_id = ed.expense_category_id AND ecm.is_active = true
  JOIN LATERAL (
    SELECT program_code FROM public.master_program_product_mappings
    WHERE product_id = ed.product_id AND is_active = true LIMIT 1
  ) ppm ON true
  JOIN LATERAL (
    SELECT sub_product_code FROM public.master_sub_product_mappings
    WHERE product_id = ed.product_id AND is_active = true LIMIT 1
  ) spm ON true
  JOIN LATERAL (
    SELECT responsible_department_code, beneficiary_department_code
    FROM public.master_department_responsible_mappings
    WHERE department_id = c.department_id AND is_active = true LIMIT 1
  ) drm ON true
  JOIN LATERAL (
    SELECT region_code FROM public.master_expense_location_mappings
    WHERE location_id = ed.location_id AND is_active = true LIMIT 1
  ) elm ON true
  WHERE c.id = p_claim_id;

  -- Pre-check 3: did all mappings resolve?
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'MISSING_MAPPING: one or more required mappings missing for claim %', p_claim_id
      USING ERRCODE = 'P0003';
  END IF;

  RETURN v_result;
END;
$$;
```

**Error handling — RAISE EXCEPTION, not return-as-value:**

Errors are raised as PG exceptions with custom `SQLSTATE` codes so the edge function can pattern-match them. This is the canonical PL/pgSQL pattern; return-as-value would require every caller to inspect the JSON for an `error` key, which is fragile.

| SQLSTATE | Message prefix      | Meaning                                                                                   |
| -------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `P0001`  | `CLAIM_NOT_FOUND`   | No active claim with that id                                                              |
| `P0002`  | `ALREADY_SUBMITTED` | `claims.bc_claim_details_id` already set — claim was already successfully submitted to BC |
| `P0003`  | `MISSING_MAPPING`   | One of the four LATERAL joins returned no row (mapping table empty for this key)          |

**Return shape on success — flat JSONB object:**

```json
{
  "claim_id": "CLM-000145",
  "payment_mode_name": "Reimbursement",
  "submission_type": "Self",
  "employee_id": "NW0001234",
  "on_behalf_employee_code": null,
  "employee_name": "Arjun Chander",
  "program_code": "COMMON",
  "sub_product_code": "COMMON",
  "responsible_department_code": "GENAI",
  "beneficiary_department_code": "GENAI",
  "region_code": "TELUGU",
  "bill_no": "INV-2026-001",
  "transaction_date": "2026-05-10",
  "purpose": "Software subscription",
  "receipt_file_path": "receipts/CLM-000145/inv.pdf",
  "bank_statement_file_path": null,
  "bc_code": "503063"
}
```

On-behalf example (submission_type = "On_behalf"):

```json
{
  "submission_type": "On_behalf",
  "employee_id": "NW0009999",
  "on_behalf_employee_code": "NW0009999",
  "employee_name": "Ravi Kumar"
}
```

→ Edge function uses `on_behalf_employee_code` for `employeeId` and `employee_name` (resolved from `on_behalf_of_id → users.full_name`) for `employeeName`.

**Note on `paymentRequired`:** The boolean is computed as `payment_mode_name === "Reimbursement"`. This is a string match against a row in `master_payment_modes`. If that row's `name` is ever renamed, this logic silently breaks. Accepted as-is because `"Reimbursement"` is a fixed business term, but call it out in code review if the mapping ever moves.

---

### 3.4 Edge function `bc-claim/index.ts` — request body + flow

**Actor identity comes from the JWT, not the request body.** The modal does NOT send `actorUserId` — the edge function reads `auth.uid()` from the incoming Supabase JWT and passes it to the DB functions. This prevents body-spoofing where a malicious client could attribute the BC submission to another Finance user.

**Request body from Finance modal — vendor payment:**

```json
{
  "claimId": "CLM-000145",
  "isVendorPayment": true,
  "bcVendorCode": "V0001",
  "bcVendorName": "Twilio Inc",
  "currencyCode": "INR",
  "gstGroupCode": "GST18",
  "hsnSacCode": "998314"
}
```

Non-vendor request (vendor fields absent):

```json
{
  "claimId": "CLM-000200",
  "isVendorPayment": false
}
```

**Edge function flow (three-phase: start → POST → complete/fail):**

```
1.  Extract JWT from request → actorUserId = auth.uid()
    Reject 401 if no valid Finance user. Body-supplied actor (if any) is ignored.

2.  Parse + validate request body via zod schema.
    - claimId: required, non-empty string.
    - isVendorPayment: required, boolean.
    - If isVendorPayment === true:
        bcVendorCode, bcVendorName, currencyCode, gstGroupCode, hsnSacCode
        all required and non-empty.
    Reject 400 with { errors: [...] } on validation failure.

3.  Call get_bc_claim_payload(claimId).
    - SQLSTATE P0001 (CLAIM_NOT_FOUND)   → 404
    - SQLSTATE P0002 (ALREADY_SUBMITTED) → 409, no BC call
    - SQLSTATE P0003 (MISSING_MAPPING)   → 422, no BC call

4.  Build the BC payload via payloadBuilder
    (merges DB payload + modal vendor fields; vendor-only fields spread-omitted
    when isVendorPayment === false).

5.  CLAIM THE IN-FLIGHT SLOT — call start_bc_claim_attempt(claimId, isVendorPayment, payload).
    - On success: returns bcDetailsId (status = 'submitting').
    - On unique_violation (23505): another submission is in-flight or already succeeded.
      → 409 ALREADY_IN_FLIGHT. Do NOT call BC.
    From this point, any control flow ends with EXACTLY ONE call to complete_bc_claim
    or record_bc_claim_failure — never neither, never both.

6.  POST payload to BC via _shared/bcClient.bcFetch(POST, /Claims, payload):
      - 30-second AbortController timeout.
      - Single retry on HTTP 401 (BC token expired mid-flight).
      - If the response body is not valid JSON, capture { raw_body: text } as the
        response payload instead of throwing.

7a. On HTTP 2xx from BC:
      CALL complete_bc_claim(bcDetailsId, actorUserId, bcResponseJson)
      Return 200 { success: true, bcClaimDetailsId: bcDetailsId }.

7b. On HTTP non-2xx, timeout, network error, or invalid JSON:
      CALL record_bc_claim_failure(bcDetailsId, actorUserId, errorJson)
      Return 502 { success: false, error: errorJson }.

7c. CATASTROPHIC PATH — BC returns 2xx but step 7a's RPC fails (DB hiccup,
    connection drop) BEFORE the row is flipped to 'success':
      The 'submitting' row is now orphaned in the DB. BC has the record.
      → Return 500 { success: false, error: "RPC_FAILED_AFTER_BC_SUCCESS",
                     bcClaimDetailsId: bcDetailsId }.
      The frontend MUST display "submission accepted by BC but local sync failed —
      contact admin" and NOT retry. An admin tool / cron job reconciles by querying
      `WHERE bc_status = 'submitting' AND created_at < now() - interval '5 minutes'`,
      looking up the BC record by claim_id, and calling complete_bc_claim or
      record_bc_claim_failure directly. See §1.2 outbox commentary.
```

**Error → HTTP status table:**

| Condition                                      | HTTP | Body                                                                         |
| ---------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| Missing / invalid JWT                          | 401  | `{ error: "UNAUTHENTICATED" }`                                               |
| Body validation fail                           | 400  | `{ error: "INVALID_BODY", details: [...] }`                                  |
| `CLAIM_NOT_FOUND` (P0001)                      | 404  | `{ error: "CLAIM_NOT_FOUND", claimId }`                                      |
| `ALREADY_SUBMITTED` (P0002, FK already set)    | 409  | `{ error: "ALREADY_SUBMITTED", bcClaimDetailsId }`                           |
| `unique_violation` on `start_bc_claim_attempt` | 409  | `{ error: "ALREADY_IN_FLIGHT" }`                                             |
| `MISSING_MAPPING` (P0003)                      | 422  | `{ error: "MISSING_MAPPING" }`                                               |
| BC HTTP 4xx                                    | 502  | `{ success: false, error: bcResponse }`                                      |
| BC HTTP 5xx / timeout / network / invalid JSON | 502  | `{ success: false, error: bcResponse }`                                      |
| RPC fail AFTER BC 2xx (catastrophic)           | 500  | `{ success: false, error: "RPC_FAILED_AFTER_BC_SUCCESS", bcClaimDetailsId }` |

---

## 4. UI — BC Claim Modal

**File:** `src/modules/claims/ui/bc-claim-modal.tsx` (renamed from `bc-payment-modal.tsx`)

### 4.0 When the modal opens

The modal is the Finance approval action. It opens when:

- The Finance user clicks the **Approve** button on a claim whose `status = 'HOD approved - Awaiting finance approval'`
- AND the claim is in expense mode (`isExpenseModeApprove === true` — same UI condition the old `BcPaymentModal` used, preserved as-is)
- AND `claim.bcClaimDetailsId === null` — claims already successfully submitted to BC cannot be re-submitted. The Approve button is hidden / disabled when this is non-null. (The edge function and DB enforce this anyway via `ALREADY_SUBMITTED`; the UI guard is a UX nicety so Finance doesn't see a misleading button.)

On Submit, the claim transitions to `'Finance Approved - Payment under process'` (handled inside `complete_bc_claim`).

### 4.1 Dropdown fields — vendor payment only

These three dropdowns appear **only when Finance toggles "Vendor Payment" on**. They are fetched from `bc-reference` lazily — when the vendor toggle is enabled, not on modal mount.

| Field          | Edge function call                     | What displays in dropdown |
| -------------- | -------------------------------------- | ------------------------- |
| Currency Code  | `GET /bc-reference?type=currencies`    | `"INR - Indian Rupee"`    |
| GST Group Code | `GET /bc-reference?type=gstGroupCodes` | `"GST18 - GST 18%"`       |
| HSN/SAC Code   | `GET /bc-reference?type=hsnSacCodes`   | `"998314 - IT Services"`  |

Vendor Code + Vendor Name use the existing `bc-vendor-search` — no change.

### 4.1a Field validation — vendor payment

All five vendor-only fields are **mandatory** when `isVendorPayment === true`. Two layers of validation:

**Client-side (form schema — zod / react-hook-form):**

```typescript
const bcVendorPaymentSchema = z.object({
  isVendorPayment: z.literal(true),
  bcVendorCode: z.string().min(1, "Vendor code is required"),
  bcVendorName: z.string().min(1, "Vendor name is required"),
  currencyCode: z.string().min(1, "Currency is required"),
  gstGroupCode: z.string().min(1, "GST group is required"),
  hsnSacCode: z.string().min(1, "HSN/SAC is required"),
});
```

Submit button stays disabled until all five validate. Per-field error text shown inline beneath the dropdown.

**Server-side (edge function — see Section 3.4 step 2):** mirrors the same checks. Rejects with HTTP 400 and a JSON list of missing fields if any are absent or empty. This guards against malicious clients bypassing the form schema.

Non-vendor payment: all five fields are omitted entirely from the request body (not sent as null/empty).

### 4.2 Updated payload sent to `bc-claim` edge function

Vendor payment submission:

```typescript
supabase.functions.invoke("bc-claim", {
  body: {
    claimId: claim.id,
    isVendorPayment: true,
    bcVendorCode: selectedVendor.code,
    bcVendorName: selectedVendor.name,
    currencyCode: selectedCurrency.code, // "INR"
    gstGroupCode: selectedGstGroup.code, // "GST18"
    hsnSacCode: selectedHsnSac.code, // "998314"
  },
});
```

Non-vendor payment submission:

```typescript
supabase.functions.invoke("bc-claim", {
  body: {
    claimId: claim.id,
    isVendorPayment: false,
  },
});
```

The Finance user id is **not** sent in the body — the edge function reads it from the JWT (`auth.uid()`). The Supabase JS client attaches the JWT automatically when invoked from an authenticated session.

---

## 5. Rename: `bc-payment` → `bc-claim` Throughout

### 5.1 Edge function directory + shared client

```
supabase/functions/bc-payment/  →  supabase/functions/bc-claim/
```

Files that move with the rename: `index.ts`, `types.ts`, `payloadBuilder.ts`, `payloadBuilder.test.ts`.

**Promoted to `_shared/`** — these are no longer BC-payment-specific because `bc-claim` and `bc-reference` both use them:

| From                             | To                    | Reason                                                                                                                                                                             |
| -------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bc-payment/bcPaymentsClient.ts` | `_shared/bcClient.ts` | Generic BC HTTP wrapper. Used by `bc-claim` (POST /Claims) and `bc-reference` (GET /ODataV4/...). Filename no longer mentions "payments" — what it does is "talk to BC over HTTP." |
| `_shared/bcAuth.ts`              | `_shared/bcAuth.ts`   | Already shared. Extend with single-retry-on-401 logic (see §3.4 step 6 / §2).                                                                                                      |
| `_shared/bcEnv.ts`               | `_shared/bcEnv.ts`    | Already shared. No changes — vars: `BC_BASE_URL`, `BC_TENANT_ID`, `BC_COMPANY_ID`, `BC_CLIENT_ID`, `BC_CLIENT_SECRET`.                                                             |

`_shared/bcClient.ts` exports a single `bcFetch(method, path, body?)` helper that handles auth (token cache + 60s expiry buffer), 401 retry, `AbortController` 30s timeout, and invalid-JSON capture. Both edge functions consume this — no duplicated fetch code.

**Test file rewrite:** `bc-payment/payloadBuilder.test.ts` contains assertions for the old shape (`assertEquals(l.balAccountType, "G/L Account")`) that no longer exist. It is **rewritten from scratch** for the new `BcClaimLineItem` payload — both vendor and non-vendor branches, omit-spread verified, fixed-value constants asserted.

### 5.2 DB cleanup — already covered by the Section 1 migrations

| Artifact dropped                    | Migration                                    | Section |
| ----------------------------------- | -------------------------------------------- | ------- |
| `bc_payment_audit_log` table        | `20260517090000_bc_claim_details_schema.sql` | 1.1     |
| `bc_payment_audit_status` enum      | `20260517090000_bc_claim_details_schema.sql` | 1.1     |
| `bc_bal_account_type` enum          | `20260517090000_bc_claim_details_schema.sql` | 1.1     |
| `bc_claim_vendors` table            | `20260517090000_bc_claim_details_schema.sql` | 1.1     |
| `complete_bc_payment(...)` function | `20260517090100_bc_claim_functions.sql`      | 1.2     |

No replacement audit table is created — audit lives entirely in `bc_claim_details` (`bc_status` + `bc_payload_json` + `bc_response_json`) plus `claim_audit_logs` entries written by `complete_bc_claim` / `record_bc_claim_failure`.

### 5.3 Frontend renames

| Old                                                             | New                       |
| --------------------------------------------------------------- | ------------------------- |
| `src/modules/claims/ui/bc-payment-modal.tsx`                    | `bc-claim-modal.tsx`      |
| `BcPaymentModal` component                                      | `BcClaimModal`            |
| `supabase.functions.invoke("bc-payment", ...)`                  | `invoke("bc-claim", ...)` |
| `import { BcPaymentModal }` in `claim-decision-action-form.tsx` | `import { BcClaimModal }` |

### 5.4 Domain / repository layer

| Old                                               | New                                                      |
| ------------------------------------------------- | -------------------------------------------------------- |
| `bcPaymentsFlag: boolean` in `contracts.ts`       | `bcClaimDetailsId: string \| null`                       |
| `isVendorPayment` in `contracts.ts`               | `isVendorPayment: boolean` (keep, still used)            |
| `bc_payments_flag` in repository SELECT strings   | `bc_claim_details_id`                                    |
| `bc_payments_flag: row.bc_payments_flag` mappings | `bcClaimDetailsId: row.bc_claim_details_id`              |
| `claim.bcPaymentsFlag` in UI files                | `claim.bcClaimDetailsId != null` (where boolean is used) |

Single source of truth: the FK ID. App code derives the "has been submitted" boolean from `bcClaimDetailsId != null` at the point of use — no redundant boolean field.

`bc-vendor-search` edge function is **not renamed** — vendor lookup, unrelated to claim posting.

---

## 6. Summary of All File Changes

| File                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260517090000_bc_claim_details_schema.sql`        | Drop `bc_claim_vendors`, `bc_payment_audit_log`, `bc_payment_audit_status`, `bc_bal_account_type`. Create `bc_claim_status` ENUM (`'submitting'`/`'success'`/`'failed'`). Create `bc_claim_details` table with partial UNIQUE index on `(claim_id) WHERE bc_status IN ('submitting','success')`, lookup index, per-table `updated_at` trigger, and RLS policies. Drop old columns from `claims`, add `bc_claim_details_id` FK. Extend `claim_audit_logs` CHECK with `BC_SUBMITTED` and `BC_SUBMISSION_FAILED`. |
| `supabase/migrations/20260517090100_bc_claim_functions.sql`             | Drop `complete_bc_payment`. Rewrite `get_bc_claim_payload` (RAISE EXCEPTION error model, LATERAL joins). Create `start_bc_claim_attempt`, `complete_bc_claim`, `record_bc_claim_failure` — three-phase lifecycle.                                                                                                                                                                                                                                                                                              |
| `supabase/migrations/20260517090200_recreate_bc_dashboard_views.sql`    | Drop and recreate `vw_admin_claims_dashboard` and `vw_enterprise_claims_dashboard` with `LEFT JOIN bc_claim_details` and `bc_claim_details_id` + `is_vendor_payment` columns.                                                                                                                                                                                                                                                                                                                                  |
| `src/types/database.ts`                                                 | Remove `bc_claim_vendors`, `bc_payment_audit_log`, `bc_bal_account_type`, `bc_payment_audit_status` types. Add `bc_claim_details` row type + `bc_claim_status` enum type. Update `claims` row type.                                                                                                                                                                                                                                                                                                            |
| `supabase/functions/_shared/bcClient.ts`                                | NEW — generic BC HTTP wrapper (moved from `bc-payment/bcPaymentsClient.ts`). Token cache + 401 retry + 30s timeout + invalid-JSON capture.                                                                                                                                                                                                                                                                                                                                                                     |
| `supabase/functions/_shared/bcAuth.ts`                                  | Extend: 401-retry helper used by `bcClient`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `supabase/functions/bc-reference/index.ts`                              | NEW edge function — currencies, gstGroupCodes, hsnSacCodes. 15-min in-memory cache. Uses `_shared/bcClient`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `supabase/functions/bc-claim/` (dir rename from `bc-payment/`)          | Directory rename. `bcPaymentsClient.ts` MOVED to `_shared/bcClient.ts` (not copied — old file deleted).                                                                                                                                                                                                                                                                                                                                                                                                        |
| `supabase/functions/bc-claim/types.ts`                                  | Replace enums: drop `BcBalAccountType`, `BcAccountType`. Add `BcDocumentType`, `BcType`, `BcGstCredit`, `BcGstSubcategory`, `BcQuantity`, `BcLocationCode`, `BcReferenceType`. Update `BcEmployeeTransactionType` value to `"Advance"`. Add `BcClaimLineItem` interface.                                                                                                                                                                                                                                       |
| `supabase/functions/bc-claim/payloadBuilder.ts`                         | Rewrite: single flat object, locationCode = "HBT", vendor spread, no line-item array.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `supabase/functions/bc-claim/payloadBuilder.test.ts`                    | Full rewrite for the new payload shape — old `balAccountType` assertion removed.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `supabase/functions/bc-claim/index.ts`                                  | New request body shape, JWT-based actor, three-phase flow (`start_bc_claim_attempt` → BC POST → `complete_bc_claim` / `record_bc_claim_failure`), 30s timeout, invalid-JSON capture, catastrophic-RPC-fail handling.                                                                                                                                                                                                                                                                                           |
| `supabase/functions/.env.example`                                       | NEW — placeholder values for `BC_BASE_URL`, `BC_TENANT_ID`, `BC_COMPANY_ID`, `BC_CLIENT_ID`, `BC_CLIENT_SECRET`.                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/modules/claims/ui/bc-claim-modal.tsx` (renamed)                    | Three vendor-only dropdowns with loading/error/retry states, zod schema, updated invoke body. Detailed UI handoff via `superpowers:frontend-design` skill at implementation time.                                                                                                                                                                                                                                                                                                                              |
| `src/modules/claims/ui/claim-decision-action-form.tsx`                  | Import `BcClaimModal`. Approve-button-disabled condition: `claim.bcClaimDetailsId != null`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/core/domain/claims/contracts.ts`                                   | Replace `bcPaymentsFlag: boolean` with `bcClaimDetailsId: string \| null` (7 occurrences).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/core/domain/claims/utils.ts` (or new)                              | NEW helper `isBcSubmitted(claim): boolean` = `claim.bcClaimDetailsId != null`. Used wherever the boolean semantic is needed.                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/modules/claims/repositories/SupabaseClaimRepository.ts`            | Replace `bc_payments_flag` → `bc_claim_details_id` in all SELECT strings, row types, and mappings.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts` | Same — replace `bc_payments_flag` → `bc_claim_details_id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/api/postman/` (NEW directory)                                     | Move all four Postman collections out of repo root: `NxtClaim.postman_collection.json`, `NxtClaimCurrency.postman_collection.json`, `NxtClaimGSTGroupCodes.postman_collection.json`, `NxtClaimHSNSACCodes.postman_collection.json`. Replace hardcoded URLs / tenant / company / bearer tokens with `{{baseUrl}}` / `{{tenantId}}` / `{{companyId}}` / `{{bearerToken}}` variables.                                                                                                                             |
| `docs/api/postman/bc-sandbox.postman_environment.json` (NEW)            | Postman environment file holding the four variables above. Bearer token left as empty placeholder — test-env tokens are not committed.                                                                                                                                                                                                                                                                                                                                                                         |
| `.gitignore`                                                            | Add `*.postman_environment.json` for any local environment files containing real tokens.                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 7. Verification

1. **DB migration clean:** `supabase db push` — no errors; `bc_claim_vendors`, `bc_payment_audit_log`, `bc_payment_audit_status`, `bc_bal_account_type` are all gone; `bc_claim_details` exists with `bc_claim_status` enum column.
2. **Views resolve:** `SELECT bc_claim_details_id, is_vendor_payment FROM vw_admin_claims_dashboard LIMIT 1` — no error; `bc_payments_flag` is gone.
3. **bc-reference (currencies):** `GET /bc-reference?type=currencies` → `{ value: [{ code: "INR", description: "Indian Rupee" }, ...] }`. Second hit within 15 min returns identical body in <50ms (cache).
4. **bc-reference (gstGroupCodes):** `GET /bc-reference?type=gstGroupCodes` → non-empty array.
5. **bc-reference (hsnSacCodes):** `GET /bc-reference?type=hsnSacCodes` → non-empty array.
6. **bc-reference failure UX:** Force `BC_BASE_URL` to an unreachable host → endpoint returns 502, modal renders "Retry" button per failed dropdown.
7. **Non-vendor claim POST:** BC receives payload with no `currencyCode`, `vendorCode`, `vendorName`, `gstGroupCode`, `hsnSacCode` keys at all — not null, not empty string, fully absent.
8. **Vendor claim POST:** BC receives all 26 fields including vendor-only fields; `invoiceRequired: true`.
9. **Success path rows:** `bc_status` transitions `submitting` → `success`; `bc_payload_json` has full payload; `bc_response_json` has BC body; `claims.bc_claim_details_id` is set; `claim_audit_logs` has `action_type = 'BC_SUBMITTED'`.
10. **Failure path rows:** `bc_status` transitions `submitting` → `failed`; `bc_response_json` has BC error; `claims.bc_claim_details_id` remains NULL; `claim_audit_logs` has `action_type = 'BC_SUBMISSION_FAILED'`.
11. **Race — DB level:** Manually INSERT two `'submitting'` rows for the same claim → second INSERT raises `unique_violation` on `bc_claim_details_one_active_per_claim`.
12. **Race — edge function level:** Invoke `bc-claim` twice concurrently for the same claim → exactly one reaches BC; the other returns 409 `ALREADY_IN_FLIGHT`.
13. **ALREADY_SUBMITTED:** Invoke `bc-claim` for a claim with non-null `bc_claim_details_id` → HTTP 409 `ALREADY_SUBMITTED`; no BC POST.
14. **Timeout:** Mock BC to sleep 35s → edge function aborts at 30s, returns 502 `{ error: "timeout" }`, row flipped to `failed`.
15. **Invalid JSON body from BC:** Mock BC to return `text/plain` body → edge function captures `{ raw_body: "..." }` in `bc_response_json`, row flipped to `failed`, returns 502.
16. **Token expiry mid-flight:** Mock BC to return 401 on first call, 2xx on retry → edge function refreshes token, retries, succeeds. `claim_audit_logs` shows a single `BC_SUBMITTED`, not two.
17. **Catastrophic — BC 2xx, RPC fail:** Stub `complete_bc_claim` to raise → edge function returns 500 `RPC_FAILED_AFTER_BC_SUCCESS`; orphaned `'submitting'` row remains; reconciliation tooling can pick it up.
18. **Actor identity:** Invoke `bc-claim` without a JWT → HTTP 401; never reaches BC. Body-supplied `actorUserId` is ignored.
19. **RLS:** Submitter user can `SELECT * FROM bc_claim_details WHERE claim_id = '<their claim>'`; same user against another submitter's claim → zero rows.
20. **TypeScript:** `tsc --noEmit` clean.
21. **Cleanup grep — zero hits expected:**
    ```bash
    grep -rn "bc_payments_flag\|bcPaymentsFlag\|BcBalAccountType\|BcAccountType\|bc_bal_account_type\|bcPaymentsClient\|BcPaymentModal\|bc-payment-modal\|bc_payment_audit" src/ supabase/functions/ tests/
    ```

---

## 8. Test Plan

Scaled-finance integrations need more than `tsc --noEmit`. Coverage required:

**Deno unit tests** (`supabase/functions/bc-claim/*.test.ts`, `supabase/functions/bc-reference/*.test.ts`):

- `payloadBuilder.test.ts` — vendor and non-vendor branches; assert all 26 fields in vendor case; assert exactly 20 fields and zero vendor keys in non-vendor case; fixed-value constants verified from `types.ts` exports (not hardcoded strings); on-behalf vs self employee-resolution branches.
- `bcClient.test.ts` (`_shared/`) — token cache hit/miss, 401-retry, 30s timeout via `AbortController`, invalid-JSON capture into `{ raw_body }`.
- `bc-reference/index.test.ts` — entity-map dispatch, `Code → code` / `Description → description` lowercasing, 15-min cache hit, BC-unreachable returns 502 not 200, unknown `type` returns 400.

**pgTAP tests** (`tests/db/bc_claim_details.sql`):

- Inserting two `'submitting'` rows for the same claim raises `unique_violation`.
- `'submitting'` → `'success'` flips the FK on `claims` and inserts the audit row in one transaction (rollback the txn → both rolled back).
- `'submitting'` → `'failed'` leaves `claims.bc_claim_details_id` NULL.
- Calling `complete_bc_claim` on a row already in `'success'` raises `BC_DETAILS_NOT_IN_FLIGHT`.
- RLS: a non-finance / non-admin / non-submitter user gets zero rows from `bc_claim_details`.

**Jest integration tests** (`tests/integration/bc-claim/*.test.ts`):

- Happy path: submit → assert row state, audit row, claim status, claim FK.
- ALREADY_SUBMITTED: pre-set FK on `claims` → invoke → assert 409 without BC call (BC mock asserted zero hits).
- ALREADY_IN_FLIGHT: pre-insert `'submitting'` row → invoke → assert 409.
- MISSING_MAPPING: delete a mapping row → assert 422.
- Catastrophic: stub `complete_bc_claim` to raise → invoke with BC mock returning 2xx → assert 500, orphan `'submitting'` row exists.

**Race test** (`tests/integration/bc-claim/race.test.ts`):

- Fire 5 concurrent invocations for the same claim id → assert exactly 1 reaches the BC mock, the other 4 return 409.

**Frontend tests** (`src/modules/claims/ui/bc-claim-modal.test.tsx`, Jest + Testing Library):

- Vendor toggle off → vendor dropdowns not rendered, Submit enabled.
- Vendor toggle on → three dropdowns rendered, Submit disabled until all five fields filled.
- `bc-reference` returns 502 → "Retry" button rendered, dropdown disabled.
- Submit → calls `supabase.functions.invoke("bc-claim", ...)` with correct body shape.
- Success response → modal closes, success toast fires.
- 409 ALREADY_SUBMITTED response → user-facing message "already submitted".

**Optional but recommended at scale:** k6 / Artillery load test with 20 concurrent finance users approving distinct claims, asserting p95 latency < 5s and zero data integrity violations.

---

## 9. Frontend handoff (`superpowers:frontend-design` skill)

`bc-claim-modal.tsx` design has business rules locked here (§4) but not visual layout, micro-states, or component tree. At implementation time, invoke `superpowers:frontend-design` with this section as the brief:

- **Modal title:** "Approve & Submit to BC" (or repo-consistent equivalent).
- **Sections:** (1) Claim summary (claim id, amount, purpose, payment mode — read-only); (2) Vendor toggle (radio: "Reimbursement / Non-vendor" | "Vendor Payment"); (3) Vendor-only fields (Vendor Code+Name via `bc-vendor-search`, Currency, GST Group, HSN/SAC via `bc-reference`) — collapsed and unmounted when toggle is "Non-vendor"; (4) Footer (Cancel button + Submit button).
- **Dropdown states:** loading spinner inside trigger; error state with inline "Retry" link; empty state ("No options available").
- **Submit states:** disabled until form validates; spinner + "Submitting…" while in-flight; auto-close on success; inline error banner on 4xx/5xx (BC error message visible to Finance).
- **Catastrophic 500:** persistent banner "BC accepted submission but local sync failed. Do not retry. Contact admin." — modal stays open with a Close button.
- **Accessibility:** focus-trap on open; ESC closes only when not in-flight; first focus on vendor toggle.

---

## 10. Currency handling — locked decision

**Locked: `currencyCode` is informational metadata only.**

The new BC payload has **no amount field** (the old `amount`/`claimAmount`/`approvedAmount` keys were removed by BC). BC looks up the claim's amount internally using `claimNo` (e.g. `"CLM-000145"`).

This means:

- Finance can pick any currency in the dropdown — `bc-reference?type=currencies` returns the full list, unfiltered.
- We send `currencyCode: "<picked>"` to BC. No conversion math is done on our side because there is no amount to convert.
- BC takes responsibility for matching `currencyCode` to its internal claim record.

`approved_amount` is **NOT sent to BC** and is **NOT included in `get_bc_claim_payload`'s return shape** (removed — see §3.3). Auditors who need historical claim amounts read `expense_details.approved_amount` directly.

---
