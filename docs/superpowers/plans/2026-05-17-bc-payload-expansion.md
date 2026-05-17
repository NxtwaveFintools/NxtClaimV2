# BC Payload Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old `bc-payment` integration with a richer `bc-claim` payload (26 fields), a new `bc-reference` edge function for Finance dropdowns, and a race-/outbox-safe DB lifecycle (`submitting` → `success`/`failed`).

**Architecture:** Three-phase DB function lifecycle (`start_bc_claim_attempt` → BC POST → `complete_bc_claim` / `record_bc_claim_failure`) with a partial UNIQUE index on `(claim_id) WHERE bc_status IN ('submitting','success')` as the concurrency guard. Generic `_shared/bcClient.ts` HTTP wrapper consumed by both new edge functions. Frontend cascade renames `bcPaymentsFlag: boolean` → `bcClaimDetailsId: string | null`.

**Tech Stack:** PostgreSQL 15 (Supabase), Deno (edge functions), TypeScript, Next.js, Jest, React Hook Form + zod, shadcn/ui Dialog. Reference spec: `docs/superpowers/specs/2026-05-16-bc-payload-expansion-design.md`.

**Test env:** No data preservation — every old artifact gets `DROP`ped cleanly. Verification grep at end of plan must return zero hits.

---

## Phase 1 — Database foundation

### Task 1: Schema migration — drop legacy, create `bc_claim_details` + enum + indexes + trigger + RLS + audit-log CHECK extension

**Files:**

- Create: `supabase/migrations/20260517090000_bc_claim_details_schema.sql`

The full SQL is in spec §1.1. Copy it verbatim into this file.

- [ ] **Step 1: Create the migration file with the SQL from spec §1.1**

Create `supabase/migrations/20260517090000_bc_claim_details_schema.sql` containing the SQL block from spec §1.1 (lines numbered "1." through "9." inside the `sql` fence — drops, ENUM creation, table, indexes, trigger function + trigger, claims column changes, audit-log CHECK extension, RLS policies). Exactly as written in the spec.

- [ ] **Step 2: Reset local DB to apply the migration**

```bash
supabase db reset
```

Expected: completes without error. All earlier migrations re-apply, then this new one runs.

- [ ] **Step 3: Verify dropped artifacts are gone**

```bash
supabase db diff --schema public | head -30
psql "$SUPABASE_DB_URL" -c "\dt public.bc_*"
psql "$SUPABASE_DB_URL" -c "\dT+ public.bc_*"
```

Expected: `bc_claim_details` exists. `bc_claim_vendors`, `bc_payment_audit_log` are absent. `bc_claim_status` enum has values `submitting`, `success`, `failed`. `bc_payment_audit_status`, `bc_bal_account_type` are absent.

- [ ] **Step 4: Verify partial UNIQUE index by manual probe**

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
-- Pick any existing claim id (the seed loads several).
\set claim_id '''CLM_TEST_PROBE'''
INSERT INTO public.claims (id, status, submission_type, detail_type, submitted_by, department_id, payment_mode_id, employee_id)
SELECT 'CLM_TEST_PROBE', 'HOD approved - Awaiting finance approval', 'Self', 'expense',
       (SELECT id FROM users LIMIT 1),
       (SELECT id FROM master_departments LIMIT 1),
       (SELECT id FROM master_payment_modes LIMIT 1),
       'NW0000001'
WHERE NOT EXISTS (SELECT 1 FROM claims WHERE id = 'CLM_TEST_PROBE');

INSERT INTO public.bc_claim_details (claim_id, is_vendor_payment, bc_status)
  VALUES ('CLM_TEST_PROBE', false, 'submitting');
-- This second INSERT MUST fail with unique_violation.
INSERT INTO public.bc_claim_details (claim_id, is_vendor_payment, bc_status)
  VALUES ('CLM_TEST_PROBE', false, 'submitting');
SQL
```

Expected: second INSERT fails with `ERROR:  duplicate key value violates unique constraint "bc_claim_details_one_active_per_claim"`.

- [ ] **Step 5: Cleanup probe row**

```bash
psql "$SUPABASE_DB_URL" -c "DELETE FROM public.bc_claim_details WHERE claim_id = 'CLM_TEST_PROBE'; DELETE FROM public.claims WHERE id = 'CLM_TEST_PROBE';"
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260517090000_bc_claim_details_schema.sql
git commit -m "feat(db): bc_claim_details schema + race/outbox guard + RLS"
```

---

### Task 2: DB functions migration — `start_bc_claim_attempt`, `complete_bc_claim`, `record_bc_claim_failure`, rewritten `get_bc_claim_payload`, drop `complete_bc_payment`

**Files:**

- Create: `supabase/migrations/20260517090100_bc_claim_functions.sql`

Copy SQL bodies verbatim from spec §1.2 (three lifecycle functions + DROP of `complete_bc_payment`) and §3.3 (rewritten `get_bc_claim_payload`).

- [ ] **Step 1: Compose the migration file**

Create `supabase/migrations/20260517090100_bc_claim_functions.sql` with the following ordered blocks (exact SQL is in the spec):

1. `DROP FUNCTION IF EXISTS public.complete_bc_payment(TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB);` (spec §1.2 final SQL block)
2. `CREATE OR REPLACE FUNCTION public.start_bc_claim_attempt(...)` (spec §1.2 "Start of attempt")
3. `CREATE OR REPLACE FUNCTION public.complete_bc_claim(...)` (spec §1.2 "Success path")
4. `CREATE OR REPLACE FUNCTION public.record_bc_claim_failure(...)` (spec §1.2 "Failure path")
5. `CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT) RETURNS JSONB ...` (spec §3.3 Signature block)

- [ ] **Step 2: Apply the migration**

```bash
supabase db reset
```

Expected: clean apply.

- [ ] **Step 3: Verify functions exist with correct signatures**

```bash
psql "$SUPABASE_DB_URL" -c "\df public.start_bc_claim_attempt public.complete_bc_claim public.record_bc_claim_failure public.get_bc_claim_payload"
psql "$SUPABASE_DB_URL" -c "\df public.complete_bc_payment"
```

Expected: first command lists 4 functions; second command lists nothing (`complete_bc_payment` is dropped).

- [ ] **Step 4: Smoke-test `start_bc_claim_attempt` race guard**

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
-- Setup a probe claim
INSERT INTO public.claims (id, status, submission_type, detail_type, submitted_by, department_id, payment_mode_id, employee_id)
SELECT 'CLM_FN_PROBE', 'HOD approved - Awaiting finance approval', 'Self', 'expense',
       (SELECT id FROM users LIMIT 1),
       (SELECT id FROM master_departments LIMIT 1),
       (SELECT id FROM master_payment_modes LIMIT 1),
       'NW0000001'
WHERE NOT EXISTS (SELECT 1 FROM claims WHERE id = 'CLM_FN_PROBE');

SELECT public.start_bc_claim_attempt('CLM_FN_PROBE', false, '{"probe": true}'::jsonb);
-- Second call MUST raise unique_violation.
SELECT public.start_bc_claim_attempt('CLM_FN_PROBE', false, '{"probe": true}'::jsonb);
SQL
```

Expected: second call fails with `ERROR:  duplicate key value violates unique constraint "bc_claim_details_one_active_per_claim"`.

- [ ] **Step 5: Cleanup probe row**

```bash
psql "$SUPABASE_DB_URL" -c "DELETE FROM public.bc_claim_details WHERE claim_id = 'CLM_FN_PROBE'; DELETE FROM public.claims WHERE id = 'CLM_FN_PROBE';"
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260517090100_bc_claim_functions.sql
git commit -m "feat(db): three-phase BC submission lifecycle functions"
```

