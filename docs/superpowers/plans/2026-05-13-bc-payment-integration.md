# BC Payment Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire NxtClaimV2 to send Reimbursement claims to Microsoft Business Central at Finance Approval time, via two Supabase Edge Functions (`bc-payment`, `bc-vendor-search`), with an atomic DB transition and an audit log that survives partial failures. Single-claim only in this plan; bulk approval through BC is a named follow-up.

**Architecture:** Frontend modal collects payment-type choice (and vendor if applicable) → invokes `bc-payment` Edge Function → Edge Function pre-flight-validates (finance-approver auth, `bc_payments_flag`, mappings) via `get_bc_claim_payload(claim_id)` DB function → writes PENDING audit log row → calls BC Payments API (1 POST for non-vendor, 2 sequential POSTs for vendor) → on success, atomically updates `claims`, inserts `bc_claim_vendors`, writes `claim_audit_log` `L2_APPROVED` entry, and marks audit row `SUCCESS` via `complete_bc_payment(...)` DB function. A `dryRun: true` flag returns the would-be payload without any side effect. Vendor search is a separate JWT-verified Edge Function that proxies BC's OData vendor endpoint with `$filter contains` + `$top=20`.

**Tech Stack:** Postgres (Supabase), Deno (Supabase Edge Functions), TypeScript, Next.js 16 (server actions for the surrounding approve flow, but new BC code uses `supabase.functions.invoke` from the browser client), shadcn/ui + Radix Dialog + React Hook Form for the modal, Zod at every input boundary, Jest for any Next.js-side unit tests, Deno's built-in test runner for Edge Function pure modules.

**Authoritative references** the implementer must keep open:

- `plan_bc.md` (repo root) — behavioural spec; every SQL/TS snippet there is reference-only and must be reconciled against actual code before pasting.
- `/Users/arjun/.claude/plans/plan-bc-md-next-public-supabase-url-htt-splendid-pumpkin.md` — architecture/sequencing plan (this implementation plan is the executable form of that).
- `postman/sandbox/bc-claims-api.postman_collection.json` and `postman/sandbox/bc-vendor-api.postman_collection.json` — API contract truth.
- `src/modules/claims/repositories/SupabaseClaimRepository.ts:1633-1730` (`updateClaimL2Decision`) — defines what side effects the existing Finance approve produces. `complete_bc_payment` must produce the same side effects on the claim.

---

## File Structure

**New files** (in implementation order):

| Path                                                            | Responsibility                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_fix_bc_claim_vendors_nullability.sql` | Drop NOT NULL on `bc_vendor_id`/`bc_vendor_name`.                                                               |
| `supabase/migrations/<ts>_bc_payment_integration_infra.sql`     | Create enums, `bc_payment_audit_log` table, `get_bc_claim_payload`, `complete_bc_payment` DB functions. Grants. |
| `supabase/functions/_shared/bcEnv.ts`                           | Single typed reader for all `BC_*` env vars; throws fast on missing.                                            |
| `supabase/functions/_shared/bcAuth.ts`                          | OAuth2 client-credentials token fetch + in-memory cache.                                                        |
| `supabase/functions/_shared/bcAuth.test.ts`                     | Deno tests for cache behaviour.                                                                                 |
| `supabase/functions/bc-vendor-search/index.ts`                  | Vendor autocomplete proxy.                                                                                      |
| `supabase/functions/bc-payment/types.ts`                        | All BC interfaces, enums, error union.                                                                          |
| `supabase/functions/bc-payment/payloadBuilder.ts`               | Pure: DB payload + vendor choice → `BcClaimLineItem[]`.                                                         |
| `supabase/functions/bc-payment/payloadBuilder.test.ts`          | Full TDD coverage of payload shape rules.                                                                       |
| `supabase/functions/bc-payment/bcPaymentsClient.ts`             | HTTP client for `POST .../Claims`, 401-retry-once.                                                              |
| `supabase/functions/bc-payment/index.ts`                        | 7-step orchestration; `dryRun` branch.                                                                          |
| `src/modules/claims/ui/bc-payment-modal.tsx`                    | Modal with radio + vendor search.                                                                               |
| `docs/runbooks/bc-payment-stuck-rows.md`                        | Monitoring SQL + manual resolution steps.                                                                       |

**Modified files**:

| Path                                                                                                     | Change                                                                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/modules/claims/ui/claim-decision-action-form.tsx` (and any direct caller of `approveFinanceAction`) | Intercept Reimbursement approve clicks; show BC modal instead of calling `approveFinanceAction`. |

**Reused (not modified)**:

- `src/components/ui/dialog.tsx`, `src/hooks/use-debounced-value.ts`, `src/core/infra/supabase/browser-client.ts`, `src/core/constants/payment-modes.ts`, `src/core/constants/statuses.ts`.

---

## Task 1: Migration — drop NOT NULL on `bc_claim_vendors` vendor fields

**Files:**

- Create: `supabase/migrations/20260513150000_fix_bc_claim_vendors_nullability.sql`

- [ ] **Step 1: Write the migration**

```sql
BEGIN;

ALTER TABLE public.bc_claim_vendors
  ALTER COLUMN bc_vendor_id   DROP NOT NULL,
  ALTER COLUMN bc_vendor_name DROP NOT NULL;

COMMIT;
```

- [ ] **Step 2: Apply locally (dry run first)**

Run: `npm run db:migrate:dry-run`
Expected: lists the new migration without applying it.

Then: `npm run db:migrate`
Expected: `Applied 20260513150000_fix_bc_claim_vendors_nullability.sql` (or equivalent success line for your migration runner).

- [ ] **Step 3: Verify the schema change**

Connect to the local DB and run:

```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bc_claim_vendors'
  AND column_name IN ('bc_vendor_id', 'bc_vendor_name');
```

Expected: both rows show `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260513150000_fix_bc_claim_vendors_nullability.sql
git commit -m "fix(bc): drop NOT NULL on bc_claim_vendors vendor columns

Non-vendor payments have no vendor; NULL is the correct sentinel,
not an empty string. Restores parity with plan_bc.md schema."
```

---

## Task 2: Migration — BC enums + `bc_payment_audit_log` table

**Files:**

- Create: `supabase/migrations/20260513151000_bc_payment_audit_log.sql`

- [ ] **Step 1: Write the migration**

```sql
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
CREATE TABLE IF NOT EXISTS public.bc_payment_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          TEXT NOT NULL REFERENCES public.claims(id),
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

ALTER TABLE public.bc_payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role only — Edge Function reads/writes via service role key.
GRANT ALL ON TABLE public.bc_payment_audit_log TO service_role;

COMMIT;
```

- [ ] **Step 2: Apply locally**

Run: `npm run db:migrate`
Expected: success line for `20260513151000_bc_payment_audit_log.sql`.

- [ ] **Step 3: Verify enums and table**

```sql
SELECT typname FROM pg_type
WHERE typname IN ('bc_account_type', 'bc_employee_transaction_type',
                  'bc_bal_account_type', 'bc_payment_audit_status');

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bc_payment_audit_log'
ORDER BY ordinal_position;
```

Expected: 4 enum rows; table has 9 columns matching the migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260513151000_bc_payment_audit_log.sql
git commit -m "feat(bc): add BC enums and bc_payment_audit_log table

