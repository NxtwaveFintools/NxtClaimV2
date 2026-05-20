# BC Integration Review Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all ~20 findings from the PR #120 review (security, correctness, UX, test gaps) on branch `bc_int`.

**Architecture:** Six independent phases (A–F). A new append-only SQL migration; consolidated OData escaping; payload/handler correctness fixes; modal/combobox UX; new tests; CI-aware integration gating. TDD throughout; one commit per task.

**Tech Stack:** Deno edge functions (`deno test`), Next.js/React + Jest/RTL, Supabase Postgres (plpgsql, SECURITY DEFINER), Zod.

**Spec:** `docs/superpowers/specs/2026-05-20-bc-integration-review-remediation-design.md`

**Conventions:**

- Edge tests: `deno test --allow-env supabase/functions/<path>` (handlers guard `Deno.serve` with `import.meta.main` so import is net-free).
- Node tests: `npx jest <path>`; types: `npx tsc --noEmit`; lint: `npx eslint <paths>`.
- Pre-commit hook runs eslint --fix + prettier; re-verify green after commit.
- Migration is **append-only** — never edit applied files. Dry-run against NxtClaimTest before claiming done.

---

## Phase A — Database

### Task A1: New corrective migration (status gate + baked-in search_path + grants)

**Files:**

- Create: `supabase/migrations/20260520040000_bc_payload_status_gate_and_search_path.sql`

Closes blockers #1 (search_path skip-risk), #2 (status gate), #3 (lifecycle search_path/grants), and minor #5 (txn-wrapping). The four functions are recreated with `SET search_path = public, pg_temp` baked into the definition; grants reaffirmed; `get_bc_claim_payload` gains the status gate (`P0005`).

- [ ] **Step 1: Write the migration file**

```sql
-- Corrective migration for PR #120 review:
--  1. Bake `SET search_path = public, pg_temp` into all four BC SECURITY DEFINER
--     functions so a fresh-DB restore can never apply them with an unpinned
--     (caller-controlled) search_path, even if 20260520020000 is skipped.
--  2. Add a workflow-status gate to get_bc_claim_payload (P0005 INVALID_CLAIM_STATE):
--     only claims at 'HOD approved - Awaiting finance approval' may be pushed to BC.
--  3. Reaffirm least-privilege grants (service_role only).
-- Append-only: supersedes the standalone pins in 20260520020000 (now redundant).
-- NOTE for future migrations: ALTER COLUMN TYPE on large tables should set
--   `SET lock_timeout = '5s'` to fail fast instead of stalling the table.

BEGIN;

-- 1. get_bc_claim_payload — search_path baked in + status gate (P0005).
CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_already_submitted_id UUID;
  v_payment_mode_name    TEXT;
  v_status               public.claim_status;
  v_result               JSONB;
BEGIN
  SELECT c.bc_claim_details_id, mpm.name, c.status
    INTO v_already_submitted_id, v_payment_mode_name, v_status
  FROM public.claims c
  JOIN public.master_payment_modes mpm ON mpm.id = c.payment_mode_id
  WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: %', p_claim_id USING ERRCODE = 'P0001';
  END IF;

  IF v_already_submitted_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: %', v_already_submitted_id USING ERRCODE = 'P0002';
  END IF;

  -- Workflow-status gate: BC submission is only valid while finance is approving.
  IF v_status <> 'HOD approved - Awaiting finance approval'::public.claim_status THEN
    RAISE EXCEPTION 'INVALID_CLAIM_STATE: % is %', p_claim_id, v_status
      USING ERRCODE = 'P0005';
  END IF;

  SELECT jsonb_build_object(
    'claim_id',                     c.id,
    'payment_mode_name',            v_payment_mode_name,
    'submission_type',              c.submission_type,
    'employee_id',                  c.employee_id,
    'on_behalf_employee_code',      c.on_behalf_employee_code,
    'employee_name',
      CASE WHEN c.submission_type = 'On Behalf'::claim_submission_type
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
    'bc_code',                      ecm.bc_code,
    'basic_amount',                 ed.basic_amount,
    'total_amount',                 ed.total_amount,
    'foreign_basic_amount',         COALESCE(ed.foreign_basic_amount, 0),
    'foreign_total_amount',         COALESCE(ed.foreign_total_amount, 0)
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

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'MISSING_MAPPING: one or more required mappings missing for claim %', p_claim_id
      USING ERRCODE = 'P0003';
  END IF;

  RETURN v_result;
END;
$$;

-- 2. start_bc_claim_attempt — search_path baked in.
CREATE OR REPLACE FUNCTION public.start_bc_claim_attempt(
  p_claim_id          TEXT,
  p_is_vendor_payment BOOLEAN,
  p_payload_json      JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bc_details_id UUID;
BEGIN
  INSERT INTO public.bc_claim_details
    (claim_id, is_vendor_payment, bc_status, bc_payload_json, bc_response_json)
  VALUES
    (p_claim_id, p_is_vendor_payment, 'submitting', p_payload_json, NULL)
  RETURNING id INTO v_bc_details_id;

  RETURN v_bc_details_id;
END;
$$;

-- 3. complete_bc_claim — search_path baked in.
CREATE OR REPLACE FUNCTION public.complete_bc_claim(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim_id TEXT;
BEGIN
  UPDATE public.bc_claim_details
  SET    bc_status        = 'success',
         bc_response_json = p_response_json
  WHERE  id        = p_bc_details_id
    AND  bc_status = 'submitting'
  RETURNING claim_id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'BC_DETAILS_NOT_IN_FLIGHT: %', p_bc_details_id USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.claims
  SET    bc_claim_details_id = p_bc_details_id,
         status              = 'Finance Approved - Payment under process',
         updated_at          = now()
  WHERE  id = v_claim_id;

  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
  VALUES (v_claim_id, p_actor_user_id, 'BC_SUBMITTED',
          'bc_claim_details_id: ' || p_bc_details_id::text);
END;
$$;

-- 4. record_bc_claim_failure — search_path baked in.
CREATE OR REPLACE FUNCTION public.record_bc_claim_failure(
  p_bc_details_id     UUID,
  p_actor_user_id     UUID,
  p_response_json     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
  VALUES (v_claim_id, p_actor_user_id, 'BC_SUBMISSION_FAILED',
          'bc_claim_details_id: ' || p_bc_details_id::text);
END;
$$;

-- 5. Reaffirm least-privilege grants on all four (idempotent).
REVOKE EXECUTE ON FUNCTION public.get_bc_claim_payload(TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_bc_claim_attempt(TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_bc_claim(UUID, UUID, JSONB)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_bc_claim_failure(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_bc_claim_payload(TEXT)               TO service_role;
GRANT EXECUTE ON FUNCTION public.start_bc_claim_attempt(TEXT, BOOLEAN, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_bc_claim(UUID, UUID, JSONB)     TO service_role;
GRANT EXECUTE ON FUNCTION public.record_bc_claim_failure(UUID, UUID, JSONB) TO service_role;

COMMIT;
```