---

### Task 3: Recreate dashboard views

**Files:**

- Create: `supabase/migrations/20260517090200_recreate_bc_dashboard_views.sql`

Copy the two `CREATE VIEW` blocks verbatim from spec §1.3 (`vw_admin_claims_dashboard` and `vw_enterprise_claims_dashboard`).

- [ ] **Step 1: Compose the migration file**

Create the migration with two ordered `DROP VIEW IF EXISTS … ; CREATE VIEW … ;` blocks (one per view), exactly as in spec §1.3.

- [ ] **Step 2: Apply**

```bash
supabase db reset
```

Expected: clean apply, no errors about missing columns.

- [ ] **Step 3: Verify view contracts**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT bc_claim_details_id, is_vendor_payment FROM public.vw_admin_claims_dashboard LIMIT 1;"
psql "$SUPABASE_DB_URL" -c "SELECT bc_claim_details_id, is_vendor_payment FROM public.vw_enterprise_claims_dashboard LIMIT 1;"
psql "$SUPABASE_DB_URL" -c "SELECT bc_payments_flag FROM public.vw_admin_claims_dashboard LIMIT 1;" 2>&1 | grep -q "does not exist" && echo "OK: column gone" || echo "FAIL"
```

Expected: first two succeed with the new column names; third matches `does not exist` (the old column is gone).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260517090200_recreate_bc_dashboard_views.sql
git commit -m "feat(db): recreate admin + enterprise dashboard views with bc_claim_details join"
```

---

### Task 4: Regenerate TypeScript database types

**Files:**

- Modify: `src/types/database.ts`

The Supabase CLI generates this file from the live schema. Regenerate, then verify the diff matches spec §1.4.

- [ ] **Step 1: Regenerate types**

```bash
supabase gen types typescript --local > src/types/database.ts
```

Expected: file is overwritten.

- [ ] **Step 2: Inspect the diff for the changes**

```bash
git diff src/types/database.ts | grep -E "bc_claim_details|bc_claim_vendors|bc_payment_audit|bc_payments_flag|is_vendor_payment|bc_bal_account_type|bc_claim_status" | head -40
```

Expected output includes:

- Lines REMOVED: `bc_claim_vendors:`, `bc_payment_audit_log:`, `bc_payment_audit_status:`, `bc_bal_account_type:`, `bc_payments_flag: boolean`, `is_vendor_payment: boolean` (from `claims` row).
- Lines ADDED: `bc_claim_details:`, `bc_claim_status: "submitting" | "success" | "failed"`, `bc_claim_details_id: string | null` (in `claims` row).

If the diff doesn't match (e.g., enum cast to `string` not `Database["public"]["Enums"]["bc_claim_status"]`), regenerate may have produced a different shape — that's still correct as long as the underlying types are right. The hand-edited shape in spec §1.4 is illustrative.

- [ ] **Step 3: TypeScript compile-check**

```bash
npx tsc --noEmit
```

Expected: many errors about `bc_payments_flag` / `is_vendor_payment` / `bcPaymentsFlag` not existing. **This is correct** — those are fixed in Phase 5.

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): regenerate database.ts for bc_claim_details schema"
```

---

## Phase 2 — Shared edge function code

### Task 5: Generic `_shared/bcClient.ts`

**Files:**

- Create: `supabase/functions/_shared/bcClient.ts`
- Create: `supabase/functions/_shared/bcClient.test.ts`

The old `bc-payment/bcPaymentsClient.ts` will be deleted in Task 9 — its responsibilities move here.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/bcClient.test.ts`:

```typescript
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bcFetch } from "./bcClient.ts";

// Helper: stub global fetch for the duration of one assertion.
function withFetch(stub: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("bcFetch — happy path returns parsed JSON", async () => {
  await withFetch(
    async (_url, _init) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    async () => {
      const result = await bcFetch("GET", "/probe");
      assertEquals(result.status, 200);
      assertEquals(result.body, { ok: true });
    },
  );
});

Deno.test("bcFetch — non-JSON body captured as raw_body", async () => {
  await withFetch(
    async () => new Response("plain error text", { status: 500 }),
    async () => {
      const result = await bcFetch("GET", "/probe");
      assertEquals(result.status, 500);
      assertEquals(result.body, { raw_body: "plain error text" });
    },
  );
});

Deno.test("bcFetch — retries once on 401 with refreshed token", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      if (calls === 1) return new Response("unauth", { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async () => {
      const result = await bcFetch("GET", "/probe");
      assertEquals(calls, 2);
      assertEquals(result.status, 200);
    },
  );
});

Deno.test("bcFetch — 30s timeout aborts the request", async () => {
  await withFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    async () => {
      await assertRejects(
        () => bcFetch("GET", "/probe", undefined, { timeoutMs: 50 }),
        DOMException,
        "aborted",
      );
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
deno test --allow-net --allow-env supabase/functions/_shared/bcClient.test.ts
```

Expected: FAIL with `Module not found "./bcClient.ts"` or similar.

- [ ] **Step 3: Implement `bcClient.ts`**

Create `supabase/functions/_shared/bcClient.ts`:

```typescript
import { getBcToken, invalidateBcToken } from "./bcAuth.ts";
import { getBcBaseUrl } from "./bcEnv.ts";

export interface BcFetchResult {
  status: number;
  body: unknown;
}

export interface BcFetchOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Generic BC HTTP wrapper used by bc-claim and bc-reference.
 * - Acquires OAuth2 client-credentials token via bcAuth (cached, 60s expiry buffer).
 * - Retries ONCE on HTTP 401 with a refreshed token.
 * - Aborts after timeoutMs (default 30s) via AbortController.
 * - On non-JSON body (any status), captures { raw_body: text } so callers never see a thrown parse error.
 */
export async function bcFetch(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: BcFetchOptions = {},
): Promise<BcFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${getBcBaseUrl()}${path}`;

  const doFetch = async (token: string): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let token = await getBcToken();
  let response = await doFetch(token);

  if (response.status === 401) {
    invalidateBcToken();
    token = await getBcToken();
    response = await doFetch(token);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    parsed = { raw_body: text };
  }

  return { status: response.status, body: parsed };
}
```

- [ ] **Step 4: Run tests**

```bash
deno test --allow-net --allow-env supabase/functions/_shared/bcClient.test.ts
```

Expected: all four tests pass. (The 401-retry test will fail if `bcAuth.ts` lacks `invalidateBcToken`; that's added in Task 6.)

If the 401-retry test fails with `invalidateBcToken is not a function`, proceed to Task 6 and come back to re-run.

- [ ] **Step 5: Commit (defer 401-retry test until Task 6)**

```bash
git add supabase/functions/_shared/bcClient.ts supabase/functions/_shared/bcClient.test.ts
git commit -m "feat(edge): _shared/bcClient generic BC HTTP wrapper (timeout, raw_body)"
```

---

### Task 6: Extend `_shared/bcAuth.ts` with `invalidateBcToken`

**Files:**

- Modify: `supabase/functions/_shared/bcAuth.ts`

- [ ] **Step 1: Read existing file to see current shape**

```bash
cat supabase/functions/_shared/bcAuth.ts
```

Note the current `getBcToken()` signature and how the token is cached (likely a module-scoped variable).

- [ ] **Step 2: Add `invalidateBcToken` export**

Append (or insert near the cache variable) the following to `bcAuth.ts`. Adapt the variable name to whatever the existing file calls the cache:

```typescript
/**
 * Force the next getBcToken() call to fetch a fresh token from Microsoft.
 * Called by bcClient on HTTP 401 (token rejected — likely expired between
 * cache fill and use).
 */