Enums make BC payload values explicit (Employee/Vendor, ADVANCE,
G/L Account). Audit log is the safety net for BC-succeeded /
DB-failed scenarios; runbook in docs/runbooks/."
```

---

## Task 3: Migration — `get_bc_claim_payload` DB function

This function is called by the Edge Function in pre-flight. One round-trip; returns either the full payload data as JSONB, or a structured error JSONB naming the missing piece.

**Files:**

- Create: `supabase/migrations/20260513152000_get_bc_claim_payload.sql`

- [ ] **Step 1: Write the migration**

The function joins `claims` + active `expense_details` + the 5 mapping tables + `master_payment_modes`. On any missing mapping or wrong payment mode, returns `{"error": "...", "field": "..."}`.

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_claim                RECORD;
  v_expense              RECORD;
  v_payment_mode_name    TEXT;
  v_bc_code              TEXT;
  v_program_code         TEXT;
  v_sub_product_code     TEXT;
  v_responsible_dept     TEXT;
  v_beneficiary_dept     TEXT;
  v_region_code          TEXT;
BEGIN
  SELECT c.id, c.employee_id, c.department_id, c.payment_mode_id,
         c.bc_payments_flag, c.is_active
    INTO v_claim
    FROM public.claims c
   WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CLAIM_NOT_FOUND', 'claim_id', p_claim_id);
  END IF;

  SELECT name INTO v_payment_mode_name
    FROM public.master_payment_modes
   WHERE id = v_claim.payment_mode_id;

  IF lower(trim(coalesce(v_payment_mode_name, ''))) <> 'reimbursement' THEN
    RETURN jsonb_build_object('error', 'NOT_REIMBURSEMENT',
                              'payment_mode', coalesce(v_payment_mode_name, '<null>'));
  END IF;

  SELECT ed.purpose, ed.receipt_file_path, ed.bank_statement_file_path,
         ed.approved_amount, ed.expense_category_id, ed.product_id, ed.location_id
    INTO v_expense
    FROM public.expense_details ed
   WHERE ed.claim_id = p_claim_id AND ed.is_active = true
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'EXPENSE_DETAILS_MISSING', 'claim_id', p_claim_id);
  END IF;

  SELECT bc_code INTO v_bc_code
    FROM public.expense_category_bc_mappings
   WHERE expense_category_id = v_expense.expense_category_id AND is_active = true
   LIMIT 1;
  -- bc_code may be NULL here; non-vendor flow errors at the Edge Function, vendor flow allows it.

  SELECT program_code INTO v_program_code
    FROM public.master_program_product_mappings
   WHERE product_id = v_expense.product_id AND is_active = true
   LIMIT 1;
  IF v_program_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'nwProgramCode',
                              'product_id', v_expense.product_id);
  END IF;

  SELECT sub_product_code INTO v_sub_product_code
    FROM public.master_sub_product_mappings
   WHERE product_id = v_expense.product_id AND is_active = true
   LIMIT 1;
  IF v_sub_product_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'subProductCode',
                              'product_id', v_expense.product_id);
  END IF;

  SELECT responsible_department_code, beneficiary_department_code
    INTO v_responsible_dept, v_beneficiary_dept
    FROM public.master_department_responsible_mappings
   WHERE department_id = v_claim.department_id AND is_active = true
   LIMIT 1;
  IF v_responsible_dept IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'responsibleDepartment',
                              'department_id', v_claim.department_id);
  END IF;

  SELECT region_code INTO v_region_code
    FROM public.master_expense_location_mappings
   WHERE location_id = v_expense.location_id AND is_active = true
   LIMIT 1;
  IF v_region_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'regionCode',
                              'location_id', v_expense.location_id);
  END IF;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'employee_id', v_claim.employee_id,
    'bc_payments_flag', v_claim.bc_payments_flag,
    'approved_amount', v_expense.approved_amount,
    'purpose', v_expense.purpose,
    'receipt_file_path', v_expense.receipt_file_path,
    'bank_statement_file_path', v_expense.bank_statement_file_path,
    'expense_category_id', v_expense.expense_category_id,
    'bc_code', v_bc_code,
    'program_code', v_program_code,
    'sub_product_code', v_sub_product_code,
    'responsible_department_code', v_responsible_dept,
    'beneficiary_department_code', v_beneficiary_dept,
    'region_code', v_region_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bc_claim_payload(TEXT) TO service_role;

COMMIT;
```

- [ ] **Step 2: Apply locally**

Run: `npm run db:migrate`

- [ ] **Step 3: Verify function exists and behaves**

In `psql` or Supabase SQL editor:

```sql
-- Happy path: pick a real Reimbursement claim id from your local DB.
SELECT public.get_bc_claim_payload('<CLAIM_ID>');

-- Should return a JSON object with all the keys listed above.

-- Not found:
SELECT public.get_bc_claim_payload('NO-SUCH-CLAIM');
-- Should return {"error": "CLAIM_NOT_FOUND", "claim_id": "NO-SUCH-CLAIM"}.
```

If a Reimbursement claim is unavailable locally, this verification can be deferred until sandbox testing — but the function definition must apply cleanly.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260513152000_get_bc_claim_payload.sql
git commit -m "feat(bc): add get_bc_claim_payload DB function

Single-roundtrip resolver of all mapping lookups needed to build
the BC payload. Returns typed error JSON when any mapping is
missing, so the Edge Function can fail fast before calling BC."
```

---

## Task 4: Migration — `complete_bc_payment` DB function

Atomic post-BC-success transition. Replicates everything the existing Finance approve does (`updateClaimL2Decision` in `SupabaseClaimRepository.ts:1633`) plus the BC-specific writes.

**Files:**

- Create: `supabase/migrations/20260513153000_complete_bc_payment.sql`

- [ ] **Step 1: Read the existing reference**

Open `src/modules/claims/repositories/SupabaseClaimRepository.ts` around lines 1633–1730 and confirm:

- Finance approve writes `status`, `assigned_l2_approver_id`, `rejection_reason` (null), `is_resubmission_allowed` (false), `finance_action_at`.
- It calls `createClaimAuditLog({ claimId, actorId, actionType: 'L2_APPROVED', assignedToId: null, remarks: null })`.

Open `master_finance_approvers` schema if you don't know the table columns. We need `id` and `user_id` (and `is_active` if it exists). Adjust the SQL below if columns differ.

- [ ] **Step 2: Read the claim_audit_log schema**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'claim_audit_log'
ORDER BY ordinal_position;
```

Compare against `createClaimAuditLog`'s insert in `SupabaseClaimRepository.ts` so the inline insert below uses the exact same columns. **If the column set is different from what's in the SQL skeleton below, update the INSERT before saving.**

- [ ] **Step 3: Write the migration**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.complete_bc_payment(
  p_claim_id        TEXT,
  p_actor_user_id   UUID,
  p_is_vendor       BOOLEAN,
  p_vendor_id       TEXT,
  p_vendor_name     TEXT,
  p_audit_log_id    UUID,
  p_bc_response     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_finance_approver_id UUID;
BEGIN
  -- 0. Atomic authorization. The Edge Function pre-flight does this too,
  --    but we re-check here so the state transition cannot be bypassed.
  SELECT id INTO v_finance_approver_id
    FROM public.master_finance_approvers
   WHERE user_id = p_actor_user_id AND is_active = true
   LIMIT 1;

  IF v_finance_approver_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: actor % is not an active finance approver', p_actor_user_id;
  END IF;

  -- 1. Update claims with BC flags + the same fields the standard
  --    Finance-approve flow writes (assigned_l2_approver_id, finance_action_at).
  UPDATE public.claims
     SET status                  = 'Finance Approved - Payment under process'::public.claim_status,
         bc_payments_flag        = true,
         is_vendor_payment       = p_is_vendor,
         assigned_l2_approver_id = v_finance_approver_id,
         finance_action_at       = now(),
         updated_at              = now()
   WHERE id = p_claim_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND_OR_INACTIVE: %', p_claim_id;
  END IF;

  -- 2. Insert vendor row (NULLs for non-vendor — see migration
  --    20260513150000_fix_bc_claim_vendors_nullability.sql).
  INSERT INTO public.bc_claim_vendors (claim_id, bc_vendor_id, bc_vendor_name)
  VALUES (p_claim_id, p_vendor_id, p_vendor_name);

  -- 3. Mirror the application-level claim audit log entry that
  --    SupabaseClaimRepository.createClaimAuditLog produces today.
  --    NOTE: validate column names against claim_audit_log schema
  --    before applying (see Step 2).
  INSERT INTO public.claim_audit_log (claim_id, actor_id, action_type, assigned_to_id, remarks)
  VALUES (p_claim_id, p_actor_user_id, 'L2_APPROVED', NULL, NULL);

  -- 4. Finalize BC audit row.
  UPDATE public.bc_payment_audit_log
     SET status           = 'SUCCESS'::public.bc_payment_audit_status,
         bc_response_json = p_bc_response,
         resolved_at      = now()
   WHERE id = p_audit_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_LOG_ROW_NOT_FOUND: %', p_audit_log_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_bc_payment(
  TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB
) TO service_role;