- [ ] **Step 2: Confirm the claims.status enum value/type name**

Run (read-only) against NxtClaimTest via the Supabase MCP `execute_sql`:

```sql
SELECT unnest(enum_range(NULL::public.claim_status))::text;
```

Expected: list includes `HOD approved - Awaiting finance approval`. If the enum type is not named `claim_status`, update the `::public.claim_status` casts in the migration to the actual type name.

- [ ] **Step 3: Dry-run the migration in a transaction (rollback)**

Run via Supabase MCP `execute_sql` (wrap in an explicit ROLLBACK to avoid mutating the test DB during dry-run), or use a Supabase preview branch. Expected: no syntax/cast errors.

- [ ] **Step 4: Apply to NxtClaimTest and verify**

Apply via `apply_migration`. Then verify:

```sql
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('get_bc_claim_payload','start_bc_claim_attempt','complete_bc_claim','record_bc_claim_failure');
```

Expected: every row's `proconfig` contains `search_path=public, pg_temp`.

```sql
SELECT proname, proacl FROM pg_proc WHERE proname = 'get_bc_claim_payload';
```

Expected: ACL grants EXECUTE to `service_role` only (no anon/authenticated).

- [ ] **Step 5: Verify the status gate behaviorally**

Pick a claim NOT at the eligible status (read-only) and call the RPC; expect `P0005`:

```sql
-- find a non-eligible, active, not-yet-submitted claim id
SELECT id, status FROM public.claims
WHERE is_active AND bc_claim_details_id IS NULL
  AND status <> 'HOD approved - Awaiting finance approval' LIMIT 1;
-- then (expect ERROR P0005 INVALID_CLAIM_STATE):
SELECT public.get_bc_claim_payload('<that-id>');
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260520040000_bc_payload_status_gate_and_search_path.sql
git commit -m "fix(db): bake search_path + add claim-status gate to BC RPCs (P0005)"
```

---

## Phase B — Shared edge modules

### Task B1: `escapeOdataLiteral` single-source escaping (blocker #3)

**Files:**