export function invalidateBcToken(): void {
  cachedToken = null;
  cachedExpiresAt = 0;
}
```

If the file already names its cache differently (e.g., `tokenCache`, `bcTokenState`), match those names. The function body just resets the cache so the next `getBcToken()` re-fetches.

- [ ] **Step 3: Rerun bcClient tests**

```bash
deno test --allow-net --allow-env supabase/functions/_shared/bcClient.test.ts
```

Expected: all four tests pass now.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/bcAuth.ts
git commit -m "feat(edge): _shared/bcAuth invalidateBcToken for 401 retry"
```

---

### Task 7: `.env.example` for BC vars

**Files:**

- Create: `supabase/functions/.env.example`

- [ ] **Step 1: Create the file**

```
# Business Central — copy this file to supabase/functions/.env and fill in real values.
# Sandbox / test-env values can be obtained from the Microsoft Entra ID app registration
# and the BC company GUID. NEVER commit a real .env to git.
BC_BASE_URL=https://api.businesscentral.dynamics.com/v2.0/<sandbox_name>/api/Alletec/Claim/v1.0
BC_TENANT_ID=00000000-0000-0000-0000-000000000000
BC_COMPANY_ID=00000000-0000-0000-0000-000000000000
BC_CLIENT_ID=00000000-0000-0000-0000-000000000000
BC_CLIENT_SECRET=replace_me
```

- [ ] **Step 2: Verify `.env` is already gitignored**

```bash
grep -E "^\.env|^supabase/functions/\.env" .gitignore
```

Expected: at least one match (most Next.js / Supabase repos already ignore `.env*`). If nothing matches, add `supabase/functions/.env` to `.gitignore` in this step.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/.env.example
git commit -m "feat(edge): .env.example template for BC integration"
```

---

## Phase 3 — `bc-reference` edge function

### Task 8: `bc-reference/index.ts` + tests (currencies, gstGroupCodes, hsnSacCodes with 15-min cache)

**Files:**

- Create: `supabase/functions/bc-reference/index.ts`
- Create: `supabase/functions/bc-reference/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/bc-reference/index.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler, __resetCacheForTest } from "./index.ts";

function makeReq(type: string): Request {
  return new Request(`http://localhost/bc-reference?type=${type}`, { method: "GET" });
}

function stubBcFetch(map: Record<string, unknown>) {
  // The handler imports bcFetch via _shared/bcClient. For tests we replace
  // the module-level function via a runtime override exported by the handler.
  (globalThis as unknown as { __bcFetchOverride?: unknown }).__bcFetchOverride = async (
    _method: string,
    path: string,
  ) => ({
    status: 200,
    body: map[path] ?? { value: [] },
  });
}