COMMIT;
```

- [ ] **Step 4: Apply locally**

Run: `npm run db:migrate`

- [ ] **Step 5: Verify function exists**

```sql
\df public.complete_bc_payment
```

Or:

```sql
SELECT proname, pg_get_function_arguments(oid)
FROM pg_proc
WHERE proname = 'complete_bc_payment';
```

Expected: one row, arguments matching the signature above.

- [ ] **Step 6: Smoke-test the unauthorized path**

```sql
-- Random non-finance-approver user UUID:
SELECT public.complete_bc_payment(
  'NO-SUCH-CLAIM',
  '00000000-0000-0000-0000-000000000000'::uuid,
  false, NULL, NULL,
  '00000000-0000-0000-0000-000000000000'::uuid,
  '{}'::jsonb
);
```

Expected: raises `UNAUTHORIZED: actor 00000000-... is not an active finance approver`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260513153000_complete_bc_payment.sql
git commit -m "feat(bc): add complete_bc_payment DB function

Atomic post-BC-success transition: replicates the existing
Finance-approve side effects (assigned_l2_approver_id,
finance_action_at, L2_APPROVED claim audit log entry) and adds
BC writes (bc_payments_flag, is_vendor_payment, bc_claim_vendors
insert, bc_payment_audit_log mark SUCCESS). Atomic auth check
on master_finance_approvers prevents bypass."
```

---

## Task 5: Edge Function project setup

This project has no Edge Functions yet. We need a minimal `_shared` directory, a `deno.json`/import map setup, and confirmation that the Supabase CLI can deploy from this repo.

**Files:**

- Create: `supabase/functions/_shared/.gitkeep` (placeholder so the directory tree is committed; remove once real files exist)
- Create: `supabase/functions/deno.json`
- Create (optional): `supabase/functions/import_map.json` if the version of supabase CLI in use requires it; otherwise leave deno.json alone.

- [ ] **Step 1: Confirm Supabase CLI is available**

Run: `npx supabase --version`
Expected: prints a version like `1.x.x` or higher. If not installed, install via `npm i -g supabase` or follow project README.

- [ ] **Step 2: Initialise Edge Function tooling**

If `supabase/functions/deno.json` does not exist, create:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "lib": ["deno.window"],
    "strict": true
  },
  "imports": {
    "std/": "https://deno.land/std@0.224.0/",
    "zod": "https://deno.land/x/zod@v3.23.8/mod.ts"
  }
}
```

- [ ] **Step 3: Verify the Supabase CLI sees the functions directory**

Run: `npx supabase functions list --linked` (skip `--linked` if not yet linked)
Expected: clean output, no error. If "no linked project", that's fine — we deploy later.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/deno.json
git commit -m "chore(bc): scaffold supabase/functions directory

First Edge Function in this repo. deno.json sets strict mode +
imports for zod and std lib."
```

---

## Task 6: `_shared/bcEnv.ts` — typed env var reader

**Files:**

- Create: `supabase/functions/_shared/bcEnv.ts`

- [ ] **Step 1: Write the module**

```typescript
// supabase/functions/_shared/bcEnv.ts

const REQUIRED_KEYS = [
  "BC_TENANT_ID",
  "BC_CLIENT_ID",
  "BC_CLIENT_SECRET",
  "BC_ENVIRONMENT",
  "BC_COMPANY_ID",
  "BC_COMPANY_NAME",
] as const;

export type BcEnv = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
  companyName: string;
};

let cached: BcEnv | null = null;

export function getBcEnv(): BcEnv {
  if (cached) return cached;

  const missing: string[] = [];
  const values: Record<string, string> = {};

  for (const key of REQUIRED_KEYS) {
    const v = Deno.env.get(key);
    if (!v || v.trim().length === 0) {
      missing.push(key);
    } else {
      values[key] = v;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing BC environment variables: ${missing.join(", ")}`);
  }

  cached = {
    tenantId: values.BC_TENANT_ID,
    clientId: values.BC_CLIENT_ID,
    clientSecret: values.BC_CLIENT_SECRET,
    environment: values.BC_ENVIRONMENT,
    companyId: values.BC_COMPANY_ID,
    companyName: values.BC_COMPANY_NAME,
  };
  return cached;
}
```

- [ ] **Step 2: Type-check the file in isolation**

Run: `npx supabase functions serve --no-verify-jwt _shared 2>&1 | head -20` (or `deno check supabase/functions/_shared/bcEnv.ts` if Deno is installed locally)
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/bcEnv.ts
git commit -m "feat(bc): add typed BC env var reader

Single source of truth for BC_* environment variables.
Fails fast at first call if any are missing; caches afterwards."
```

---

## Task 7: `_shared/bcAuth.ts` — OAuth2 token fetch + cache

**Files:**

- Create: `supabase/functions/_shared/bcAuth.ts`
- Create: `supabase/functions/_shared/bcAuth.test.ts`

- [ ] **Step 1: Write the failing test for cache reuse**

```typescript
// supabase/functions/_shared/bcAuth.test.ts
import { assertEquals, assert } from "std/assert/mod.ts";
import { __setTestEnv, __resetTokenCache, getBcAccessToken } from "./bcAuth.ts";

Deno.test("caches the token across calls within expiry", async () => {
  __resetTokenCache();

  let fetchCount = 0;
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ access_token: "tok-A", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  __setTestEnv({
    tenantId: "T",
    clientId: "C",
    clientSecret: "S",
    environment: "Sandbox",
    companyId: "X",
    companyName: "Y",
    fetchImpl: () => {
      fetchCount += 1;
      return fakeFetch("");
    },
  });

  const t1 = await getBcAccessToken();
  const t2 = await getBcAccessToken();
  assertEquals(t1, "tok-A");
  assertEquals(t2, "tok-A");
  assertEquals(fetchCount, 1); // second call hits cache
});

Deno.test("refreshes when within 60s of expiry", async () => {
  __resetTokenCache();
  let calls = 0;
  __setTestEnv({
    tenantId: "T",
    clientId: "C",
    clientSecret: "S",
    environment: "Sandbox",
    companyId: "X",
    companyName: "Y",
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          access_token: calls === 1 ? "old" : "new",
          expires_in: calls === 1 ? 30 : 3600,
        }),
        { status: 200 },
      );
    },
  });
  const a = await getBcAccessToken();
  const b = await getBcAccessToken();
  assertEquals(a, "old");
  assertEquals(b, "new");
  assertEquals(calls, 2);
});

Deno.test("throws on non-2xx", async () => {
  __resetTokenCache();
  __setTestEnv({
    tenantId: "T",
    clientId: "C",
    clientSecret: "S",
    environment: "Sandbox",
    companyId: "X",
    companyName: "Y",
    fetchImpl: async () => new Response("bad", { status: 401 }),
  });
  let err: unknown = null;
  try {
    await getBcAccessToken();
  } catch (e) {
    err = e;
  }
  assert(err instanceof Error);
  assert((err as Error).message.includes("401"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase/functions/_shared && deno test --allow-env --allow-net bcAuth.test.ts`
Expected: failure — `bcAuth.ts` doesn't exist or exports are missing.

- [ ] **Step 3: Write the implementation**

```typescript
// supabase/functions/_shared/bcAuth.ts
import { getBcEnv } from "./bcEnv.ts";

type TokenCache = { token: string; expiresAt: number };

type TestOverrides = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
  companyName: string;
  fetchImpl: typeof fetch;
};

let cache: TokenCache | null = null;
let overrides: TestOverrides | null = null;

export function __setTestEnv(o: TestOverrides): void {
  overrides = o;
}
export function __resetTokenCache(): void {
  cache = null;
  overrides = null;
}

export async function getBcAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt - now > 60_000) {
    return cache.token;
  }

  const env = overrides ?? getBcEnv();
  const fetchImpl = overrides?.fetchImpl ?? fetch;

  const url = `https://login.microsoftonline.com/${env.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.businesscentral.dynamics.com/.default",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BC token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cache.token;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase/functions/_shared && deno test --allow-env --allow-net bcAuth.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/bcAuth.ts supabase/functions/_shared/bcAuth.test.ts
git commit -m "feat(bc): add OAuth2 token client with in-memory cache

Caches the BC access token across invocations within the same
Edge Function instance. Refreshes proactively at the 60-second
horizon before expiry. Tested for cache reuse, refresh, and
non-2xx handling."
```

---

## Task 8: `bc-vendor-search` Edge Function

**Files:**

- Create: `supabase/functions/bc-vendor-search/index.ts`

- [ ] **Step 1: Write the entry point**

```typescript
// supabase/functions/bc-vendor-search/index.ts
import { z } from "zod";
import { getBcAccessToken } from "../_shared/bcAuth.ts";
import { getBcEnv } from "../_shared/bcEnv.ts";

const InputSchema = z.object({
  query: z.string().trim().min(1).max(60),
});