- Modify: `supabase/functions/_shared/bcSearch.ts`
- Modify: `supabase/functions/_shared/bcSearch.test.ts`
- Modify: `supabase/functions/bc-vendor-search/index.ts:56,59`
- Modify: `supabase/functions/bc-reference/index.ts:106`

- [ ] **Step 1: Write failing tests** — append to `bcSearch.test.ts`:

```ts
import { BC_SEARCH_MAX_LEN, escapeOdataLiteral, sanitizeBcSearchQuery } from "./bcSearch.ts";

Deno.test("escapeOdataLiteral doubles single quotes", () => {
  assertEquals(escapeOdataLiteral("o'brien"), "o''brien");
});

Deno.test("escapeOdataLiteral strips ASCII control characters (keeps normal spaces)", () => {
  assertEquals(escapeOdataLiteral("ab cd\n\t"), "ab cd");
});

Deno.test("escapeOdataLiteral leaves ordinary punctuation intact", () => {
  assertEquals(escapeOdataLiteral("Tech (India) Pvt Ltd"), "Tech (India) Pvt Ltd");
});
```

Also update the existing line-21 test name/intent (it documented quotes "preserved" by `sanitizeBcSearchQuery`; that's still true for the sanitizer — keep it, the escape now lives in `escapeOdataLiteral`).

- [ ] **Step 2: Run — expect FAIL** (`escapeOdataLiteral` not exported):

Run: `deno test --allow-env supabase/functions/_shared/bcSearch.test.ts`
Expected: FAIL — `escapeOdataLiteral is not a function` / no export.

- [ ] **Step 3: Implement** — add to `bcSearch.ts`:

```ts
/**
 * Escapes a (already sanitized) term for safe interpolation inside a
 * single-quoted OData string literal: doubles `'` and strips ASCII control
 * chars. This is the single source of OData-injection defense — callers MUST
 * use it instead of ad-hoc replaces.
 */
export function escapeOdataLiteral(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F]/g, "").replace(/'/g, "''");
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `deno test --allow-env supabase/functions/_shared/bcSearch.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Use it in callers** — `bc-vendor-search/index.ts`:
  - Add import: `import { escapeOdataLiteral, sanitizeBcSearchQuery } from "../_shared/bcSearch.ts";`
  - Line ~56: replace `.map((v) => v.replace(/'/g, "''"));` → `.map((v) => escapeOdataLiteral(v));`
  - Line ~59: replace `` `contains(No,'${q.toUpperCase().replace(/'/g, "''")}')` `` → `` `contains(No,'${escapeOdataLiteral(q.toUpperCase())}')` ``

  `bc-reference/index.ts`:
  - Add `escapeOdataLiteral` to the existing `bcSearch.ts` import.
  - Line ~106: replace `.map((v) => v.replace(/'/g, "''"));` → `.map((v) => escapeOdataLiteral(v));`

- [ ] **Step 6: Run edge tests + commit**

Run: `deno test --allow-env supabase/functions/_shared/ supabase/functions/bc-reference/`
Expected: PASS.

```bash
git add supabase/functions/_shared/bcSearch.ts supabase/functions/_shared/bcSearch.test.ts supabase/functions/bc-vendor-search/index.ts supabase/functions/bc-reference/index.ts
git commit -m "fix(bc): consolidate OData escaping into escapeOdataLiteral"
```

### Task B2: `requireFinanceApprover` → 403 FORBIDDEN (minor)

**Files:**

- Modify: `supabase/functions/_shared/auth.ts`
- Modify: `supabase/functions/_shared/auth.test.ts`
- Modify: `supabase/functions/bc-claim/index.ts:84-87`

- [ ] **Step 1: Write failing test** — add to `auth.test.ts` (mirror existing approver test, asserting the new shape):

```ts
Deno.test(
  "requireFinanceApprover returns 403 FORBIDDEN for an authenticated non-approver",
  async () => {
    __setAuthClientFactory(makeFactory({ user: { id: "u1" }, approverRow: null }));
    const res = await requireFinanceApprover(
      new Request("http://x", { headers: { Authorization: "Bearer t" } }),
    );
    assertEquals(res, { ok: false, status: 403, code: "FORBIDDEN" });
    __setAuthClientFactory(null);
  },
);
```

(Use the file's existing `makeFactory`/mock helper; match its current parameter shape.)

- [ ] **Step 2: Run — expect FAIL** (`auth.ts` still returns 401/UNAUTHENTICATED):

Run: `deno test --allow-env supabase/functions/_shared/auth.test.ts`
Expected: FAIL — got `status: 401, code: "UNAUTHENTICATED"`.

- [ ] **Step 3: Implement** — in `auth.ts`:
  - Extend the union:

```ts
export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401; code: "UNAUTHENTICATED" }
  | { ok: false; status: 403; code: "FORBIDDEN" };
```

- Line 41: replace `if (!row) return { ok: false, status: 401, code: "UNAUTHENTICATED" };` → `if (!row) return { ok: false, status: 403, code: "FORBIDDEN" };`

- [ ] **Step 4: Propagate the code in the caller** — `bc-claim/index.ts:84-87`:

```ts
const auth = await requireFinanceApprover(req);
if (!auth.ok) {
  log("bc-claim", "warn", "auth_failed");
  return errResp(cors.headers, { code: auth.code }, auth.status);
}
```

And add `{ code: "FORBIDDEN" }` to the `BcClaimError` union (see Task C2 — coordinate; if C2 runs first this is already present).

- [ ] **Step 5: Run — expect PASS**

Run: `deno test --allow-env supabase/functions/_shared/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts supabase/functions/bc-claim/index.ts
git commit -m "fix(bc): return 403 FORBIDDEN for authenticated non-approvers"
```

### Task B3: Document CORS as advisory (CORS decision)

**Files:**

- Modify: `supabase/functions/_shared/cors.ts`

- [ ] **Step 1: Add doc comment** above `resolveCors` (line ~23):

```ts
/**
 * Resolves CORS for a request. NOTE: the returned `allow` flag is advisory —
 * it governs only the preflight (corsPreflightResponse) and which response
 * headers a browser will honor. It is NOT an authorization gate: every BC
 * endpoint independently enforces auth (requireAuthenticatedUser /
 * requireFinanceApprover), which is the real protection. We deliberately do
 * not 403 real requests on Origin so server-to-server callers (no Origin
 * header) keep working.
 */
```

- [ ] **Step 2: Verify nothing broke + commit**

Run: `deno test --allow-env supabase/functions/_shared/cors.test.ts`
Expected: PASS (no behavior change).

```bash
git add supabase/functions/_shared/cors.ts
git commit -m "docs(bc): clarify CORS allow is advisory; auth is the gate"
```

---

## Phase C — Handlers / payload

### Task C1: payloadBuilder — case-insensitive `paymentRequired` + vendor `Ammount` fallback

**Files:**

- Modify: `supabase/functions/bc-claim/payloadBuilder.ts:75-80,102`
- Modify: `supabase/functions/bc-claim/payloadBuilder.test.ts`

- [ ] **Step 1: Write failing tests** — append to `payloadBuilder.test.ts` (reuse the file's existing `db` fixture factory; adjust field names to match it):

```ts
Deno.test("paymentRequired is true for 'reimbursement' regardless of case/whitespace", () => {
  const item = buildBcClaimLineItem({
    db: makeDb({ payment_mode_name: "  ReimBursement " }),
    isVendorPayment: false,
  });
  assertEquals(item.paymentRequired, true);
});

Deno.test("vendor Ammount falls back to basic_amount when foreign_basic_amount is 0", () => {
  const item = buildBcClaimLineItem({
    db: makeDb({ basic_amount: 500, foreign_basic_amount: 0 }),
    isVendorPayment: true,
    vendor: { code: "V1", name: "Vendor", currencyCode: "USD", gstGroupCode: "G", hsnSacCode: "H" },
  });
  assertEquals(item.Ammount, 500);
});

Deno.test("vendor Ammount uses foreign_basic_amount when it is > 0", () => {
  const item = buildBcClaimLineItem({
    db: makeDb({ basic_amount: 500, foreign_basic_amount: 80 }),
    isVendorPayment: true,
    vendor: { code: "V1", name: "Vendor", currencyCode: "USD", gstGroupCode: "G", hsnSacCode: "H" },
  });
  assertEquals(item.Ammount, 80);
});
```

(If the test file builds `db` inline rather than via a `makeDb` helper, follow that style instead.)

- [ ] **Step 2: Run — expect FAIL**

Run: `deno test --allow-env supabase/functions/bc-claim/payloadBuilder.test.ts`
Expected: FAIL — `paymentRequired` false for mixed case; `Ammount` is `0` for the vendor-0 case.

- [ ] **Step 3: Implement** — `payloadBuilder.ts`:
  - Lines 76-80, vendor `Ammount` fallback:

```ts
const Ammount = isVendorPayment
  ? db.foreign_basic_amount > 0
    ? db.foreign_basic_amount
    : db.basic_amount
  : db.foreign_total_amount > 0
    ? db.foreign_total_amount
    : db.total_amount;
```

- Line 102, case-insensitive payment mode:

```ts
    paymentRequired: db.payment_mode_name?.trim().toLowerCase() === "reimbursement",
```

- [ ] **Step 4: Run — expect PASS**

Run: `deno test --allow-env supabase/functions/bc-claim/payloadBuilder.test.ts`
Expected: PASS (all, incl. existing 22).

- [ ] **Step 5: Update the types.ts comment** (lines 51-53) to note vendor `Ammount` now falls back to `basic_amount` when foreign is 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/bc-claim/payloadBuilder.ts supabase/functions/bc-claim/payloadBuilder.test.ts supabase/functions/bc-claim/types.ts
git commit -m "fix(bc): case-insensitive paymentRequired + vendor Ammount fallback to basic_amount"
```

### Task C2: bc-claim handler — new error codes + failure-RPC error logging

**Files:**

- Modify: `supabase/functions/bc-claim/types.ts:94-102`
- Modify: `supabase/functions/bc-claim/index.ts`

(Handler tests for these come in Task E1, which also refactors the handler to be importable. This task makes the behavior changes; E1 adds coverage.)

- [ ] **Step 1: Extend `BcClaimError`** (`types.ts`):

```ts
export type BcClaimError =
  | { code: "UNAUTHENTICATED" }
  | { code: "FORBIDDEN" }
  | { code: "INVALID_BODY"; details: string[] }
  | { code: "CLAIM_NOT_FOUND"; claimId: string }
  | { code: "ALREADY_SUBMITTED"; bcClaimDetailsId: string | null }
  | { code: "ALREADY_IN_FLIGHT" }
  | { code: "INVALID_CLAIM_STATE"; detail?: string }
  | { code: "MISSING_MAPPING"; detail?: string }
  | { code: "INTERNAL_ERROR"; detail?: string }
  | { code: "BC_FETCH_FAILED"; status: number; body: unknown }
  | { code: "RPC_FAILED_AFTER_BC_SUCCESS"; bcClaimDetailsId: string; detail: string };
```

- [ ] **Step 2: Map P0005 + use INTERNAL_ERROR** (`index.ts`, the payloadErr block ~112-130):

```ts
if (code === "P0003") {
  return errResp(cors.headers, { code: "MISSING_MAPPING", detail: msg }, 422);
}
if (code === "P0005") {
  return errResp(cors.headers, { code: "INVALID_CLAIM_STATE", detail: msg }, 409);
}
return errResp(cors.headers, { code: "INTERNAL_ERROR", detail: msg }, 500);
```

And the `start_bc_claim_attempt` fallthrough (~190):

```ts
return errResp(cors.headers, { code: "INTERNAL_ERROR", detail: startErr.message }, 500);
```

- [ ] **Step 3: Capture & log `record_bc_claim_failure` errors** — both call sites (~217 and ~239). Replace each bare `await admin.rpc("record_bc_claim_failure", {...});` with:

```ts
    const { error: recordErr } = await admin.rpc("record_bc_claim_failure", {
      p_bc_details_id: bcDetailsId,
      p_actor_user_id: actorUserId,
      p_response_json: <existing payload for this site>,
    });
    if (recordErr) {
      log("bc-claim", "error", "record_failure_rpc_failed", {
        claim_id: input.claimId,
        bc_details_id: bcDetailsId,
        detail: recordErr.message,
      });
    }
```

(Keep each site's existing `p_response_json` value: `{ error: "network_or_timeout", detail: String(err) }` at the catch site; `bcResult.body` at the non-2xx site.)

- [ ] **Step 4: Verify types compile** (handler test coverage is Task E1).

Run: `deno check supabase/functions/bc-claim/index.ts`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bc-claim/types.ts supabase/functions/bc-claim/index.ts
git commit -m "fix(bc): map INVALID_CLAIM_STATE/INTERNAL_ERROR; log record_failure RPC errors"
```

### Task C3: bc-vendor-search — prioritize code matches + guard Deno.serve

**Files:**

- Modify: `supabase/functions/bc-vendor-search/index.ts:82,96-100,12`

- [ ] **Step 1: Prioritize exact `No` (code) matches** — change the merge loop (lines 96-100) to seed code matches first:

```ts
const merged = new Map<string, { no: string; name: string }>();
for (const v of [...(noData.value ?? []), ...(nameData.value ?? [])]) {
  if (!merged.has(v.No)) merged.set(v.No, { no: v.No, name: v.Name });
  if (merged.size >= 20) break;
}
```

(swap iteration order so `noData` is consumed before `nameData`).

- [ ] **Step 2: Guard `Deno.serve`** — refactor to an exported handler (mirrors bc-reference):
  - Wrap the existing `Deno.serve(async (req) => { ... })` body as `export async function handler(req: Request): Promise<Response> { ... }`.
  - Replace the trailing `});` so the bottom reads: `if (import.meta.main) Deno.serve(handler);`
  - Keep the `json()` helper below.

- [ ] **Step 3: Type-check + commit**

Run: `deno check supabase/functions/bc-vendor-search/index.ts`
Expected: no errors.

```bash
git add supabase/functions/bc-vendor-search/index.ts
git commit -m "fix(bc): prioritize vendor code matches; guard Deno.serve with import.meta.main"
```

---

## Phase D — Frontend

### Task D1: SearchableCombobox — `enableSearch` prop, comment, trim `emptyText`

**Files:**

- Modify: `src/components/ui/searchable-combobox.tsx`
- Test: `tests/unit/components/searchable-combobox.test.tsx` (new)

- [ ] **Step 1: Write failing test** (new file):

```tsx
import { render, screen } from "@testing-library/react";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";

const opts = [
  { code: "A", description: "Alpha" },
  { code: "B", description: "Beta" },
];

test("renders the internal search box by default", async () => {
  render(<SearchableCombobox options={opts} value="" onChange={() => {}} />);
  screen.getByRole("button").click();
  expect(await screen.findByPlaceholderText(/options/i)).toBeInTheDocument();
});

test("hides the internal search box when enableSearch is false", async () => {
  render(<SearchableCombobox options={opts} value="" onChange={() => {}} enableSearch={false} />);
  screen.getByRole("button").click();
  await screen.findByRole("listbox");
  expect(screen.queryByPlaceholderText(/options/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest tests/unit/components/searchable-combobox.test.tsx`
Expected: FAIL — search box still rendered when `enableSearch={false}`.

- [ ] **Step 3: Implement**:
  - `Props`: add `enableSearch?: boolean;`, remove `emptyText?` (hardcode "No matches").
  - Destructure: add `enableSearch = true`, remove `emptyText = "No matches"`.
  - Replace any `{emptyText}` usage with the literal `No matches`.
  - Wrap the search `<div className="relative border-b ...">…</div>` block (lines ~198-211) in `{enableSearch && ( … )}`.
  - When `!enableSearch`, still allow keyboard nav: move `onKeyDown` handling so arrow/enter work on the list (attach `onKeyDown={onKeyDown}` to the `<ul>` with `tabIndex={0}` when search is hidden; keep input handler when shown).
  - Update the top doc comment (lines 7-23): remove the "16k+ items / virtualises" framing; state it filters small fully-loaded lists, and that callers needing server-side search pass `enableSearch={false}` to render a plain list.

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/unit/components/searchable-combobox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/searchable-combobox.tsx tests/unit/components/searchable-combobox.test.tsx
git commit -m "feat(ui): SearchableCombobox enableSearch prop; drop unused emptyText"
```

### Task D2: bc-claim-modal — HSN double-search, loader gating, void, result guard, vendor a11y

**Files:**

- Modify: `src/modules/claims/ui/bc-claim-modal.tsx`

- [ ] **Step 1: Kill HSN double-search** — in `ReferenceField`, pass `enableSearch={!isSearchable}` to `<SearchableCombobox>` (the `state.status === "loaded"` branch, ~796-803).

- [ ] **Step 2: Fix loader gating** (line ~238): change the `allRefsLoading` predicate from `(s) => s.status === "loading" || s.status === "idle"` to `(s) => s.status === "loading"`.

- [ ] **Step 3: `void` floating promises** — Retry-all (~391-397) and per-field `onRetry` (~423-451): prefix the `fetchReference(...)` calls with `void ` to match the effect calls at 141-142.

- [ ] **Step 4: Runtime-guard the result cast** (~281-283). Replace the `as`-cast with a guard:

```ts
  const result =
    data && typeof data === "object" && "success" in data
      ? (data as { success: boolean; bcClaimDetailsId?: string; error?: BcClaimError })
      : null;
  if (!result) {
    // unexpected shape → treat as generic failure
    ...existing generic error handling...
  }
```

(Adapt to the existing variable names / error-handling block.)

- [ ] **Step 5: Vendor picker a11y** (`VendorPicker`, ~679-705): add `role="listbox"` to the results container, `role="option"` + `aria-selected` to each `<button>`, and arrow-up/down + Enter handling that moves an `activeIndex` and commits the active vendor. (Keep existing click behavior.)

- [ ] **Step 6: Verify**

Run: `npx jest tests/unit/claims/new-claim-form-client.test.tsx tests/unit/claims/finance-edit-claim-form.test.tsx` (smoke for modal-adjacent), then `npx tsc --noEmit` and `npx eslint src/modules/claims/ui/bc-claim-modal.tsx`.
Expected: PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/claims/ui/bc-claim-modal.tsx
git commit -m "fix(bc-modal): single HSN search, loader gating, void retries, result guard, vendor a11y"
```

### Task D3: ExportClaimsService — 10-year URL rationale comment (nit)

**Files:**

- Modify: `src/core/domain/claims/ExportClaimsService.ts:436`

- [ ] **Step 1:** Add above the `60 * 60 * 24 * 365 * 10` expiry the same rationale comment used in `page.tsx` (leaked URL valid 10y; acceptable as links sit behind authenticated routes). No behavior change.

- [ ] **Step 2: Commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add src/core/domain/claims/ExportClaimsService.ts
git commit -m "docs(claims): explain 10-year signed-URL expiry in ExportClaimsService"
```

---

## Phase E — Test coverage

### Task E1: bc-claim handler tests (refactor to importable + admin seam)

**Files:**

- Modify: `supabase/functions/bc-claim/index.ts`
- Create: `supabase/functions/bc-claim/index.test.ts`

- [ ] **Step 1: Refactor handler to be importable + add admin-client seam.** In `index.ts`:
  - Add a factory seam mirroring `auth.ts`:

```ts
type AdminFactory = () => ReturnType<typeof createClient>;
let adminFactory: AdminFactory = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export function __setBcClaimAdminFactory(fn: AdminFactory | null): void {
  adminFactory =
    fn ??
    (() => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
}
```

- Replace the inline `const admin = createClient(...)` (lines ~90-92) with `const admin = adminFactory();`.
- Wrap the `Deno.serve(async (req) => { ... })` body as `export async function handler(req: Request): Promise<Response> { ... }`; bottom becomes `if (import.meta.main) Deno.serve(handler);`.

- [ ] **Step 2: Write failing tests** (`index.test.ts`) using the seams `__setAuthClientFactory` (from auth.ts), `__setBcClaimAdminFactory`, and `__setBcFetchImpl` (from bcClient.ts). Build a minimal fake admin whose `.rpc(name, args)` returns scripted `{ data, error }` per test and `.storage.from().createSignedUrl()` returns a url. Cover:
  - non-approver → 403 `FORBIDDEN`
  - `get_bc_claim_payload` P0001→404, P0002→409, P0003→422, P0005→409 `INVALID_CLAIM_STATE`, other→500 `INTERNAL_ERROR`
  - `start_bc_claim_attempt` `23505`→409 `ALREADY_IN_FLIGHT`
  - BC non-2xx → 502 `BC_FETCH_FAILED` AND `record_bc_claim_failure` invoked
  - `complete_bc_claim` error after BC 2xx → 500 `RPC_FAILED_AFTER_BC_SUCCESS`

Example shape for one case:

```ts
Deno.test("P0005 from payload RPC → 409 INVALID_CLAIM_STATE", async () => {
  __setAuthClientFactory(approverFactory("u1"));
  __setBcClaimAdminFactory(() =>
    fakeAdmin({
      get_bc_claim_payload: {
        data: null,
        error: { code: "P0005", message: "INVALID_CLAIM_STATE: c1 is Approved" },
      },
    }),
  );
  const res = await handler(postReq({ claimId: "c1", isVendorPayment: false }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "INVALID_CLAIM_STATE");
  resetSeams();
});
```

(Define `approverFactory`, `fakeAdmin`, `postReq`, `resetSeams` helpers at the top of the test file. `postReq` must set `Authorization: Bearer t`, method POST, and an allowed Origin or rely on cors test override.)

- [ ] **Step 3: Run — expect FAIL** (no `handler`/seam yet if Step 1 partial; then assertion-driven):

Run: `deno test --allow-env supabase/functions/bc-claim/index.test.ts`
Expected: FAIL initially, then implement until green.

- [ ] **Step 4: Run — expect PASS**

Run: `deno test --allow-env supabase/functions/bc-claim/`
Expected: PASS (payloadBuilder + index).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bc-claim/index.ts supabase/functions/bc-claim/index.test.ts
git commit -m "test(bc): handler tests for bc-claim lifecycle + error mapping"
```

### Task E2: Frontend debounced-search race test

**Files:**

- Create: `tests/unit/claims/bc-claim-modal-search.test.tsx`

- [ ] **Step 1: Write the test** — render the modal (or extract the HSN/vendor search hook if cleaner), mock `supabase.functions.invoke` to resolve out of order (second query resolves before the first), type rapidly, and assert only the latest query's results render (stale dropped via the `cancelled` flag).

```tsx
// drive: type "99" then "996"; make "99" resolve AFTER "996"; assert "996" results shown, "99" dropped.
```

(If the modal is hard to mount in isolation, extract the debounced search into a `useBcReferenceSearch` hook and test the hook — note this in the commit. Prefer testing real behavior.)

- [ ] **Step 2: Run — expect FAIL if a bug exists, else PASS documenting correctness.**

Run: `npx jest tests/unit/claims/bc-claim-modal-search.test.tsx`
Expected: PASS (cleanup already correct) — this is a regression lock. If it FAILS, fix the effect cleanup before committing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/claims/bc-claim-modal-search.test.tsx
git commit -m "test(bc-modal): lock debounced-search stale-response cancellation"
```

---

## Phase F — Integration-test CI gating (blocker #5)

### Task F1: Shared CI-aware skip helper

**Files:**

- Create: `tests/integration/_support/require-test-env.ts`
- Modify: `tests/integration/bc-claim-rpc.test.ts`, `bc-rpc-anon-lockdown.test.ts`, `department-mapping-completeness.test.ts`, `bc-edge-deployment.test.ts`

- [ ] **Step 1: Write the helper**:

```ts
// Returns the describe to use. In CI (process.env.CI set) with missing secrets,
// throws so the suite FAILS loudly instead of silently skipping.
import { describe } from "@jest/globals";

export function describeRequiringTestEnv(required: string[]): typeof describe {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length === 0) return describe;
  if (process.env.CI) {
    throw new Error(`Integration tests require env vars in CI but missing: ${missing.join(", ")}`);
  }
  return describe.skip;
}
```

- [ ] **Step 2: Use it** — in each of the 4 files, replace the local `const skip = !projectUrl || !serviceKey;` + `(skip ? describe.skip : describe)(...)` with:

```ts
import { describeRequiringTestEnv } from "./_support/require-test-env";
const d = describeRequiringTestEnv(["SUPABASE_TEST_URL", "SUPABASE_TEST_SERVICE_ROLE_KEY"]);
// ...
d("get_bc_claim_payload (integration)", () => { ... });
```

(Use each file's actual required-var list — `bc-edge-deployment` may need additional vars; include exactly what that file reads.)

- [ ] **Step 3: Verify both paths**

Local (no secrets): `npx jest tests/integration/bc-claim-rpc.test.ts` → suite skipped, exit 0.
CI sim: `CI=1 npx jest tests/integration/bc-claim-rpc.test.ts` → FAILS with the missing-env error.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/_support/require-test-env.ts tests/integration/bc-claim-rpc.test.ts tests/integration/bc-rpc-anon-lockdown.test.ts tests/integration/department-mapping-completeness.test.ts tests/integration/bc-edge-deployment.test.ts
git commit -m "test(bc): fail (not skip) BC integration tests when CI lacks secrets"
```

---

## Final verification (after all phases)

- [ ] `deno test --allow-env supabase/functions/` → all pass
- [ ] `npx jest` (full unit suite) → all pass
- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npx eslint .` → exit 0
- [ ] Migration verified on NxtClaimTest (proconfig + ACL + P0005 behavior)
- [ ] Re-run the four review reviewers (or spot-check) against the diff
- [ ] Push `bc_int` only on user confirmation

---

## Self-review notes (coverage map)

- Blocker #1 search_path → A1. #2 status gate → A1 + C2 mapping. #3 OData escape → B1. #4 record_failure errors → C2. #5 CI gating → F1.
- Important: CORS → B3; lock_timeout → A1 header note; paymentRequired → C1; bcVendorName display-only → C1 types comment (Task C1 step 5) + (already trusted code is authoritative); HSN double-search → D1/D2; allRefsLoading → D2.
- Minor: INTERNAL_ERROR → C2; vendor merge order → C3; vendor a11y → D2; txn-wrap → A1; 401→403 → B2; stale combobox comment → D1.
- Nits: trim emptyText → D1; Deno.serve guard (vendor-search) → C3; 10y URL comment → D3; floating promises → D2; result cast guard → D2.
- Test gaps: handler tests → E1; vendor 0-amount → C1; race cleanup → E2.