Deno.test("bc-reference — currencies mapping", async () => {
  __resetCacheForTest();
  stubBcFetch({
    "/ODataV4/Company('NxtWave')/currencies?$select=Code,Description": {
      value: [
        { Code: "INR", Description: "Indian Rupee" },
        { Code: "USD", Description: "US Dollar" },
      ],
    },
  });
  const res = await handler(makeReq("currencies"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, {
    value: [
      { code: "INR", description: "Indian Rupee" },
      { code: "USD", description: "US Dollar" },
    ],
  });
});

Deno.test("bc-reference — gstGroupCodes uses gstGroup entity path", async () => {
  __resetCacheForTest();
  let lastPath = "";
  (globalThis as unknown as { __bcFetchOverride?: unknown }).__bcFetchOverride = async (
    _m: string,
    path: string,
  ) => {
    lastPath = path;
    return { status: 200, body: { value: [{ Code: "GST18", Description: "GST 18%" }] } };
  };
  await handler(makeReq("gstGroupCodes"));
  assertEquals(lastPath, "/ODataV4/Company('NxtWave')/gstGroup?$select=Code,Description");
});

Deno.test("bc-reference — hsnSacCodes uses hsnSAC entity path", async () => {
  __resetCacheForTest();
  let lastPath = "";
  (globalThis as unknown as { __bcFetchOverride?: unknown }).__bcFetchOverride = async (
    _m: string,
    path: string,
  ) => {
    lastPath = path;
    return { status: 200, body: { value: [] } };
  };
  await handler(makeReq("hsnSacCodes"));
  assertEquals(lastPath, "/ODataV4/Company('NxtWave')/hsnSAC?$select=Code,Description");
});

Deno.test("bc-reference — unknown type returns 400", async () => {
  __resetCacheForTest();
  const res = await handler(makeReq("nope"));
  assertEquals(res.status, 400);
});

Deno.test("bc-reference — BC failure returns 502", async () => {
  __resetCacheForTest();
  (globalThis as unknown as { __bcFetchOverride?: unknown }).__bcFetchOverride = async () => ({
    status: 503,
    body: { raw_body: "BC down" },
  });
  const res = await handler(makeReq("currencies"));
  assertEquals(res.status, 502);
});

Deno.test("bc-reference — second hit within cache window returns cached body", async () => {
  __resetCacheForTest();
  let calls = 0;
  (globalThis as unknown as { __bcFetchOverride?: unknown }).__bcFetchOverride = async () => {
    calls += 1;
    return { status: 200, body: { value: [{ Code: "INR", Description: "Indian Rupee" }] } };
  };
  await handler(makeReq("currencies"));
  await handler(makeReq("currencies"));
  assertEquals(calls, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
deno test --allow-net --allow-env supabase/functions/bc-reference/index.test.ts
```

Expected: FAIL — `index.ts` does not exist.

- [ ] **Step 3: Implement `bc-reference/index.ts`**

Create `supabase/functions/bc-reference/index.ts`:

```typescript
import { bcFetch as realBcFetch, type BcFetchResult } from "../_shared/bcClient.ts";

const CACHE_TTL_MS = 15 * 60 * 1000;

const ENTITY_MAP: Record<string, string> = {
  currencies: "currencies",
  gstGroupCodes: "gstGroup",
  hsnSacCodes: "hsnSAC",
};

interface CacheEntry {
  body: unknown;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export function __resetCacheForTest(): void {
  cache.clear();
}

// Resolve bcFetch at call time so tests can override via globalThis.__bcFetchOverride.
function getBcFetch(): typeof realBcFetch {
  const override = (globalThis as unknown as { __bcFetchOverride?: typeof realBcFetch })
    .__bcFetchOverride;
  return override ?? realBcFetch;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";

  const entity = ENTITY_MAP[type];
  if (!entity) {
    return json(400, { error: "UNKNOWN_TYPE", type });
  }

  const cached = cache.get(type);
  if (cached && cached.expiresAt > Date.now()) {
    return json(200, cached.body);
  }

  const path = `/ODataV4/Company('NxtWave')/${entity}?$select=Code,Description`;
  let result: BcFetchResult;
  try {
    result = await getBcFetch()("GET", path);
  } catch (err) {
    return json(502, { error: "BC_REFERENCE_FETCH_FAILED", type, detail: String(err) });
  }

  if (result.status < 200 || result.status >= 300) {
    return json(502, { error: "BC_REFERENCE_FETCH_FAILED", type, detail: result.body });
  }

  const data = result.body as { value?: Array<{ Code?: string; Description?: string }> };
  const mapped = {
    value: (data.value ?? []).map((r) => ({
      code: r.Code ?? "",
      description: r.Description ?? "",
    })),
  };

  cache.set(type, { body: mapped, expiresAt: Date.now() + CACHE_TTL_MS });
  return json(200, mapped);
}

// Deno deploy entry point.
if (import.meta.main) {
  Deno.serve(handler);
}
```

- [ ] **Step 4: Run tests**

```bash
deno test --allow-net --allow-env supabase/functions/bc-reference/index.test.ts
```

Expected: all six tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bc-reference/
git commit -m "feat(edge): bc-reference for currencies/GST/HSN dropdowns with 15min cache"
```

---

## Phase 4 — `bc-claim` edge function (rename + rewrite)

### Task 9: Rename `bc-payment` → `bc-claim`, delete `bcPaymentsClient.ts`

**Files:**

- Rename: `supabase/functions/bc-payment/` → `supabase/functions/bc-claim/`
- Delete: `supabase/functions/bc-claim/bcPaymentsClient.ts` (functionality moved to `_shared/bcClient.ts` in Task 5)

- [ ] **Step 1: Rename the directory using git mv (preserves history)**

```bash
git mv supabase/functions/bc-payment supabase/functions/bc-claim
```

- [ ] **Step 2: Delete the obsolete client file**

```bash
git rm supabase/functions/bc-claim/bcPaymentsClient.ts
```

- [ ] **Step 3: Verify the structure**

```bash
ls supabase/functions/bc-claim/
```

Expected: `index.ts`, `types.ts`, `payloadBuilder.ts`, `payloadBuilder.test.ts`. NO `bcPaymentsClient.ts`. NO `bc-payment/` directory anywhere.

- [ ] **Step 4: Commit the structural change (file contents will be rewritten in Tasks 10–12)**

```bash
git commit -m "refactor(edge): rename bc-payment → bc-claim; remove bcPaymentsClient (moved to _shared)"
```

---

### Task 10: Rewrite `bc-claim/types.ts` — drop `BcBalAccountType` + `BcAccountType`, add new constants + `BcClaimLineItem` interface

**Files:**

- Modify: `supabase/functions/bc-claim/types.ts`

- [ ] **Step 1: Overwrite the file**

Replace the entire contents of `supabase/functions/bc-claim/types.ts` with:

```typescript
// Fixed-value constants for the BC payload — exported so tests can assert against them.
export const BcDocumentType = { Invoice: "Invoice" } as const;
export const BcType = { GLAccount: "G/l" } as const;
export const BcGstCredit = { NonAvailment: "Non-Availment" } as const;
export const BcGstSubcategory = { Ineligible4344: "Ineligible-43/44" } as const;
export const BcEmployeeTransactionType = { Advance: "Advance" } as const;
export const BcQuantity = 1 as const;
export const BcLocationCode = "HBT" as const;

// Reference type — mirrored constant for frontend.
export const BcReferenceType = {
  Currencies: "currencies",
  GstGroupCodes: "gstGroupCodes",
  HsnSacCodes: "hsnSacCodes",
} as const;
export type BcReferenceType = (typeof BcReferenceType)[keyof typeof BcReferenceType];

// Flat payload posted to BC Custom Claims API (one object per claim).
// Vendor-only fields are spread-omitted for non-vendor claims, never null/empty.
export interface BcClaimLineItem {
  documentType: "Invoice";
  locationCode: "HBT";
  type: "G/l";
  quantity: 1;
  gstCredit: "Non-Availment";
  gstSubcategory: "Ineligible-43/44";
  employeeTransactionType: "Advance";
  documentDate: string;
  glCode: string;
  employeeId: string;
  employeeName: string;
  claimNo: string;
  remarks: string;
  programCode: string;
  subproductCode: string;
  responsibleDepartment: string;
  beneficiaryDepartment: string;
  regionCode: string;
  invoiceRequired: boolean;
  paymentRequired: boolean;
  // Vendor-only.
  currencyCode?: string;
  vendorInvoiceNo?: string;
  vendorCode?: string;
  vendorName?: string;
  gstGroupCode?: string;
  hsnSacCode?: string;
}

// Output of get_bc_claim_payload DB function (matches spec §3.3).
export interface BcClaimPayloadFromDb {
  claim_id: string;
  payment_mode_name: string;
  submission_type: "Self" | "On_behalf";
  employee_id: string;
  on_behalf_employee_code: string | null;
  employee_name: string;
  program_code: string;
  sub_product_code: string;
  responsible_department_code: string;
  beneficiary_department_code: string;
  region_code: string;
  bill_no: string | null;
  transaction_date: string;
  purpose: string;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
  bc_code: string;
}

// Request body from the modal to the bc-claim edge function.
export interface BcClaimRequestBody {
  claimId: string;
  isVendorPayment: boolean;
  // Vendor-only — required iff isVendorPayment === true.
  bcVendorCode?: string;
  bcVendorName?: string;
  currencyCode?: string;
  gstGroupCode?: string;
  hsnSacCode?: string;
}
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/bc-claim/types.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/bc-claim/types.ts
git commit -m "feat(edge): bc-claim types — drop BcBalAccountType+BcAccountType, add BcClaimLineItem"
```

---

### Task 11: Rewrite `bc-claim/payloadBuilder.ts` + tests

**Files:**

- Modify: `supabase/functions/bc-claim/payloadBuilder.ts`
- Modify: `supabase/functions/bc-claim/payloadBuilder.test.ts`

- [ ] **Step 1: Rewrite the test file (old assertions for `balAccountType` are obsolete)**

Replace the entire contents of `supabase/functions/bc-claim/payloadBuilder.test.ts`:

```typescript
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBcClaimLineItem, buildRemarks, type BuildInputs } from "./payloadBuilder.ts";
import type { BcClaimPayloadFromDb } from "./types.ts";

const baseDb: BcClaimPayloadFromDb = {
  claim_id: "CLM-000145",
  payment_mode_name: "Reimbursement",
  submission_type: "Self",
  employee_id: "NW0001234",
  on_behalf_employee_code: null,
  employee_name: "Arjun Chander",
  program_code: "COMMON",
  sub_product_code: "COMMON",
  responsible_department_code: "GENAI",
  beneficiary_department_code: "GENAI",
  region_code: "TELUGU",
  bill_no: "INV-2026-001",
  transaction_date: "2026-05-10",
  purpose: "Software subscription",
  receipt_file_path: "https://xyz.supabase.co/storage/v1/object/public/receipts/inv.pdf",
  bank_statement_file_path: null,
  bc_code: "503063",
};

const vendorInputs: BuildInputs = {
  db: baseDb,
  isVendorPayment: true,
  vendor: {
    code: "V0001",
    name: "Twilio Inc",
    currencyCode: "INR",
    gstGroupCode: "GST18",
    hsnSacCode: "998314",
  },
};

const nonVendorInputs: BuildInputs = {
  db: baseDb,
  isVendorPayment: false,
};

Deno.test("vendor payload has all 26 fields with vendor-only keys present", () => {
  const line = buildBcClaimLineItem(vendorInputs);
  assertEquals(line.documentType, "Invoice");
  assertEquals(line.locationCode, "HBT");
  assertEquals(line.type, "G/l");
  assertEquals(line.quantity, 1);
  assertEquals(line.gstCredit, "Non-Availment");
  assertEquals(line.gstSubcategory, "Ineligible-43/44");
  assertEquals(line.employeeTransactionType, "Advance");
  assertEquals(line.documentDate, "2026-05-10");
  assertEquals(line.glCode, "503063");
  assertEquals(line.employeeId, "NW0001234");
  assertEquals(line.employeeName, "Arjun Chander");
  assertEquals(line.claimNo, "CLM-000145");
  assertEquals(line.programCode, "COMMON");
  assertEquals(line.subproductCode, "COMMON");
  assertEquals(line.responsibleDepartment, "GENAI");
  assertEquals(line.beneficiaryDepartment, "GENAI");
  assertEquals(line.regionCode, "TELUGU");
  assertEquals(line.invoiceRequired, true);
  assertEquals(line.paymentRequired, true);
  assertEquals(line.currencyCode, "INR");
  assertEquals(line.vendorInvoiceNo, "INV-2026-001");
  assertEquals(line.vendorCode, "V0001");
  assertEquals(line.vendorName, "Twilio Inc");
  assertEquals(line.gstGroupCode, "GST18");
  assertEquals(line.hsnSacCode, "998314");
  assertEquals(Object.keys(line).length, 26);
});

Deno.test("non-vendor payload omits vendor-only keys entirely", () => {
  const line = buildBcClaimLineItem(nonVendorInputs);
  for (const key of [
    "currencyCode",
    "vendorInvoiceNo",
    "vendorCode",
    "vendorName",
    "gstGroupCode",
    "hsnSacCode",
  ] as const) {
    assert(!(key in line), `${key} should be absent`);
  }
  assertEquals(line.invoiceRequired, false);
  assertEquals(line.paymentRequired, true);
  assertEquals(Object.keys(line).length, 20);
});

Deno.test("On_behalf submission uses on_behalf_employee_code for employeeId", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      submission_type: "On_behalf",
      employee_id: "NW0001234",
      on_behalf_employee_code: "NW0009999",
      employee_name: "Ravi Kumar",
    },
    isVendorPayment: false,
  });
  assertEquals(line.employeeId, "NW0009999");
  assertEquals(line.employeeName, "Ravi Kumar");
});

Deno.test("paymentRequired is false when payment mode is not Reimbursement", () => {
  const line = buildBcClaimLineItem({
    db: { ...baseDb, payment_mode_name: "Vendor Direct" },
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
  });
  assertEquals(line.paymentRequired, false);
});

Deno.test("buildRemarks — claim+purpose+bill+statement when both files present", () => {
  const r = buildRemarks({
    ...baseDb,
    receipt_file_path: "https://x.co/r.pdf",
    bank_statement_file_path: "https://x.co/s.pdf",
  });
  assertEquals(
    r,
    "CLM-000145 - Software subscription\nbill - https://x.co/r.pdf\nbank statement - https://x.co/s.pdf",
  );
});

Deno.test("buildRemarks — omits bill line when receipt_file_path is null/empty", () => {
  const r = buildRemarks({ ...baseDb, receipt_file_path: null, bank_statement_file_path: null });
  assertEquals(r, "CLM-000145 - Software subscription");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
deno test --allow-net --allow-env supabase/functions/bc-claim/payloadBuilder.test.ts
```

Expected: FAIL — `buildBcClaimLineItem` and `buildRemarks` are not yet exported in the new shape.

- [ ] **Step 3: Rewrite `payloadBuilder.ts`**

Replace the entire contents of `supabase/functions/bc-claim/payloadBuilder.ts`:

```typescript
import type { BcClaimLineItem, BcClaimPayloadFromDb } from "./types.ts";

export interface BuildInputs {
  db: BcClaimPayloadFromDb;
  isVendorPayment: boolean;
  vendor?: {
    code: string;
    name: string;
    currencyCode: string;
    gstGroupCode: string;
    hsnSacCode: string;
  };
}

/**
 * Builds the `remarks` string per spec §3.2:
 *   "{claimId} - {purpose}"
 *   "bill - {url}"            (only if receipt_file_path non-empty)
 *   "bank statement - {url}"  (only if bank_statement_file_path non-empty)
 */
export function buildRemarks(db: BcClaimPayloadFromDb): string {
  const lines = [`${db.claim_id} - ${db.purpose}`];
  if (db.receipt_file_path && db.receipt_file_path.length > 0) {
    lines.push(`bill - ${db.receipt_file_path}`);
  }
  if (db.bank_statement_file_path && db.bank_statement_file_path.length > 0) {
    lines.push(`bank statement - ${db.bank_statement_file_path}`);
  }
  return lines.join("\n");
}

/**
 * Builds the single flat BcClaimLineItem object posted to BC.
 * Vendor-only fields are spread-omitted (not null) when isVendorPayment is false.
 */
export function buildBcClaimLineItem(inputs: BuildInputs): BcClaimLineItem {
  const { db, isVendorPayment, vendor } = inputs;

  const employeeId =
    db.submission_type === "On_behalf" && db.on_behalf_employee_code
      ? db.on_behalf_employee_code
      : db.employee_id;

  const employeeName = db.employee_name;

  const base = {
    documentType: "Invoice" as const,
    locationCode: "HBT" as const,
    type: "G/l" as const,
    quantity: 1 as const,
    gstCredit: "Non-Availment" as const,
    gstSubcategory: "Ineligible-43/44" as const,
    employeeTransactionType: "Advance" as const,
    documentDate: db.transaction_date,
    glCode: db.bc_code,
    employeeId,
    employeeName,
    claimNo: db.claim_id,
    remarks: buildRemarks(db),
    programCode: db.program_code,
    subproductCode: db.sub_product_code,
    responsibleDepartment: db.responsible_department_code,
    beneficiaryDepartment: db.beneficiary_department_code,
    regionCode: db.region_code,
    invoiceRequired: isVendorPayment,
    paymentRequired: db.payment_mode_name === "Reimbursement",
  };

  if (!isVendorPayment) {
    return base;
  }

  if (!vendor) {
    throw new Error("vendor inputs required when isVendorPayment is true");
  }

  return {
    ...base,
    currencyCode: vendor.currencyCode,
    vendorInvoiceNo: db.bill_no ?? "",
    vendorCode: vendor.code,
    vendorName: vendor.name,
    gstGroupCode: vendor.gstGroupCode,
    hsnSacCode: vendor.hsnSacCode,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
deno test --allow-net --allow-env supabase/functions/bc-claim/payloadBuilder.test.ts
```

Expected: all six tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bc-claim/payloadBuilder.ts supabase/functions/bc-claim/payloadBuilder.test.ts
git commit -m "feat(edge): bc-claim payloadBuilder for 26-field flat payload"
```

---

### Task 12: Rewrite `bc-claim/index.ts` — JWT actor, three-phase lifecycle, error mapping

**Files:**

- Modify: `supabase/functions/bc-claim/index.ts`

- [ ] **Step 1: Overwrite the file**

Replace the entire contents of `supabase/functions/bc-claim/index.ts`:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bcFetch } from "../_shared/bcClient.ts";
import { getBcCompanyId } from "../_shared/bcEnv.ts";
import { buildBcClaimLineItem } from "./payloadBuilder.ts";
import type { BcClaimPayloadFromDb, BcClaimRequestBody } from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validateBody(
  raw: unknown,
): { ok: true; body: BcClaimRequestBody } | { ok: false; details: string[] } {
  const errs: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, details: ["body must be an object"] };
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.claimId !== "string" || b.claimId.length === 0) errs.push("claimId required");
  if (typeof b.isVendorPayment !== "boolean") errs.push("isVendorPayment required (boolean)");
  if (b.isVendorPayment === true) {
    for (const k of [
      "bcVendorCode",
      "bcVendorName",
      "currencyCode",
      "gstGroupCode",
      "hsnSacCode",
    ]) {
      if (typeof b[k] !== "string" || (b[k] as string).length === 0)
        errs.push(`${k} required for vendor payment`);
    }
  }
  if (errs.length > 0) return { ok: false, details: errs };
  return { ok: true, body: b as unknown as BcClaimRequestBody };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  // Step 1: actor from JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwtClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await jwtClient.auth.getUser();
  if (userErr || !user) return json(401, { error: "UNAUTHENTICATED" });
  const actorUserId = user.id;

  // Step 2: body validation.
  const raw = await req.json().catch(() => null);
  const v = validateBody(raw);
  if (!v.ok) return json(400, { error: "INVALID_BODY", details: v.details });
  const body = v.body;

  // Service-role client for SECURITY DEFINER RPCs.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Step 3: fetch payload from DB.
  const payloadRes = await admin.rpc("get_bc_claim_payload", { p_claim_id: body.claimId });
  if (payloadRes.error) {
    const code = payloadRes.error.code;
    const msg = payloadRes.error.message ?? "";
    if (code === "P0001") return json(404, { error: "CLAIM_NOT_FOUND", claimId: body.claimId });
    if (code === "P0002") {
      const m = msg.match(/ALREADY_SUBMITTED: (.+)$/);
      return json(409, { error: "ALREADY_SUBMITTED", bcClaimDetailsId: m?.[1] ?? null });
    }
    if (code === "P0003") return json(422, { error: "MISSING_MAPPING", detail: msg });
    return json(500, { error: "DB_ERROR", detail: msg });
  }
  const db = payloadRes.data as BcClaimPayloadFromDb;

  // Step 4: build payload.
  const linePayload = buildBcClaimLineItem({
    db,
    isVendorPayment: body.isVendorPayment,
    vendor: body.isVendorPayment
      ? {
          code: body.bcVendorCode!,
          name: body.bcVendorName!,
          currencyCode: body.currencyCode!,
          gstGroupCode: body.gstGroupCode!,
          hsnSacCode: body.hsnSacCode!,
        }
      : undefined,
  });

  // Step 5: claim the in-flight slot. Concurrency guard.
  const startRes = await admin.rpc("start_bc_claim_attempt", {
    p_claim_id: body.claimId,
    p_is_vendor_payment: body.isVendorPayment,
    p_payload_json: linePayload,
  });
  if (startRes.error) {
    if (startRes.error.code === "23505") {
      return json(409, { error: "ALREADY_IN_FLIGHT" });
    }
    return json(500, { error: "START_FAILED", detail: startRes.error.message });
  }
  const bcDetailsId = startRes.data as string;

  // Step 6: POST to BC.
  let bcResult;
  try {
    bcResult = await bcFetch("POST", `/companies(${getBcCompanyId()})/Claims`, linePayload);
  } catch (err) {
    await admin.rpc("record_bc_claim_failure", {
      p_bc_details_id: bcDetailsId,
      p_actor_user_id: actorUserId,
      p_response_json: { error: "network_or_timeout", detail: String(err) },
    });
    return json(502, {
      success: false,
      error: { type: "network_or_timeout", detail: String(err) },
    });
  }

  if (bcResult.status < 200 || bcResult.status >= 300) {
    await admin.rpc("record_bc_claim_failure", {
      p_bc_details_id: bcDetailsId,
      p_actor_user_id: actorUserId,
      p_response_json: bcResult.body,
    });
    return json(502, { success: false, error: bcResult.body });
  }

  // Step 7a: success — flip 'submitting' → 'success'.
  const completeRes = await admin.rpc("complete_bc_claim", {
    p_bc_details_id: bcDetailsId,
    p_actor_user_id: actorUserId,
    p_response_json: bcResult.body,
  });
  if (completeRes.error) {
    // CATASTROPHIC: BC accepted but our RPC failed. Row remains 'submitting' for reconciliation.
    return json(500, {
      success: false,
      error: "RPC_FAILED_AFTER_BC_SUCCESS",
      bcClaimDetailsId: bcDetailsId,
      detail: completeRes.error.message,
    });
  }

  return json(200, { success: true, bcClaimDetailsId: bcDetailsId });
}

if (import.meta.main) {
  Deno.serve(handler);
}
```

- [ ] **Step 2: Type-check**

```bash
deno check supabase/functions/bc-claim/index.ts
```

Expected: no errors. If `getBcCompanyId` doesn't exist in `bcEnv.ts`, add it as a simple `export function getBcCompanyId(): string { return Deno.env.get("BC_COMPANY_ID") ?? ""; }` in `bcEnv.ts` and re-run.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/bc-claim/index.ts
git commit -m "feat(edge): bc-claim three-phase lifecycle (start→POST→complete/fail)"
```

---

## Phase 5 — Domain layer + repository cascade

### Task 13: `contracts.ts` rename + `isBcSubmitted` helper

**Files:**

- Modify: `src/core/domain/claims/contracts.ts` (7 occurrences of `bcPaymentsFlag`)
- Create: `src/core/domain/claims/utils.ts`

- [ ] **Step 1: Replace all 7 `bcPaymentsFlag: boolean` occurrences in contracts.ts**

In `src/core/domain/claims/contracts.ts`, replace each occurrence of:

```typescript
bcPaymentsFlag: boolean;
```

with:

```typescript
bcClaimDetailsId: string | null;
```

Use your editor's project-wide find/replace IN THIS FILE ONLY — there are 7 of them (per spec §1.3 cascade list: lines 275, 294, 358, 402, 448, 466, 652 at spec-write time; re-grep if drifted).

- [ ] **Step 2: Create the helper**

Create `src/core/domain/claims/utils.ts`:

```typescript
export function isBcSubmitted(claim: { bcClaimDetailsId: string | null }): boolean {
  return claim.bcClaimDetailsId !== null;
}
```

- [ ] **Step 3: Verify contracts compile**

```bash
npx tsc --noEmit src/core/domain/claims/contracts.ts src/core/domain/claims/utils.ts
```

Expected: clean (assuming no upstream callers in this command's scope).

- [ ] **Step 4: Commit**

```bash
git add src/core/domain/claims/contracts.ts src/core/domain/claims/utils.ts
git commit -m "refactor(domain): bcPaymentsFlag → bcClaimDetailsId + isBcSubmitted helper"
```

---

### Task 14: `SupabaseClaimRepository.ts` cascade

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts`

This file has ~25 references to update. Per spec §1.3 cascade, grouped into four kinds — apply each globally within this file.

- [ ] **Step 1: Replace inline row-type definitions**

Find every `bc_payments_flag?: boolean` or `bc_payments_flag: boolean` declaration in row-type interfaces. Replace with `bc_claim_details_id: string | null`. (Per spec: lines 99, 242, 368, 1741, 3094, 3230, 3342, 3475, 4054 at spec-write time.)

```bash
# Inspect first to confirm count, then run sed:
grep -c "bc_payments_flag" src/modules/claims/repositories/SupabaseClaimRepository.ts
```

Use IDE find-and-replace within this file:

- Find: `bc_payments_flag?: boolean` → Replace: `bc_claim_details_id: string | null`
- Find: `bc_payments_flag: boolean` → Replace: `bc_claim_details_id: string | null`

- [ ] **Step 2: Replace SELECT-string column references**

Find every Supabase `.select("..., bc_payments_flag, ...")` string. Replace `bc_payments_flag` with `bc_claim_details_id` inside those strings.

In your editor, search this file for `bc_payments_flag` and update each remaining occurrence (those inside string literals).

- [ ] **Step 3: Replace row-to-domain mappings**

Find every:

```typescript
bcPaymentsFlag: row.bc_payments_flag ?? false,
bcPaymentsFlag: row.bc_payments_flag,
```

Replace with:

```typescript
bcClaimDetailsId: row.bc_claim_details_id ?? null,
```

- [ ] **Step 4: Verify zero matches remain in this file**

```bash
grep -n "bc_payments_flag\|bcPaymentsFlag" src/modules/claims/repositories/SupabaseClaimRepository.ts
```

Expected: no output.

- [ ] **Step 5: Compile-check the file**

```bash
npx tsc --noEmit
```

Expected: errors REMAIN — they'll be in other files (`SupabaseDepartmentViewerRepository.ts`, UI, tests). That's fine. We address them in Tasks 15–18.

- [ ] **Step 6: Commit**

```bash
git add src/modules/claims/repositories/SupabaseClaimRepository.ts
git commit -m "refactor(repo): SupabaseClaimRepository — bc_payments_flag → bc_claim_details_id cascade"
```

---

### Task 15: `SupabaseDepartmentViewerRepository.ts` cascade

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts`

Per spec §1.3 cascade: row-type at line 40, SELECT string at line 153, mapping at line 266.

- [ ] **Step 1: Replace all three**

In this file:

- Line 40-ish row-type: `bc_payments_flag: boolean | null;` → `bc_claim_details_id: string | null;`
- Line 153-ish SELECT: replace `bc_payments_flag` in the select() string with `bc_claim_details_id`
- Line 266-ish mapping: `bcPaymentsFlag: row.bc_payments_flag ?? false,` → `bcClaimDetailsId: row.bc_claim_details_id ?? null,`

- [ ] **Step 2: Verify zero matches remain**

```bash
grep -n "bc_payments_flag\|bcPaymentsFlag" src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts
git commit -m "refactor(repo): SupabaseDepartmentViewerRepository — bc_payments_flag → bc_claim_details_id"
```

---

## Phase 6 — Frontend

### Task 16: Rename + rewrite `bc-claim-modal.tsx`

**Files:**

- Rename: `src/modules/claims/ui/bc-payment-modal.tsx` → `bc-claim-modal.tsx`
- Rewrite: contents (new request body shape, zod schema, three vendor-only dropdowns, retry UI)

- [ ] **Step 1: Rename the file**

```bash
git mv src/modules/claims/ui/bc-payment-modal.tsx src/modules/claims/ui/bc-claim-modal.tsx
```

- [ ] **Step 2: Read the existing modal for context**

```bash
cat src/modules/claims/ui/bc-claim-modal.tsx
```

Note: existing imports of shadcn `Dialog`, `Sonner` toast, `useDebouncedValue`. Preserve these.

- [ ] **Step 3: Rewrite contents — use `superpowers:frontend-design` skill at this point**

This rewrite is substantial UI work (loading/error/retry states for 3 async dropdowns, zod schema, vendor toggle, lifecycle handling for the catastrophic-500 path). Invoke the `superpowers:frontend-design` skill with the brief from spec §9 (Frontend handoff).

Key contract the design must honor:

- Component is named `BcClaimModal`.
- Form schema validates with zod (per spec §4.1a snippet).
- On Submit, calls `supabase.functions.invoke("bc-claim", { body: { claimId, isVendorPayment, ...(vendor ? { bcVendorCode, bcVendorName, currencyCode, gstGroupCode, hsnSacCode } : {}) } })`.
- Loading state per dropdown; per-dropdown "Retry" button on fetch failure.
- Three response classes: `200 success` → close + success toast; `409 ALREADY_SUBMITTED` / `ALREADY_IN_FLIGHT` → error toast + close; `500 RPC_FAILED_AFTER_BC_SUCCESS` → persistent banner "BC accepted submission but local sync failed. Do not retry. Contact admin." with Close button only.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit src/modules/claims/ui/bc-claim-modal.tsx
```

Expected: clean (or only errors in callers we haven't updated yet — those are addressed in Task 17).

- [ ] **Step 5: Commit**

```bash
git add src/modules/claims/ui/bc-claim-modal.tsx
git commit -m "feat(ui): BcClaimModal — vendor dropdowns, zod validation, lifecycle states"
```

---

### Task 17: Update `claim-decision-action-form.tsx` to import `BcClaimModal`

**Files:**

- Modify: `src/modules/claims/ui/claim-decision-action-form.tsx`

- [ ] **Step 1: Replace import and component name**

In `src/modules/claims/ui/claim-decision-action-form.tsx`:

- Find: `import { BcPaymentModal } from "./bc-payment-modal";`
  Replace: `import { BcClaimModal } from "./bc-claim-modal";`
- Find: `<BcPaymentModal`
  Replace: `<BcClaimModal`
- Find: `</BcPaymentModal>` (if used)
  Replace: `</BcClaimModal>`

If the modal's render condition includes `claim.bcPaymentsFlag`, replace with `claim.bcClaimDetailsId !== null` for the inverse (button DISABLED) check. Most likely the modal renders unconditionally and the Approve button uses the flag — adjust as needed.

- [ ] **Step 2: Verify zero stale refs**

```bash
grep -n "BcPaymentModal\|bc-payment-modal\|bcPaymentsFlag" src/modules/claims/ui/claim-decision-action-form.tsx
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/modules/claims/ui/claim-decision-action-form.tsx
git commit -m "refactor(ui): claim-decision-action-form import BcClaimModal"
```

---

## Phase 7 — Test fixture updates + new integration suite

### Task 18: Update 5 unit-test fixture files

**Files (per spec §1.3 cascade — Test fixtures):**

- Modify: `tests/unit/claims/supabase-claim-repository.test.ts`
- Modify: `tests/unit/claims/supabase-department-viewer-repository.test.ts`
- Modify: `tests/unit/claims/get-department-view-claims.service.test.ts`
- Modify: `tests/unit/claims/get-my-claims.service.test.ts`
- Modify: `tests/unit/claims/export-claims.service.test.ts`

- [ ] **Step 1: Bulk-replace in all five files**

```bash
sed -i '' 's/bcPaymentsFlag: false/bcClaimDetailsId: null/g' \
  tests/unit/claims/supabase-claim-repository.test.ts \
  tests/unit/claims/supabase-department-viewer-repository.test.ts \
  tests/unit/claims/get-department-view-claims.service.test.ts \
  tests/unit/claims/get-my-claims.service.test.ts \
  tests/unit/claims/export-claims.service.test.ts
```

(macOS BSD sed requires the empty `''` argument; on Linux drop it.)

- [ ] **Step 2: Verify zero stale references**

```bash
grep -n "bcPaymentsFlag" tests/unit/claims/
```

Expected: no output.

- [ ] **Step 3: Run unit tests**

```bash
npx jest tests/unit/claims
```

Expected: all tests pass. Any failures are likely in mock row data that also referenced `bc_payments_flag` — update those occurrences inline.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/claims/
git commit -m "test(unit): update fixtures to bcClaimDetailsId: null"
```

---

### Task 19: New Jest integration suite for `bc-claim`

**Files:**

- Create: `tests/integration/bc-claim/lifecycle.test.ts`
- Create: `tests/integration/bc-claim/race.test.ts`

These are Jest tests that hit a local Supabase + mock BC. Spec §8 lists the scenarios.

- [ ] **Step 1: Lifecycle test (happy + 409 + race + catastrophic)**

Create `tests/integration/bc-claim/lifecycle.test.ts`. Cover:

- Happy path: invoke → assert `bc_claim_details.bc_status = 'success'`, `claims.bc_claim_details_id` set, `claim_audit_logs` row with `action_type = 'BC_SUBMITTED'`.
- ALREADY_SUBMITTED: pre-set `claims.bc_claim_details_id`, invoke → assert 409, no BC mock hit.
- ALREADY_IN_FLIGHT: pre-insert `'submitting'` row, invoke → assert 409.
- MISSING_MAPPING: delete a mapping row, invoke → assert 422.
- BC 4xx: BC mock returns 400, invoke → assert 502, `bc_status = 'failed'`, audit log `BC_SUBMISSION_FAILED`.

Use the same Jest setup as `tests/unit/claims/*` and the existing Supabase test client helper (whichever pattern the repo uses — check `jest.setup.js`).

- [ ] **Step 2: Race test**

Create `tests/integration/bc-claim/race.test.ts`. Fire 5 concurrent `Promise.all` invocations against the same `claimId` → assert exactly one returns 200 success, four return 409 `ALREADY_IN_FLIGHT`.

- [ ] **Step 3: Run the suite**

```bash
npx jest tests/integration/bc-claim
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/bc-claim/
git commit -m "test(integration): bc-claim lifecycle + race coverage"
```

---

## Phase 8 — Hygiene

### Task 20: Move Postman collections; add environment file

**Files:**

- Move: 4 Postman collections from repo root → `docs/api/postman/`
- Create: `docs/api/postman/bc-sandbox.postman_environment.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create the directory and move collections**

```bash
mkdir -p docs/api/postman
git mv NxtClaim.postman_collection.json docs/api/postman/ 2>/dev/null || mv NxtClaim.postman_collection.json docs/api/postman/
git mv NxtClaimCurrency.postman_collection.json docs/api/postman/ 2>/dev/null || mv NxtClaimCurrency.postman_collection.json docs/api/postman/
git mv NxtClaimGSTGroupCodes.postman_collection.json docs/api/postman/ 2>/dev/null || mv NxtClaimGSTGroupCodes.postman_collection.json docs/api/postman/
git mv NxtClaimHSNSACCodes.postman_collection.json docs/api/postman/ 2>/dev/null || mv NxtClaimHSNSACCodes.postman_collection.json docs/api/postman/
```

(The collections may currently be untracked; the `|| mv` fallback covers that.)

- [ ] **Step 2: Replace hardcoded URLs / tokens with variables in each collection**

For each `*.postman_collection.json`, replace:

- The literal BC base URL host segment with `{{baseUrl}}`
- The tenant GUID with `{{tenantId}}`
- The company GUID with `{{companyId}}`
- The bearer token value with `{{bearerToken}}`

You can do this with `sed` or by hand in your editor. Example for one file:

```bash
sed -i '' "s|api.businesscentral.dynamics.com/v2.0/[^/]*|{{baseUrl}}|g" docs/api/postman/NxtClaim.postman_collection.json
```

- [ ] **Step 3: Create the environment file**

Create `docs/api/postman/bc-sandbox.postman_environment.json`:

```json
{
  "id": "bc-sandbox-env",
  "name": "BC Sandbox",
  "values": [
    {
      "key": "baseUrl",
      "value": "api.businesscentral.dynamics.com/v2.0/Sandbox_05052026",
      "enabled": true
    },
    { "key": "tenantId", "value": "6ae3d026-e965-483e-8309-8f8f3aca71c8", "enabled": true },
    { "key": "companyId", "value": "2a9bf2ba-5cfe-ef11-9346-6045bdac6fc7", "enabled": true },
    { "key": "bearerToken", "value": "", "enabled": true, "type": "secret" }
  ],
  "_postman_variable_scope": "environment"
}
```

- [ ] **Step 4: Update .gitignore**

Append to `.gitignore`:

```
# Postman local environments may contain bearer tokens — keep templates in git only.
docs/api/postman/*.postman_environment.local.json
```

(The committed `bc-sandbox.postman_environment.json` has a blank token; local overrides with real tokens use the `.local.` suffix and are ignored.)

- [ ] **Step 5: Commit**

```bash
git add docs/api/postman/ .gitignore
git commit -m "chore(docs): move Postman collections to docs/api/postman with env template"
```

---

## Phase 9 — Final verification

### Task 21: Full system verification

- [ ] **Step 1: TypeScript clean**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: All Jest tests pass**

```bash
npx jest
```

Expected: all suites pass.

- [ ] **Step 3: All Deno edge function tests pass**

```bash
deno test --allow-net --allow-env supabase/functions/
```

Expected: all suites pass.

- [ ] **Step 4: DB views resolve correctly**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT bc_claim_details_id, is_vendor_payment FROM public.vw_admin_claims_dashboard LIMIT 1;"
psql "$SUPABASE_DB_URL" -c "SELECT bc_claim_details_id, is_vendor_payment FROM public.vw_enterprise_claims_dashboard LIMIT 1;"
```

Expected: no errors.

- [ ] **Step 5: Final cleanup grep — zero hits expected**

```bash
grep -rn "bc_payments_flag\|bcPaymentsFlag\|BcBalAccountType\|BcAccountType\|bc_bal_account_type\|bcPaymentsClient\|BcPaymentModal\|bc-payment-modal\|bc_payment_audit\|bc_claim_vendors" src/ supabase/functions/ tests/
```

Expected: **no output** (zero hits).

If any hit appears, fix it and re-run the grep before moving on.

- [ ] **Step 6: Manual smoke test via the live UI**

Run the dev server. Approve a claim end-to-end through the BC Claim Modal — vendor flow AND non-vendor flow. Verify:

- Three vendor dropdowns load from `bc-reference`.
- Submit on vendor flow sends a 26-field payload (inspect Network tab → Supabase function invoke → BC POST in edge function logs).
- Submit on non-vendor flow sends a 20-field payload with zero `currencyCode` / `vendor*` / `gstGroupCode` / `hsnSacCode` keys.
- After success, `bc_claim_details` row exists with `bc_status='success'`, `claims.bc_claim_details_id` is set, `claim_audit_logs` has a `BC_SUBMITTED` entry.

- [ ] **Step 7: Commit only if verification revealed fixes**

If any of the above steps required fixes, commit them as a final verification pass:

```bash
git add -A
git commit -m "fix: address final-verification gaps"
```

If everything was clean from the start, no commit is needed.

---

## Self-review checklist (run before marking plan complete)

- [ ] Every spec section §1–§10 has at least one task implementing it.
- [ ] All file paths in tasks are absolute or repo-relative — no placeholders.
- [ ] Every code block compiles in isolation against the symbols defined earlier in the plan.
- [ ] Final grep returns zero hits across the union of old artifact names.
- [ ] No task assumes prior knowledge that isn't either in the spec or in an earlier task.

---

## Notes for the executing engineer

- This is a **test-env-only** rollout. No data preservation steps. If a migration fails mid-way, `supabase db reset` and re-run.
- The three migrations MUST apply in order (`090000` → `090100` → `090200`). Postgres-style timestamps in filenames preserve this.
- The `submitting` enum value is the single piece of design subtlety in the data model — review spec §1.1 "Design decisions" and §1.2 "Why the 'submitting' row solves both race AND outbox problems" before touching that schema.
- Frontend modal rewrite (Task 16) benefits from invoking `superpowers:frontend-design` — that's not a stylistic preference, it's how the loading/error/retry states get designed correctly.
- The catastrophic 500 path (`RPC_FAILED_AFTER_BC_SUCCESS`) is a real, possible state. The frontend MUST NOT retry on this. The reconciliation tool / cron is out of scope for this plan but documented in spec §1.2.