type BcVendor = { No: string; Name: string };
type BcVendorResponse = { value?: BcVendor[] };

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return json({ error: "INVALID_INPUT", issues: parsed.error.flatten() }, 400);

  const env = getBcEnv();
  const token = await getBcAccessToken();

  // OData $filter escapes single quotes by doubling them.
  const escaped = parsed.data.query.replace(/'/g, "''");
  const filter = `contains(No,'${escaped}') or contains(Name,'${escaped}')`;
  const url =
    `https://api.businesscentral.dynamics.com/v2.0/${env.tenantId}/${env.environment}` +
    `/ODataV4/Company('${encodeURIComponent(env.companyName)}')/vendors` +
    `?$filter=${encodeURIComponent(filter)}&$top=20`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ error: "BC_API_ERROR", status: res.status, body: text.slice(0, 500) }, 502);
  }

  const data = (await res.json()) as BcVendorResponse;
  const vendors = (data.value ?? []).map((v) => ({ no: v.No, name: v.Name }));
  return json({ vendors });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 2: Deploy to sandbox**

Set the secrets first (one-time, see Task 5 prereqs):

```bash
npx supabase secrets set \
  BC_TENANT_ID=6ae3d026-e965-483e-8309-8f8f3aca71c8 \
  BC_CLIENT_ID=a5170024-af89-4142-b29b-65562f395b6f \
  BC_CLIENT_SECRET=<value from secure store> \
  BC_ENVIRONMENT=Sandbox_05052026 \
  BC_COMPANY_ID=2a9bf2ba-5cfe-ef11-9346-6045bdac6fc7 \
  BC_COMPANY_NAME=NxtWave
```

Deploy:

```bash
npx supabase functions deploy bc-vendor-search
```

Expected: success message with deployed function URL.

- [ ] **Step 3: Smoke-test against sandbox**

From browser console on a logged-in NxtClaim page (so we have a valid JWT):

```js
const { data, error } = await supabase.functions.invoke("bc-vendor-search", {
  body: { query: "a" },
});
console.log({ data, error });
```

Expected: `data.vendors` is a non-empty array of `{ no, name }`. If `error`, check secrets and tenant URL.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/bc-vendor-search/index.ts
git commit -m "feat(bc): add bc-vendor-search Edge Function

Proxies BC's OData vendor endpoint with contains-filter on
No / Name, top 20. JWT-verified by default. Single quotes in
the query are escaped per OData spec."
```

---

## Task 9: `bc-payment/types.ts` — BC interfaces, enums, errors

**Files:**

- Create: `supabase/functions/bc-payment/types.ts`

- [ ] **Step 1: Write the type module**

```typescript
// supabase/functions/bc-payment/types.ts

export const BcAccountType = { Employee: "Employee", Vendor: "Vendor" } as const;
export type BcAccountType = (typeof BcAccountType)[keyof typeof BcAccountType];

export const BcEmployeeTransactionType = { Advance: "ADVANCE" } as const;
export type BcEmployeeTransactionType =
  (typeof BcEmployeeTransactionType)[keyof typeof BcEmployeeTransactionType];

export const BcBalAccountType = { GLAccount: "G/L Account" } as const;
export type BcBalAccountType = (typeof BcBalAccountType)[keyof typeof BcBalAccountType];

export interface BcClaimLineItem {
  postingDate: string; // ISO YYYY-MM-DD
  accountType: BcAccountType;
  accountNo: string;
  employeeTransactionType: BcEmployeeTransactionType | "";
  amount: number;
  description: string;
  balAccountType: BcBalAccountType;
  balAccountNo: string;
  claimNo: string;
  nwProgramCode: string;
  subProductCode: string;
  responsibleDepartment: string;
  beneficiaryDepartment: string;
  regionCode: string;
}

export interface BcClaimPayloadFromDb {
  claim_id: string;
  employee_id: string;
  bc_payments_flag: boolean;
  approved_amount: number;
  purpose: string;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
  expense_category_id: string;
  bc_code: string | null;
  program_code: string;
  sub_product_code: string;
  responsible_department_code: string;
  beneficiary_department_code: string;
  region_code: string;
}

export interface PayloadBuilderInput {
  isVendorPayment: boolean;
  bcVendorId?: string | null;
  bcVendorName?: string | null;
}

export type BcPaymentError =
  | { code: "UNAUTHORIZED" }
  | { code: "ALREADY_SENT"; claimId: string }
  | { code: "NOT_REIMBURSEMENT"; paymentMode: string }
  | { code: "CLAIM_NOT_FOUND"; claimId: string }
  | { code: "EXPENSE_DETAILS_MISSING"; claimId: string }
  | { code: "MISSING_MAPPING"; field: string; detail?: string }
  | { code: "MISSING_VENDOR_SELECTION" }
  | { code: "MISSING_BC_CODE"; expenseCategoryId: string }
  | { code: "BC_API_ERROR"; status: number; body: unknown }
  | { code: "DB_UPDATE_FAILED"; claimId: string; auditLogId: string }
  | { code: "INVALID_INPUT"; issues: unknown };

export interface BcPaymentSuccess {
  ok: true;
  claimId: string;
  bcResponses: unknown[];
  auditLogId: string;
}

export interface BcPaymentDryRunResult {
  ok: true;
  dryRun: true;
  claimId: string;
  wouldSend: BcClaimLineItem[];
  wouldAuditLog: { status: "PENDING"; payload_json: BcClaimLineItem[] };
}
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/bc-payment/types.ts` (or `npx supabase functions serve bc-payment --no-verify-jwt` then Ctrl-C once it compiles)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/bc-payment/types.ts
git commit -m "feat(bc): add bc-payment type module

Defines BcClaimLineItem, the DB payload shape, the payload-builder
input shape, the typed error union, and success/dry-run result
shapes. No 'any' anywhere."
```

---

## Task 10: `bc-payment/payloadBuilder.ts` — pure payload construction

Pure function. Full TDD. This is the file whose correctness most directly determines whether BC accepts our requests.

**Files:**

- Create: `supabase/functions/bc-payment/payloadBuilder.test.ts`
- Create: `supabase/functions/bc-payment/payloadBuilder.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// supabase/functions/bc-payment/payloadBuilder.test.ts
import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { buildBcLineItems } from "./payloadBuilder.ts";
import type { BcClaimPayloadFromDb } from "./types.ts";

const baseDbPayload: BcClaimPayloadFromDb = {
  claim_id: "CLAIM-NW0002053-20260424-462F",
  employee_id: "NW0002053",
  bc_payments_flag: false,
  approved_amount: 573,
  purpose: "Food bill for Production team - Video shoot",
  receipt_file_path: "https://storage.example.com/receipts/abc.jpg",
  bank_statement_file_path: "https://storage.example.com/bank/def.pdf",
  expense_category_id: "11111111-1111-1111-1111-111111111111",
  bc_code: "503063",
  program_code: "COMMON",
  sub_product_code: "COMMON",
  responsible_department_code: "GENAI SOCIAL MEDIA",
  beneficiary_department_code: "GENAI SOCIAL MEDIA",
  region_code: "TELUGU",
};

Deno.test("non-vendor: returns one Employee line with negative amount + bc_code", () => {
  const lines = buildBcLineItems(baseDbPayload, { isVendorPayment: false });
  assertEquals(lines.length, 1);
  const [l] = lines;
  assertEquals(l.accountType, "Employee");
  assertEquals(l.accountNo, "NW0002053");
  assertEquals(l.employeeTransactionType, "ADVANCE");
  assertEquals(l.amount, -573);
  assertEquals(l.balAccountType, "G/L Account");
  assertEquals(l.balAccountNo, "503063");
  assertEquals(l.claimNo, baseDbPayload.claim_id);
  assertEquals(l.nwProgramCode, "COMMON");
  assertEquals(l.subProductCode, "COMMON");
  assertEquals(l.responsibleDepartment, "GENAI SOCIAL MEDIA");
  assertEquals(l.beneficiaryDepartment, "GENAI SOCIAL MEDIA");
  assertEquals(l.regionCode, "TELUGU");
});

Deno.test("description: 3 lines when both files present", () => {
  const [l] = buildBcLineItems(baseDbPayload, { isVendorPayment: false });
  assertEquals(
    l.description,
    "CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot\n" +
      "bill - https://storage.example.com/receipts/abc.jpg\n" +
      "bank statement - https://storage.example.com/bank/def.pdf",
  );
});

Deno.test("description: only line 1 when files are null", () => {
  const [l] = buildBcLineItems(
    { ...baseDbPayload, receipt_file_path: null, bank_statement_file_path: null },
    { isVendorPayment: false },
  );
  assertEquals(
    l.description,
    "CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot",
  );
});

Deno.test("description: skips empty-string file paths", () => {
  const [l] = buildBcLineItems(
    { ...baseDbPayload, receipt_file_path: "", bank_statement_file_path: "" },
    { isVendorPayment: false },
  );
  assertEquals(l.description.split("\n").length, 1);
});

Deno.test("vendor: returns 2 lines, both balAccountNo empty", () => {
  const lines = buildBcLineItems(baseDbPayload, {
    isVendorPayment: true,
    bcVendorId: "VEN/0008992",
    bcVendorName: "ABC Software Pvt Ltd",
  });
  assertEquals(lines.length, 2);
  const [emp, vendor] = lines;
  assertEquals(emp.accountType, "Employee");
  assertEquals(emp.amount, -573);
  assertEquals(emp.balAccountNo, "");
  assertEquals(emp.employeeTransactionType, "ADVANCE");
  assertEquals(vendor.accountType, "Vendor");
  assertEquals(vendor.accountNo, "VEN/0008992");
  assertEquals(vendor.amount, 573);
  assertEquals(vendor.balAccountNo, "");
  assertEquals(vendor.employeeTransactionType, "");
  assertEquals(vendor.description, emp.description);
});

Deno.test("postingDate is ISO YYYY-MM-DD", () => {
  const [l] = buildBcLineItems(baseDbPayload, { isVendorPayment: false });
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(l.postingDate), true);
});

Deno.test("throws if non-vendor and bc_code is null", () => {
  assertThrows(
    () => buildBcLineItems({ ...baseDbPayload, bc_code: null }, { isVendorPayment: false }),
    Error,
    "MISSING_BC_CODE",
  );
});

Deno.test("throws if vendor flag but no vendor id/name", () => {
  assertThrows(
    () => buildBcLineItems(baseDbPayload, { isVendorPayment: true }),
    Error,
    "MISSING_VENDOR_SELECTION",
  );
});

Deno.test("amount handles fractional approved_amount as-is", () => {
  const [l] = buildBcLineItems(
    { ...baseDbPayload, approved_amount: 573.5 },
    { isVendorPayment: false },
  );
  assertEquals(l.amount, -573.5);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd supabase/functions/bc-payment && deno test --no-check payloadBuilder.test.ts`
Expected: "module not found" or all tests fail (payloadBuilder.ts not yet written).

- [ ] **Step 3: Write the implementation**

```typescript
// supabase/functions/bc-payment/payloadBuilder.ts
import type { BcClaimLineItem, BcClaimPayloadFromDb, PayloadBuilderInput } from "./types.ts";
import { BcAccountType, BcBalAccountType, BcEmployeeTransactionType } from "./types.ts";

export function buildBcLineItems(
  db: BcClaimPayloadFromDb,
  input: PayloadBuilderInput,
): BcClaimLineItem[] {
  if (input.isVendorPayment && (!input.bcVendorId || !input.bcVendorName)) {
    throw new Error("MISSING_VENDOR_SELECTION");
  }
  if (!input.isVendorPayment && (db.bc_code === null || db.bc_code === "")) {
    throw new Error(`MISSING_BC_CODE: expense_category_id=${db.expense_category_id}`);
  }

  const postingDate = todayIso();
  const description = buildDescription(db);

  const common = {
    postingDate,
    description,
    balAccountType: BcBalAccountType.GLAccount,
    claimNo: db.claim_id,
    nwProgramCode: db.program_code,
    subProductCode: db.sub_product_code,
    responsibleDepartment: db.responsible_department_code,
    beneficiaryDepartment: db.beneficiary_department_code,
    regionCode: db.region_code,
  } as const;

  const employeeLine: BcClaimLineItem = {
    ...common,
    accountType: BcAccountType.Employee,
    accountNo: db.employee_id,
    employeeTransactionType: BcEmployeeTransactionType.Advance,
    amount: -db.approved_amount,
    balAccountNo: input.isVendorPayment ? "" : (db.bc_code as string),
  };

  if (!input.isVendorPayment) return [employeeLine];

  const vendorLine: BcClaimLineItem = {
    ...common,
    accountType: BcAccountType.Vendor,
    accountNo: input.bcVendorId as string,
    employeeTransactionType: "",
    amount: db.approved_amount,
    balAccountNo: "",
  };

  return [employeeLine, vendorLine];
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildDescription(db: BcClaimPayloadFromDb): string {
  const lines: string[] = [`${db.claim_id} - ${db.purpose}`];
  if (db.receipt_file_path && db.receipt_file_path.trim().length > 0) {
    lines.push(`bill - ${db.receipt_file_path}`);
  }
  if (db.bank_statement_file_path && db.bank_statement_file_path.trim().length > 0) {
    lines.push(`bank statement - ${db.bank_statement_file_path}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd supabase/functions/bc-payment && deno test --no-check payloadBuilder.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bc-payment/payloadBuilder.ts \
        supabase/functions/bc-payment/payloadBuilder.test.ts
git commit -m "feat(bc): add payloadBuilder with full TDD coverage

Pure function: DB payload + vendor choice -> BcClaimLineItem[].
Non-vendor returns 1 line (negative amount, bc_code as balAccountNo).
Vendor returns 2 lines (Employee negative, Vendor positive, both
balAccountNo empty per spec). Description joins claim id, purpose,
optional bill, optional bank statement with \\n."
```

---

## Task 11: `bc-payment/bcPaymentsClient.ts` — HTTP client for BC

**Files:**

- Create: `supabase/functions/bc-payment/bcPaymentsClient.ts`

- [ ] **Step 1: Write the client**

This is thin: one POST per line item, retries once on 401 by clearing the token cache.

```typescript
// supabase/functions/bc-payment/bcPaymentsClient.ts
import { getBcAccessToken, __resetTokenCache } from "../_shared/bcAuth.ts";
import { getBcEnv } from "../_shared/bcEnv.ts";
import type { BcClaimLineItem } from "./types.ts";

export type BcPostResult =
  | { ok: true; response: unknown }
  | { ok: false; status: number; body: unknown };

export async function postBcLineItems(lines: BcClaimLineItem[]): Promise<BcPostResult[]> {
  const results: BcPostResult[] = [];
  for (const line of lines) {
    const r = await postOne(line);
    results.push(r);
    if (!r.ok) break; // do not send the second line if the first failed
  }
  return results;
}

async function postOne(line: BcClaimLineItem): Promise<BcPostResult> {
  const env = getBcEnv();
  const url =
    `https://api.businesscentral.dynamics.com/v2.0/${env.environment}` +
    `/api/Alletec/Claim/v1.0/companies(${env.companyId})/Claims`;

  const send = async (token: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(line),
    });

  let token = await getBcAccessToken();
  let res = await send(token);

  if (res.status === 401) {
    __resetTokenCache();
    token = await getBcAccessToken();
    res = await send(token);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep as text */
    }
    return { ok: false, status: res.status, body };
  }

  const json = await res.json().catch(() => ({}));
  return { ok: true, response: json };
}
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/bc-payment/bcPaymentsClient.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/bc-payment/bcPaymentsClient.ts
git commit -m "feat(bc): add HTTP client for BC Payments API

One POST per line item, sequential. On 401, clears the token
cache and retries once. Stops the loop if any line fails, so
a failed second-line vendor send doesn't waste further calls."
```

---

## Task 12: `bc-payment/index.ts` — orchestration with dry-run

The biggest file. Follows the 7-step flow in `plan_bc.md` § "For a single claim" exactly, with the dry-run branch returning early before any side effects.

**Files:**

- Create: `supabase/functions/bc-payment/index.ts`

- [ ] **Step 1: Write the entry point**

```typescript
// supabase/functions/bc-payment/index.ts
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "zod";
import { buildBcLineItems } from "./payloadBuilder.ts";
import { postBcLineItems } from "./bcPaymentsClient.ts";
import type {
  BcClaimPayloadFromDb,
  BcPaymentError,
  BcPaymentDryRunResult,
  BcPaymentSuccess,
} from "./types.ts";

const InputSchema = z.object({
  claimId: z.string().min(1),
  isVendorPayment: z.boolean(),
  bcVendorId: z.string().min(1).optional().nullable(),
  bcVendorName: z.string().min(1).optional().nullable(),
  dryRun: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return errResp({ code: "INVALID_INPUT", issues: "method" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errResp({ code: "INVALID_INPUT", issues: "json" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success)
    return errResp({ code: "INVALID_INPUT", issues: parsed.error.flatten() }, 400);

  const { claimId, isVendorPayment, bcVendorId, bcVendorName, dryRun } = parsed.data;

  // Use the caller's JWT for SECURITY INVOKER lookups; service-role for writes.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Step 0 — finance-approver auth gate.
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return errResp({ code: "UNAUTHORIZED" }, 401);
  const actorUserId = userData.user.id;

  const { data: approverRow, error: approverErr } = await serviceClient
    .from("master_finance_approvers")
    .select("id")
    .eq("user_id", actorUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (approverErr) return errResp({ code: "UNAUTHORIZED" }, 401);
  if (!approverRow) return errResp({ code: "UNAUTHORIZED" }, 401);

  // Step 3 — resolve payload + validate.
  const { data: payloadJson, error: payloadErr } = await serviceClient.rpc("get_bc_claim_payload", {
    p_claim_id: claimId,
  });
  if (payloadErr) return errResp({ code: "INVALID_INPUT", issues: payloadErr.message }, 400);

  const payload = payloadJson as Record<string, unknown>;
  if (typeof payload.error === "string") {
    return mapDbError(payload);
  }
  const dbPayload = payload as unknown as BcClaimPayloadFromDb;

  if (dbPayload.bc_payments_flag) return errResp({ code: "ALREADY_SENT", claimId }, 409);
  if (isVendorPayment && (!bcVendorId || !bcVendorName))
    return errResp({ code: "MISSING_VENDOR_SELECTION" }, 400);
  if (!isVendorPayment && !dbPayload.bc_code)
    return errResp(
      { code: "MISSING_BC_CODE", expenseCategoryId: dbPayload.expense_category_id },
      400,
    );

  let lines;
  try {
    lines = buildBcLineItems(dbPayload, { isVendorPayment, bcVendorId, bcVendorName });
  } catch (e) {
    return errResp({ code: "INVALID_INPUT", issues: (e as Error).message }, 400);
  }

  // Dry-run: stop here. No audit write, no BC call, no DB mutation.
  if (dryRun) {
    const result: BcPaymentDryRunResult = {
      ok: true,
      dryRun: true,
      claimId,
      wouldSend: lines,
      wouldAuditLog: { status: "PENDING", payload_json: lines },
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // Step 4 — PENDING audit row.
  const { data: auditRow, error: auditErr } = await serviceClient
    .from("bc_payment_audit_log")
    .insert({ claim_id: claimId, status: "PENDING", payload_json: lines })
    .select("id")
    .single();
  if (auditErr || !auditRow)
    return errResp({ code: "DB_UPDATE_FAILED", claimId, auditLogId: "" }, 500);
  const auditLogId = auditRow.id as string;

  // Step 5 — call BC.
  const bcResults = await postBcLineItems(lines);
  const failure = bcResults.find((r) => !r.ok);
  if (failure && !failure.ok) {
    await serviceClient
      .from("bc_payment_audit_log")
      .update({
        status: "FAILED",
        error_message: JSON.stringify(failure.body).slice(0, 1000),
        resolved_at: new Date().toISOString(),
      })
      .eq("id", auditLogId);
    return errResp({ code: "BC_API_ERROR", status: failure.status, body: failure.body }, 502);
  }

  const bcResponses = bcResults.map((r) => (r.ok ? r.response : null));

  // Step 6 — atomic DB finalisation.
  const { error: completeErr } = await serviceClient.rpc("complete_bc_payment", {
    p_claim_id: claimId,
    p_actor_user_id: actorUserId,
    p_is_vendor: isVendorPayment,
    p_vendor_id: isVendorPayment ? bcVendorId : null,
    p_vendor_name: isVendorPayment ? bcVendorName : null,
    p_audit_log_id: auditLogId,
    p_bc_response: bcResponses,
  });

  if (completeErr) {
    // Spec edge case 3: BC succeeded but DB update failed.
    // Leave audit row PENDING so monitoring detects it.
    return errResp({ code: "DB_UPDATE_FAILED", claimId, auditLogId }, 500);
  }

  const success: BcPaymentSuccess = { ok: true, claimId, bcResponses, auditLogId };
  return new Response(JSON.stringify(success), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

function errResp(err: BcPaymentError, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: err }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mapDbError(p: Record<string, unknown>): Response {
  const e = p.error as string;
  if (e === "CLAIM_NOT_FOUND")
    return errResp({ code: "CLAIM_NOT_FOUND", claimId: String(p.claim_id) }, 404);
  if (e === "NOT_REIMBURSEMENT")
    return errResp({ code: "NOT_REIMBURSEMENT", paymentMode: String(p.payment_mode) }, 400);
  if (e === "EXPENSE_DETAILS_MISSING")
    return errResp({ code: "EXPENSE_DETAILS_MISSING", claimId: String(p.claim_id) }, 400);
  if (e === "MISSING_MAPPING")
    return errResp(
      { code: "MISSING_MAPPING", field: String(p.field), detail: JSON.stringify(p) },
      400,
    );
  return errResp({ code: "INVALID_INPUT", issues: p }, 400);
}
```

- [ ] **Step 2: Deploy to sandbox**

Run: `npx supabase functions deploy bc-payment`
Expected: deploy succeeds.

- [ ] **Step 3: Dry-run smoke test**

From browser console on a logged-in NxtClaim page (Finance Approver):

```js
const { data, error } = await supabase.functions.invoke("bc-payment", {
  body: { claimId: "<REAL_REIMBURSEMENT_CLAIM_ID>", isVendorPayment: false, dryRun: true },
});
console.log(JSON.stringify(data, null, 2), error);
```

Expected: `data.ok = true`, `data.dryRun = true`, `data.wouldSend[0]` has all fields per spec. Then verify in SQL:

```sql
SELECT count(*) FROM bc_payment_audit_log WHERE claim_id = '<that claim id>';
-- Expected: 0 (dry-run wrote nothing)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/bc-payment/index.ts
git commit -m "feat(bc): add bc-payment Edge Function

Orchestrates the 7-step BC payment flow from plan_bc.md:
finance-approver auth gate, claim payload + mapping validation,
PENDING audit log, sequential BC POST(s), atomic
complete_bc_payment DB call on success. dryRun=true short-circuits
after payload build with no side effects."
```

---

## Task 13: Frontend modal — `bc-payment-modal.tsx`

**Files:**

- Create: `src/modules/claims/ui/bc-payment-modal.tsx`

- [ ] **Step 1: Sketch the component skeleton**

```tsx
// src/modules/claims/ui/bc-payment-modal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { createBrowserClient } from "@/core/infra/supabase/browser-client";

type Vendor = { no: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
  onSuccess: () => void;
};

export function BcPaymentModal({ open, onOpenChange, claimId, onSuccess }: Props) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [paymentType, setPaymentType] = useState<"non_vendor" | "vendor" | null>(null);
  const [vendorQuery, setVendorQuery] = useState("");
  const debouncedQuery = useDebouncedValue(vendorQuery, 300);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paymentType !== "vendor" || debouncedQuery.trim().length === 0) {
      setVendors([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    supabase.functions
      .invoke("bc-vendor-search", { body: { query: debouncedQuery } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setVendors([]);
          setError(error.message);
          return;
        }
        setVendors((data?.vendors ?? []) as Vendor[]);
        setError(null);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, paymentType, supabase]);

  const canConfirm =
    !submitting &&
    paymentType !== null &&
    (paymentType === "non_vendor" || selectedVendor !== null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("bc-payment", {
      body: {
        claimId,
        isVendorPayment: paymentType === "vendor",
        bcVendorId: selectedVendor?.no,
        bcVendorName: selectedVendor?.name,
      },
    });
    setSubmitting(false);
    if (error || data?.ok === false) {
      setError(formatError(error, data));
      return;
    }
    onSuccess();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to Business Central</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Payment Type</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="bc-payment-type"
                checked={paymentType === "non_vendor"}
                onChange={() => {
                  setPaymentType("non_vendor");
                  setSelectedVendor(null);
                }}
              />
              Non-Vendor Payment
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="bc-payment-type"
                checked={paymentType === "vendor"}
                onChange={() => setPaymentType("vendor")}
              />
              Vendor Payment
            </label>
          </fieldset>

          {paymentType === "vendor" && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Search vendor by name or ID"
                value={vendorQuery}
                onChange={(e) => {
                  setVendorQuery(e.target.value);
                  setSelectedVendor(null);
                }}
                className="w-full border rounded px-3 py-2"
              />
              {searching && <p className="text-xs text-zinc-500">Searching…</p>}
              {vendors.length > 0 && (
                <ul className="max-h-48 overflow-auto border rounded">
                  {vendors.map((v) => (
                    <li key={v.no}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedVendor(v);
                          setVendorQuery(`${v.name} (${v.no})`);
                          setVendors([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-zinc-100"
                      >
                        {v.name} ({v.no})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedVendor && (
                <p className="text-xs text-emerald-700">
                  Selected: {selectedVendor.name} ({selectedVendor.no})
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="px-4 py-2 border rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 bg-zinc-900 text-white rounded disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Confirm"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatError(error: unknown, data: unknown): string {
  const e = (data as { error?: { code?: string } } | undefined)?.error;
  if (e?.code === "ALREADY_SENT") return "This claim has already been sent to Business Central.";
  if (e?.code === "MISSING_MAPPING")
    return `Missing mapping: ${(data as { error: { field: string } }).error.field}. Contact admin.`;
  if (e?.code === "MISSING_BC_CODE") return "Expense category has no BC account code configured.";
  if (e?.code === "DB_UPDATE_FAILED")
    return "Payment was sent to Business Central but our records could not be updated. Please contact admin.";
  if (e?.code === "BC_API_ERROR")
    return "Business Central rejected the request. Please contact admin.";
  return (error as Error | undefined)?.message ?? "Something went wrong. Please try again.";
}
```

- [ ] **Step 2: Type-check the project**

Run: `npm run typecheck`
Expected: no errors. If imports for `createBrowserClient` don't match the project's actual export, fix the import to match `src/core/infra/supabase/browser-client.ts`.

- [ ] **Step 3: Match the existing modal style**

Open one existing modal in the codebase (e.g. `src/modules/claims/ui/claim-reject-with-reason-form.tsx` or another component using `Dialog`) and align the BC modal's spacing, font sizes, and button classes to match. Specifically check: `space-y-*` values, button color tokens, input padding.

- [ ] **Step 4: Commit**

```bash
git add src/modules/claims/ui/bc-payment-modal.tsx
git commit -m "feat(bc): add BC payment modal

Radio: Non-Vendor / Vendor. Vendor selection uses debounced
bc-vendor-search. Confirm calls bc-payment Edge Function and
shows typed error inline on failure. Modal stays open on error
so the user can retry or cancel."
```

---

## Task 14: Wire BC modal into Finance Approve flow

**Files:**

- Modify: `src/modules/claims/ui/claim-decision-action-form.tsx`
- Modify (if needed): any sibling caller that triggers single-claim Finance Approve

- [ ] **Step 1: Read the current single-claim Finance Approve trigger**

Open `src/modules/claims/ui/claim-decision-action-form.tsx`. Identify the click handler that invokes `approveFinanceAction`. Note: this file may not be the only caller; search for it:

Run: `grep -rn "approveFinanceAction" src/modules/claims/ui/`
Expected: 1–3 hits. Read each.

- [ ] **Step 2: Plumb payment-mode data to the form**

The form needs to know whether the current claim's payment mode is Reimbursement. If the claim object already carries `payment_mode_name` (or similar), use it. If not, lift the prop up from the parent (the Finance Approvals page component). Use `normalizePaymentModeName` + `PAYMENT_MODE_REIMBURSEMENT` from `src/core/constants/payment-modes.ts` to compare.

```ts
import {
  normalizePaymentModeName,
  PAYMENT_MODE_REIMBURSEMENT,
} from "@/core/constants/payment-modes";
const isReimbursement =
  normalizePaymentModeName(claim.payment_mode_name) === PAYMENT_MODE_REIMBURSEMENT;
```

- [ ] **Step 3: Conditionally render the BC modal**

In the action form component:

```tsx
import { useState } from "react";
import { BcPaymentModal } from "./bc-payment-modal";
import { useRouter } from "next/navigation";

// inside the component:
const [bcModalOpen, setBcModalOpen] = useState(false);
const router = useRouter();

function handleApproveClick() {
  if (isReimbursement) {
    setBcModalOpen(true);
    return;
  }
  // existing path:
  startTransition(() =>
    approveFinanceAction({ claimId: claim.id, ...rest }).then(handleStandardResult),
  );
}

// at the end of JSX:
<BcPaymentModal
  open={bcModalOpen}
  onOpenChange={setBcModalOpen}
  claimId={claim.id}
  onSuccess={() => router.refresh()}
/>;
```

Notes:

- Do NOT also call `approveFinanceAction` after BC modal success — the Edge Function's `complete_bc_payment` already does the status transition + claim audit log.
- `router.refresh()` will revalidate the page's server data (the same effect `approveFinanceAction` achieves with `revalidatePath`).

- [ ] **Step 4: Type-check, lint, and dev-test**

```bash
npm run typecheck
npm run lint
npm run dev
```

Then in browser, on a logged-in Finance Approver session, open a Reimbursement claim's approval view and click Approve. Confirm the BC modal opens. For a non-Reimbursement claim, confirm the legacy flow still runs.

- [ ] **Step 5: Commit**

```bash
git add src/modules/claims/ui/claim-decision-action-form.tsx \
        $(grep -rl "approveFinanceAction" src/modules/claims/ui/ | tr '\n' ' ')
git commit -m "feat(bc): route Reimbursement approvals through BC modal

Finance Approve on a Reimbursement claim now opens the BC payment
modal instead of calling approveFinanceAction directly. All other
payment modes keep the existing server-action flow. After BC
success, router.refresh() takes the place of revalidatePath."
```

---

## Task 15: Runbook — stuck audit rows

**Files:**

- Create: `docs/runbooks/bc-payment-stuck-rows.md`

- [ ] **Step 1: Write the runbook**

````markdown
# Runbook: BC Payment Audit Log — Stuck PENDING Rows

`bc_payment_audit_log.status = 'PENDING'` rows older than 5 minutes indicate
the Edge Function called BC successfully but the local DB transition
(`complete_bc_payment`) failed before marking the row `SUCCESS`. The BC
side has data; the NxtClaim side does not.

**Hard rule: never re-call BC for a stuck row.**

## Monitoring query

```sql
SELECT id, claim_id, idempotency_key, created_at, bc_response_json
FROM public.bc_payment_audit_log
WHERE status = 'PENDING'
  AND created_at < now() - interval '5 minutes'
ORDER BY created_at;
```
````

## Diagnostic steps

1. Inspect `bc_response_json`. If null, BC was never called — safe to leave
   the row alone or delete after investigation; user may retry the claim.
2. If `bc_response_json` is populated, BC has the line(s). Confirm in BC
   Sandbox/Prod UI that the documentNo(s) exist.
3. Check `claims.bc_payments_flag` for the audit row's `claim_id`:
   - If `false`: the standard transition never happened; resolve via Step 4
     of the resolution flow.
   - If `true`: state already converged; just mark the audit row resolved.

## Resolution

Open a transaction in psql / Supabase SQL editor. Replace the placeholders.

```sql
BEGIN;

-- If the standard transition was missed, call the same function the
-- Edge Function would have called.
SELECT public.complete_bc_payment(
  p_claim_id       => '<claim_id>',
  p_actor_user_id  => '<actor uuid>',
  p_is_vendor      => <true|false>,
  p_vendor_id      => '<vendor No or NULL>',
  p_vendor_name    => '<vendor Name or NULL>',
  p_audit_log_id   => '<bc_payment_audit_log.id>',
  p_bc_response    => '<the bc_response_json from the row>'
);

COMMIT;
```

If the claim is already in `Finance Approved - Payment under process` (i.e.
`bc_payments_flag` already true), just update the audit row:

```sql
UPDATE public.bc_payment_audit_log
   SET status = 'SUCCESS', resolved_at = now()
 WHERE id = '<bc_payment_audit_log.id>';
```

## Re-emphasis

Do not re-call BC. The line items are already on their side. Re-calling
would duplicate them.

````

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/bc-payment-stuck-rows.md
git commit -m "docs(bc): add runbook for stuck PENDING audit rows

Monitoring query, diagnostic steps, manual resolution via
complete_bc_payment, and the hard rule: never re-call BC."
````

---

## Task 16: End-to-end verification in sandbox

No code changes; this is the sandbox sign-off gate. **Do not move to Phase 2 (bulk) or to production until all of the items below pass.**

- [ ] **Step 1: Set sandbox secrets** (one-time, if not already done in Task 8)

```bash
npx supabase secrets set BC_TENANT_ID=... BC_CLIENT_ID=... BC_CLIENT_SECRET=... \
                          BC_ENVIRONMENT=Sandbox_05052026 \
                          BC_COMPANY_ID=2a9bf2ba-5cfe-ef11-9346-6045bdac6fc7 \
                          BC_COMPANY_NAME=NxtWave
```

- [ ] **Step 2: Apply all migrations to sandbox**

```bash
# Confirm the link is to sandbox project, not prod:
npx supabase status

# Apply:
npm run db:migrate
```

Verify:

```sql
SELECT typname FROM pg_type WHERE typname LIKE 'bc_%';
SELECT proname FROM pg_proc WHERE proname IN ('get_bc_claim_payload', 'complete_bc_payment');
SELECT count(*) FROM bc_payment_audit_log; -- expect 0
```

- [ ] **Step 3: Deploy both Edge Functions**

```bash
npx supabase functions deploy bc-vendor-search
npx supabase functions deploy bc-payment
```

- [ ] **Step 4: Vendor search smoke test**

Browser console (Finance Approver session):

```js
const { data } = await supabase.functions.invoke("bc-vendor-search", { body: { query: "a" } });
console.log(data.vendors?.length, data.vendors?.[0]);
```

Expected: non-empty array, first item has `no` and `name`.

- [ ] **Step 5: Dry-run non-vendor**

```js
const { data } = await supabase.functions.invoke("bc-payment", {
  body: { claimId: "<REIMB_CLAIM_ID>", isVendorPayment: false, dryRun: true },
});
console.log(JSON.stringify(data, null, 2));
```

Expected: `data.ok && data.dryRun`, `data.wouldSend.length === 1`, `amount < 0`, `balAccountNo` is a non-empty `bc_code`, description joins correctly.

Then in SQL:

```sql
SELECT count(*) FROM bc_payment_audit_log WHERE claim_id = '<that claim id>';
-- Expected: 0
```

- [ ] **Step 6: Dry-run vendor**

Pick a real sandbox vendor first via `bc-vendor-search`.

```js
const { data } = await supabase.functions.invoke("bc-payment", {
  body: {
    claimId: "<REIMB_CLAIM_ID>",
    isVendorPayment: true,
    bcVendorId: "<VENDOR_NO>",
    bcVendorName: "<VENDOR_NAME>",
    dryRun: true,
  },
});
console.log(JSON.stringify(data, null, 2));
```

Expected: `data.wouldSend.length === 2`. Employee line has `amount < 0`, `balAccountNo === ""`. Vendor line has `amount > 0`, `balAccountNo === ""`, `accountType === "Vendor"`, `employeeTransactionType === ""`.

- [ ] **Step 7: Dry-run validation error cases**

For each, expect the typed error and zero audit rows written:

- A claim with `bc_payments_flag = true` (force it via SQL temporarily on a test claim): expect `ALREADY_SENT`.
- A claim whose `expense_category_id` has no `bc_code` (non-vendor): expect `MISSING_BC_CODE`.
- A non-Reimbursement claim id: expect `NOT_REIMBURSEMENT`.

- [ ] **Step 8: Real send — non-vendor happy path**

Through the UI: open a Reimbursement claim, click Approve, choose Non-Vendor Payment, Confirm.

Verify:

```sql
SELECT status, bc_response_json IS NOT NULL AS has_response
FROM bc_payment_audit_log
WHERE claim_id = '<claim id>'
ORDER BY created_at DESC LIMIT 1;
-- Expected: status=SUCCESS, has_response=true

SELECT bc_payments_flag, is_vendor_payment, status, assigned_l2_approver_id, finance_action_at
FROM claims WHERE id = '<claim id>';
-- Expected: true, false, 'Finance Approved - Payment under process', non-null, non-null

SELECT bc_vendor_id, bc_vendor_name FROM bc_claim_vendors WHERE claim_id = '<claim id>';
-- Expected: NULL, NULL

SELECT action_type FROM claim_audit_log WHERE claim_id = '<claim id>' ORDER BY created_at DESC LIMIT 1;
-- Expected: L2_APPROVED
```

Confirm in BC sandbox that the line item exists.

- [ ] **Step 9: Real send — vendor happy path**

Through the UI: pick another Reimbursement claim, choose Vendor Payment, search a real vendor, Confirm.

Verify same SQL as Step 8, except:

- `is_vendor_payment = true`
- `bc_claim_vendors` row has the actual vendor No and Name
- `bc_response_json` is an array of 2 responses

Confirm in BC sandbox that both lines (Employee + Vendor) appear.

- [ ] **Step 10: Duplicate-send guard**

Trigger Approve on the same claim again. Expected: BC modal opens (frontend doesn't know yet), Confirm returns the `ALREADY_SENT` error inline, no new audit row, no new BC call.

```sql
SELECT count(*) FROM bc_payment_audit_log WHERE claim_id = '<that claim id>';
-- Expected: 1 (still the single SUCCESS row)
```

- [ ] **Step 11: Stuck-row simulation**

```sql
INSERT INTO bc_payment_audit_log (claim_id, status, payload_json, created_at)
VALUES ('<any claim id>', 'PENDING', '[]'::jsonb, now() - interval '10 minutes');

-- Run the monitoring query from the runbook:
SELECT id, claim_id, created_at FROM bc_payment_audit_log
WHERE status = 'PENDING' AND created_at < now() - interval '5 minutes';
-- Expected: the synthetic row shows up.

-- Cleanup:
DELETE FROM bc_payment_audit_log WHERE status = 'PENDING' AND payload_json::text = '[]';
```

- [ ] **Step 12: Token expiry sanity check**

Redeploy `bc-payment` to clear the in-memory cache: `npx supabase functions deploy bc-payment`. Trigger another approval. The flow should still work end-to-end (new token fetch happens on first call to the fresh instance).

- [ ] **Step 13: Final sign-off**

If Steps 1–10 all pass, the feature is shippable for single-claim Reimbursement approval against the BC sandbox. Steps 11–12 are sanity checks; document any anomalies in the runbook before declaring done.

- [ ] **Step 14: Tag the commit (optional)**

```bash
git tag -a bc-payment-single-claim-sandbox -m "BC payment integration: single-claim flow verified in sandbox"
```

---

## Self-Review (run before handing off)

1. **Spec coverage** — every section of `plan_bc.md` and the architecture plan should map to a task:
   - Migrations (nullability, enums, audit log, DB functions): Tasks 1–4 ✓
   - Edge Functions (`bc-vendor-search`, `bc-payment`): Tasks 8, 12 ✓
   - Pure payload + types: Tasks 9–10 ✓
   - Frontend modal + wiring: Tasks 13–14 ✓
   - Runbook: Task 15 ✓
   - Verification: Task 16 ✓
   - Dry-run mode: integrated into Task 12 ✓
   - Bulk approval: explicitly out of scope (named follow-up) ✓
2. **No placeholders** — every code block is complete; no TBD / TODO; commit messages and verification commands are concrete.
3. **Type consistency** — `BcClaimLineItem`, `BcClaimPayloadFromDb`, `PayloadBuilderInput`, and the function `buildBcLineItems` are defined in Task 9 and used identically in Tasks 10, 11, 12.

If anything fails or surprises you during implementation (especially Postman vs spec mismatches, or `claim_audit_log` column names not matching the inline INSERT in `complete_bc_payment`), **stop and ask** before working around it.

---

## Out of Scope (named follow-ups)

- **Bulk approval through BC**: separate plan. Modifies `bulkApprove()` (`src/modules/claims/actions.ts:2085`) to branch per claim by payment mode, sequence Reimbursement claims through `bc-payment`, and surface a result-summary modal.
- **Admin UI for stuck rows**: only if the runbook proves insufficient.
- **Alerting integration for stuck rows**: only if observed frequency justifies it.
- **Production BC environment**: switch `BC_ENVIRONMENT` and `BC_COMPANY_ID` secrets to prod values; no code changes expected.
