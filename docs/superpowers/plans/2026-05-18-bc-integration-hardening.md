# BC Integration Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 11 hardening fixes from `docs/superpowers/specs/2026-05-18-bc-integration-hardening-design.md` so the BC integration is production-grade — debuggable, secure, reliable, clean.

**Architecture:** Three edge functions (`bc-claim`, `bc-reference`, `bc-vendor-search`) on Supabase, plus a Next.js React modal. Shared helpers in `supabase/functions/_shared/`. Hardening builds on the shared layer — adds one new module (`logger`), one new module (`auth`), tightens one function (`bc-vendor-search`), and polishes one UI surface (claim modal).

**Tech Stack:** Deno (edge functions, Zod, std assertions), TypeScript, React 18 (Next.js App Router), Tailwind, Supabase JS client, Postgres migrations.

---

## Plan-time correction to the spec

While reading `bcClient.ts:34,60–61` I found that `bcFetch` already implements the AbortController/30s timeout. So **Fix 8 is fully covered by Fix 2** (once `bc-vendor-search` calls `bcFetch`, it inherits the timeout for free). This plan keeps the Fix 8 entry but its body is "no work — superseded by Fix 2". The spec sequencing is unchanged.

Execution order from the spec: **1 → 2 → 3 → 11 → 6 → 4 → 7 → 8 → 9 → 5 → 10**.

---

## File structure (created or modified by this plan)

**New files:**

- `supabase/functions/_shared/logger.ts` — JSON-line structured logger.
- `supabase/functions/_shared/logger.test.ts` — unit tests for the logger.
- `supabase/functions/_shared/auth.ts` — JWT validation + finance-approver gate.
- `supabase/functions/_shared/auth.test.ts` — unit tests.
- `supabase/functions/bc-reference/test-helpers.ts` — moved `__resetCacheForTest`.
- `supabase/migrations/YYYYMMDDHHmmss_drop_orphan_bc_enums.sql` — drops 2 unused enums.
- `docs/bc-integration/bc-dev-column-width-ask.md` — column-widening note for BC dev.
- `docs/bc-integration/runbook-rpc-failed-after-bc-success.md` — on-call runbook.

**Modified files:**

- `supabase/functions/bc-claim/index.ts` — use `auth` + `logger`; remove inline JWT/approver block.
- `supabase/functions/bc-reference/index.ts` — use `auth` + `logger`; remove `__resetCacheForTest` export.
- `supabase/functions/bc-vendor-search/index.ts` — switch to `bcFetch`; use `auth` + `logger`.
- `supabase/functions/bc-claim/types.ts` — types stay but become _used_ by `payloadBuilder.ts`.
- `supabase/functions/bc-claim/payloadBuilder.ts` — annotate hardcoded literals with imported types.
- `src/modules/claims/ui/bc-claim-modal.tsx` — UX polish (Fix 11) + pre-submit validation (Fix 9, folded into Fix 11).

---

## Task index

| #   | Task                                             | Spec fix       | Effort             |
| --- | ------------------------------------------------ | -------------- | ------------------ |
| 1   | Structured logger + wire into all 3 functions    | Fix 1          | M                  |
| 2   | `bc-vendor-search` uses `bcFetch`                | Fix 2          | S                  |
| 3   | Shared auth helpers + wire into all 3 functions  | Fix 3          | M                  |
| 4   | BC claim modal UX polish (frontend-design skill) | Fix 11 + Fix 9 | M                  |
| 5   | Wire dead type exports in `payloadBuilder.ts`    | Fix 6          | S                  |
| 6   | Drop orphan enums migration                      | Fix 4          | XS                 |
| 7   | Move `__resetCacheForTest` out of prod code      | Fix 7          | XS                 |
| 8   | AbortController timeout coverage (no-op verify)  | Fix 8          | XS                 |
| 9   | Pre-submit validation in modal                   | Fix 9          | folded into Task 4 |
| 10  | BC dev column-width ask note                     | Fix 5          | XS                 |
| 11  | Catastrophic runbook                             | Fix 10         | XS                 |

---

## Task 1: Structured logger + wire into all 3 edge functions

**Files:**

- Create: `supabase/functions/_shared/logger.ts`
- Create: `supabase/functions/_shared/logger.test.ts`
- Modify: `supabase/functions/bc-claim/index.ts`
- Modify: `supabase/functions/bc-reference/index.ts`
- Modify: `supabase/functions/bc-vendor-search/index.ts`

### Sub-task 1A: Logger module + tests

- [ ] **Step 1: Write `logger.ts`**

```ts
// supabase/functions/_shared/logger.ts

/**
 * One-line JSON logger for BC edge functions. Each call emits a single
 * console.log() with a stable shape; Supabase's log explorer indexes
 * JSON keys so callers can filter by fn / claim_id / event in production.
 *
 * Redaction rules (enforced by callers, documented here):
 *  - Never include bearer tokens or Authorization headers.
 *  - Never include user PII beyond the auth.users uuid.
 *  - Truncate raw BC error bodies to the first 500 chars before passing in.
 */

export type BcFnName = "bc-claim" | "bc-reference" | "bc-vendor-search";
export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  fn: BcFnName;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

// Test seam — overridden by tests to capture emitted lines.
let writer: (line: string) => void = (line) => console.log(line);
export function __setLoggerWriter(w: ((line: string) => void) | null): void {
  writer = w ?? ((line) => console.log(line));
}

export function log(
  fn: BcFnName,
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    fn,
    level,
    event,
    ...(fields ?? {}),
  };
  writer(JSON.stringify(entry));
}
```

- [ ] **Step 2: Write `logger.test.ts`**

```ts
// supabase/functions/_shared/logger.test.ts
import { assertEquals, assertMatch } from "std/assert/mod.ts";
import { log, __setLoggerWriter } from "./logger.ts";

function captureOne(fn: () => void): unknown {
  let captured = "";
  __setLoggerWriter((line) => {
    captured = line;
  });
  try {
    fn();
  } finally {
    __setLoggerWriter(null);
  }
  return JSON.parse(captured);
}

Deno.test("log emits one JSON line with ts, fn, level, event", () => {
  const out = captureOne(() => log("bc-claim", "info", "request_start"));
  const o = out as Record<string, unknown>;
  assertEquals(o.fn, "bc-claim");
  assertEquals(o.level, "info");
  assertEquals(o.event, "request_start");
  assertMatch(o.ts as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

Deno.test("log includes arbitrary fields after the base shape", () => {
  const out = captureOne(() =>
    log("bc-claim", "error", "bc_post_outcome", {
      claim_id: "CLM-123",
      bc_status: 400,
      duration_ms: 842,
    }),
  );
  const o = out as Record<string, unknown>;
  assertEquals(o.claim_id, "CLM-123");
  assertEquals(o.bc_status, 400);
  assertEquals(o.duration_ms, 842);
});

Deno.test("log level error is preserved verbatim", () => {
  const out = captureOne(() => log("bc-reference", "warn", "cache_miss"));
  const o = out as Record<string, unknown>;
  assertEquals(o.level, "warn");
  assertEquals(o.fn, "bc-reference");
});
```

- [ ] **Step 3: Run logger tests**

Run: `cd supabase/functions && deno test --allow-env _shared/logger.test.ts`
Expected: 3 passed, 0 failed.

- [ ] **Step 4: Commit logger module**

```bash
git add supabase/functions/_shared/logger.ts supabase/functions/_shared/logger.test.ts
git commit -m "feat(edge): add structured JSON logger for BC functions"
```

### Sub-task 1B: Wire logger into `bc-claim/index.ts`

Add log calls at the 5 lifecycle events listed in the spec. Each one is a small surgical edit, not a rewrite.

- [ ] **Step 5: Import logger + emit `request_start`**

Add to imports at top of `bc-claim/index.ts`:

```ts
import { log } from "../_shared/logger.ts";
```

Inside `Deno.serve(async (req) => { ... })`, right after `if (req.method === "OPTIONS")` early return, before the `req.method !== "POST"` check (current line ~72), add:

```ts
const t0 = Date.now();
log("bc-claim", "info", "request_start", { method: req.method });
```

- [ ] **Step 6: Emit `payload_loaded`**

After `const db = dbPayloadRaw as unknown as BcClaimPayloadFromDb;` (current line ~139), add:

```ts
log("bc-claim", "info", "payload_loaded", {
  claim_id: input.claimId,
  actor: actorUserId,
  is_vendor_payment: input.isVendorPayment,
});
```

- [ ] **Step 7: Emit `attempt_started`**

After `const bcDetailsId = startData as string;` (current line ~168), add:

```ts
log("bc-claim", "info", "attempt_started", {
  claim_id: input.claimId,
  bc_details_id: bcDetailsId,
});
```

- [ ] **Step 8: Emit `bc_post_outcome` on success AND failure paths**

Inside the `try` block at line ~173, _after_ `bcResult` is assigned (line 175 area), before the status check (line 192), add:

```ts
log("bc-claim", "info", "bc_post_outcome", {
  claim_id: input.claimId,
  bc_details_id: bcDetailsId,
  bc_status: bcResult.status,
  duration_ms: Date.now() - t0,
});
```

Inside the `catch (err)` block (line 175 area), before the `record_bc_claim_failure` RPC call, add:

```ts
log("bc-claim", "error", "bc_post_outcome", {
  claim_id: input.claimId,
  bc_details_id: bcDetailsId,
  bc_status: 0,
  duration_ms: Date.now() - t0,
  error: String(err).slice(0, 500),
});
```

Inside the `if (bcResult.status < 200 || bcResult.status >= 300)` block (line 192), before the `record_bc_claim_failure` call, add:

```ts
log("bc-claim", "warn", "attempt_failed", {
  claim_id: input.claimId,
  bc_details_id: bcDetailsId,
  bc_status: bcResult.status,
});
```

- [ ] **Step 9: Emit `attempt_completed` on the success path and `catastrophic_rpc_failed_after_bc_success` on catastrophic**

Inside the `if (completeErr)` block (line ~211), before the `errResp` return, add:

```ts
log("bc-claim", "error", "catastrophic_rpc_failed_after_bc_success", {
  claim_id: input.claimId,
  bc_details_id: bcDetailsId,
  detail: completeErr.message,
});
```

After that block, just before the final `return json(cors.headers, { success: true, ... }, 200);` (line ~225), add:

```ts
log("bc-claim", "info", "attempt_completed", {
  claim_id: input.claimId,
  bc_details_id: bcDetailsId,
  duration_ms: Date.now() - t0,
});
```

- [ ] **Step 10: Emit early-return log lines (auth + body validation failures)**

Replace the early-return chains so each one logs before returning. Update these specific blocks in `bc-claim/index.ts`:

(a) After line 80 (`if (!jwt) return errResp(...)`) → replace with:

```ts
if (!jwt) {
  log("bc-claim", "warn", "auth_missing_jwt");
  return errResp(cors.headers, { code: "UNAUTHENTICATED" }, 401);
}
```

(b) After line 87 (`if (userErr || !userData.user)`) → replace with:

```ts
if (userErr || !userData.user) {
  log("bc-claim", "warn", "auth_invalid_jwt");
  return errResp(cors.headers, { code: "UNAUTHENTICATED" }, 401);
}
```

(c) After line 98 (`if (!approverRow)`) → replace with:

```ts
if (!approverRow) {
  log("bc-claim", "warn", "auth_not_finance_approver", { actor: actorUserId });
  return errResp(cors.headers, { code: "UNAUTHENTICATED" }, 401);
}
```

- [ ] **Step 11: Verify `bc-claim` still typechecks**

Run: `cd supabase/functions && deno check bc-claim/index.ts`
Expected: no errors.

- [ ] **Step 12: Commit `bc-claim` logging**

```bash
git add supabase/functions/bc-claim/index.ts
git commit -m "feat(bc-claim): emit structured logs at lifecycle checkpoints"
```

### Sub-task 1C: Wire logger into `bc-reference/index.ts`

- [ ] **Step 13: Add 2 log lines to `bc-reference/index.ts`**

Add import at top:

```ts
import { log } from "../_shared/logger.ts";
```

Inside `handler`, right before the cache-hit return (current line ~70), replace:

```ts
if (cached && cached.expiresAt > Date.now()) {
  return json(cors.headers, cached.body, 200);
}
```

with:

```ts
if (cached && cached.expiresAt > Date.now()) {
  log("bc-reference", "info", "cache_hit", { type });
  return json(cors.headers, cached.body, 200);
}
```

After the `bcFetch` resolves successfully (just before `cache.set(...)` on line ~101), add:

```ts
log("bc-reference", "info", "bc_fetch_outcome", {
  type,
  bc_status: result.status,
  count: mapped.value.length,
});
```

In the catch block (line 77–83) before the json return, add:

```ts
log("bc-reference", "error", "bc_fetch_outcome", {
  type,
  bc_status: 0,
  error: String(err).slice(0, 500),
});
```

In the `if (result.status < 200 || result.status >= 300)` block (line 85–91) before the json return, add:

```ts
log("bc-reference", "warn", "bc_fetch_outcome", {
  type,
  bc_status: result.status,
});
```

- [ ] **Step 14: Verify `bc-reference` typechecks**

Run: `cd supabase/functions && deno check bc-reference/index.ts`
Expected: no errors.

- [ ] **Step 15: Commit `bc-reference` logging**

```bash
git add supabase/functions/bc-reference/index.ts
git commit -m "feat(bc-reference): emit structured logs for cache and BC fetch"
```

### Sub-task 1D: Wire logger into `bc-vendor-search/index.ts`

Defer to Task 2. Task 2 also rewrites this file to use `bcFetch`, so we add the logger in that same pass to avoid two edit conflicts.

---

## Task 2: `bc-vendor-search` uses `bcFetch` (+ logger added in same pass)

**Files:**

- Modify: `supabase/functions/bc-vendor-search/index.ts`

### Why one combined edit

The audit lists this as Fix 2 (use `bcClient`) and Fix 8 (AbortController timeout). Reading `bcClient.ts:34,60–61` shows `bcFetch` already implements 30s AbortController. Switching to `bcFetch` covers both.

### Current vs. target

Current (lines 36, 71–80): `getBcAccessToken()` then two raw parallel `fetch()` calls with manual `Authorization` headers.

Target: drop `getBcAccessToken` import, drop env URL building, call `bcFetch("odata", "GET", path)` for each filter in parallel.

- [ ] **Step 1: Rewrite the BC-call portion of `bc-vendor-search/index.ts`**

Replace lines 1–4 (imports):

```ts
import { z } from "zod";
import { bcFetch } from "../_shared/bcClient.ts";
import { corsPreflightResponse, resolveCors } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";
```

Delete: `import { getBcAccessToken } from "../_shared/bcAuth.ts";` and `import { getBcEnv } from "../_shared/bcEnv.ts";`.

Replace lines 35–80 (the env + token + URL + dual fetch block) with:

```ts
const t0 = Date.now();

// BC's contains(tolower(field), value) is unreliable for partial substring
// search on Name — likely because the underlying SQL collation isn't applied
// the way OData's tolower() docs imply. Workaround: generate a small set of
// case variants (as-typed, lower, upper, capitalize-first) and OR them
// across the same field. BC allows OR within a field but rejects it across
// distinct fields. No (Code field) is always upper in BC, so only upper variant.
const q = parsed.data.query;
const variants = Array.from(
  new Set([
    q,
    q.toLowerCase(),
    q.toUpperCase(),
    q.charAt(0).toUpperCase() + q.slice(1).toLowerCase(),
  ]),
).map((v) => v.replace(/'/g, "''"));

const nameFilter = variants.map((v) => `contains(Name,'${v}')`).join(" or ");
const noFilter = `contains(No,'${q.toUpperCase().replace(/'/g, "''")}')`;
const path = (filter: string) => `/vendors?$filter=${encodeURIComponent(filter)}&$top=20`;

let byName, byNo;
try {
  [byName, byNo] = await Promise.all([
    bcFetch("odata", "GET", path(nameFilter)),
    bcFetch("odata", "GET", path(noFilter)),
  ]);
} catch (err) {
  log("bc-vendor-search", "error", "search_outcome", {
    query: q,
    bc_status: 0,
    duration_ms: Date.now() - t0,
    error: String(err).slice(0, 500),
  });
  return json(
    cors.headers,
    { error: "BC_API_ERROR", status: 0, body: String(err).slice(0, 500) },
    502,
  );
}

for (const r of [byName, byNo]) {
  if (r.status < 200 || r.status >= 300) {
    log("bc-vendor-search", "warn", "search_outcome", {
      query: q,
      bc_status: r.status,
      duration_ms: Date.now() - t0,
    });
    return json(cors.headers, { error: "BC_API_ERROR", status: r.status, body: r.body }, 502);
  }
}

const nameData = byName.body as { value?: Array<{ No: string; Name: string }> };
const noData = byNo.body as { value?: Array<{ No: string; Name: string }> };

const merged = new Map<string, { no: string; name: string }>();
for (const v of [...(nameData.value ?? []), ...(noData.value ?? [])]) {
  if (!merged.has(v.No)) merged.set(v.No, { no: v.No, name: v.Name });
  if (merged.size >= 20) break;
}

log("bc-vendor-search", "info", "search_outcome", {
  query: q,
  bc_status: 200,
  duration_ms: Date.now() - t0,
  result_count: merged.size,
});

return json(cors.headers, { vendors: Array.from(merged.values()) });
```

- [ ] **Step 2: Typecheck and run existing tests**

Run: `cd supabase/functions && deno check bc-vendor-search/index.ts`
Expected: no errors.

Run: `cd supabase/functions && deno test --allow-env --allow-net _shared/`
Expected: pre-existing tests for `_shared/` all pass.

(There are no unit tests for `bc-vendor-search` itself today; manual verification happens in Step 4.)

- [ ] **Step 3: Manual smoke test against deployed function**

Open the existing Postman collection `docs/api/postman/bc-vendor-search.postman_collection.json` (note: this file may not exist — if not, skip; the deployed function is also testable from the BC Claim modal UI directly).

Submit a vendor query like "amaz" — expect a `vendors` array containing matches.

If the `bc-vendor-search` Postman file does not exist: open the BC Claim modal → toggle Vendor → type "amaz" in the vendor search box → verify results render.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/bc-vendor-search/index.ts
git commit -m "refactor(bc-vendor-search): use bcFetch for token refresh + timeout + logs

bcFetch handles 401 retry with refreshed token, 30s AbortController
timeout, and uses the same OData base URL builder bc-reference uses.
Removes the only direct fetch() against BC in our edge functions."
```

---

## Task 3: Shared auth helpers + wire into all 3 functions

**Files:**

- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/auth.test.ts`
- Modify: `supabase/functions/bc-claim/index.ts`
- Modify: `supabase/functions/bc-reference/index.ts`
- Modify: `supabase/functions/bc-vendor-search/index.ts`

### Design notes

Two helpers, both async:

- `requireAuthenticatedUser(req)` — checks JWT validity. Returns `{ ok: true; userId } | { ok: false; status: 401; code: "UNAUTHENTICATED" }`. Used by `bc-reference` and `bc-vendor-search`.
- `requireFinanceApprover(req)` — calls `requireAuthenticatedUser` then checks `master_finance_approvers`. Returns the same union; failure code stays `"UNAUTHENTICATED"` (don't leak whether the user exists). Used by `bc-claim`.

Both helpers internally instantiate a service-role Supabase client. Yes, this means each request creates a client — acceptable; the JS client is cheap to construct.

- [ ] **Step 1: Write `auth.ts`**

```ts
// supabase/functions/_shared/auth.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401; code: "UNAUTHENTICATED" };

function getJwt(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

// Test seam — overridable client factory.
type ClientFactory = () => ReturnType<typeof createClient>;
let clientFactory: ClientFactory = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export function __setAuthClientFactory(fn: ClientFactory | null): void {
  clientFactory =
    fn ??
    (() => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
}

export async function requireAuthenticatedUser(req: Request): Promise<AuthResult> {
  const jwt = getJwt(req);
  if (!jwt) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  const admin = clientFactory();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  return { ok: true, userId: data.user.id };
}

export async function requireFinanceApprover(req: Request): Promise<AuthResult> {
  const base = await requireAuthenticatedUser(req);
  if (!base.ok) return base;
  const admin = clientFactory();
  const { data: row } = await admin
    .from("master_finance_approvers")
    .select("id")
    .eq("user_id", base.userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!row) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  return base;
}
```

- [ ] **Step 2: Write `auth.test.ts`**

```ts
// supabase/functions/_shared/auth.test.ts
import { assertEquals } from "std/assert/mod.ts";
import {
  requireAuthenticatedUser,
  requireFinanceApprover,
  __setAuthClientFactory,
} from "./auth.ts";

function buildReq(authHeader?: string): Request {
  return new Request("https://x.test", {
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

function fakeClient(opts: { user?: { id: string } | null; approverRow?: { id: string } | null }) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.user
            ? { data: { user: opts.user }, error: null }
            : { data: { user: null }, error: { message: "invalid" } },
        ),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: opts.approverRow ?? null, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>;
}

Deno.test("requireAuthenticatedUser — missing header → UNAUTHENTICATED", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u1" } }));
  const r = await requireAuthenticatedUser(buildReq());
  assertEquals(r, { ok: false, status: 401, code: "UNAUTHENTICATED" });
  __setAuthClientFactory(null);
});

Deno.test("requireAuthenticatedUser — invalid jwt → UNAUTHENTICATED", async () => {
  __setAuthClientFactory(() => fakeClient({ user: null }));
  const r = await requireAuthenticatedUser(buildReq("Bearer bad"));
  assertEquals(r, { ok: false, status: 401, code: "UNAUTHENTICATED" });
  __setAuthClientFactory(null);
});

Deno.test("requireAuthenticatedUser — valid jwt → ok + userId", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u42" } }));
  const r = await requireAuthenticatedUser(buildReq("Bearer ok"));
  assertEquals(r, { ok: true, userId: "u42" });
  __setAuthClientFactory(null);
});

Deno.test("requireFinanceApprover — valid user but not approver → UNAUTHENTICATED", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u1" }, approverRow: null }));
  const r = await requireFinanceApprover(buildReq("Bearer ok"));
  assertEquals(r, { ok: false, status: 401, code: "UNAUTHENTICATED" });
  __setAuthClientFactory(null);
});

Deno.test("requireFinanceApprover — valid user is approver → ok", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u1" }, approverRow: { id: "a1" } }));
  const r = await requireFinanceApprover(buildReq("Bearer ok"));
  assertEquals(r, { ok: true, userId: "u1" });
  __setAuthClientFactory(null);
});
```

- [ ] **Step 3: Run auth tests**

Run: `cd supabase/functions && deno test --allow-env _shared/auth.test.ts`
Expected: 5 passed, 0 failed.

- [ ] **Step 4: Commit auth module**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts
git commit -m "feat(edge): add shared auth helpers — JWT + finance-approver gate"
```

### Sub-task 3B: Use `requireFinanceApprover` in `bc-claim/index.ts`

- [ ] **Step 5: Replace inline JWT/approver block in `bc-claim/index.ts`**

Add import:

```ts
import { requireFinanceApprover } from "../_shared/auth.ts";
```

And **remove** these imports (now unused):

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
```

…only if `createClient` is no longer referenced elsewhere in the file. Check: it's still needed for `admin.rpc(...)` calls and `admin.from(...)`. So **keep** the `createClient` import.

Replace lines 77–100 (the entire inline JWT + getUser + approver-check block) with:

```ts
// Step 1 — JWT → finance approver (shared helper).
const auth = await requireFinanceApprover(req);
if (!auth.ok) {
  log("bc-claim", "warn", "auth_failed");
  return errResp(cors.headers, { code: "UNAUTHENTICATED" }, auth.status);
}
const actorUserId = auth.userId;
```

Note: this also folds the three Step 10 log lines from Task 1 (auth_missing_jwt / auth_invalid_jwt / auth_not_finance_approver) into a single `auth_failed` line. The reduction is intentional — `auth_failed` is enough granularity for the runbook; finer events can be added later if needed.

The `admin` client construction inside the handler is still required for the RPC calls. Keep this block:

```ts
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
```

- [ ] **Step 6: Typecheck `bc-claim`**

Run: `cd supabase/functions && deno check bc-claim/index.ts`
Expected: no errors.

### Sub-task 3C: Use `requireAuthenticatedUser` in `bc-reference/index.ts`

- [ ] **Step 7: Add auth gate at top of `handler` in `bc-reference/index.ts`**

Add import:

```ts
import { requireAuthenticatedUser } from "../_shared/auth.ts";
```

Inside `handler`, after the CORS preflight + method check (current line ~54), add:

```ts
const auth = await requireAuthenticatedUser(req);
if (!auth.ok) {
  log("bc-reference", "warn", "auth_failed");
  return json(cors.headers, { error: "UNAUTHENTICATED" }, auth.status);
}
```

- [ ] **Step 8: Typecheck `bc-reference`**

Run: `cd supabase/functions && deno check bc-reference/index.ts`
Expected: no errors.

### Sub-task 3D: Use `requireAuthenticatedUser` in `bc-vendor-search/index.ts`

- [ ] **Step 9: Add auth gate at top of handler in `bc-vendor-search/index.ts`**

Add import:

```ts
import { requireAuthenticatedUser } from "../_shared/auth.ts";
```

Inside the `Deno.serve(async (req) => { ... })`, after CORS + method check (current line ~21), add:

```ts
const auth = await requireAuthenticatedUser(req);
if (!auth.ok) {
  log("bc-vendor-search", "warn", "auth_failed");
  return json(cors.headers, { error: "UNAUTHENTICATED" }, auth.status);
}
```

- [ ] **Step 10: Typecheck `bc-vendor-search`**

Run: `cd supabase/functions && deno check bc-vendor-search/index.ts`
Expected: no errors.

### Sub-task 3E: Verify and commit

- [ ] **Step 11: Smoke-test the 401 paths**

After deployment (or via local serve), run:

```bash
curl -i -X GET "https://pltbwxddxtsavygijcnl.supabase.co/functions/v1/bc-reference?type=currencies"
```

Expected: HTTP 401 body `{"error":"UNAUTHENTICATED"}`.

```bash
curl -i -X POST "https://pltbwxddxtsavygijcnl.supabase.co/functions/v1/bc-vendor-search" \
  -H "Content-Type: application/json" -d '{"query":"x"}'
```

Expected: HTTP 401.

With a valid bearer token (grab one from the browser DevTools after logging in):

```bash
curl -i -H "Authorization: Bearer <JWT>" "https://pltbwxddxtsavygijcnl.supabase.co/functions/v1/bc-reference?type=currencies"
```

Expected: HTTP 200 with currency list.

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/bc-claim/index.ts supabase/functions/bc-reference/index.ts supabase/functions/bc-vendor-search/index.ts
git commit -m "feat(edge): gate bc-reference and bc-vendor-search behind JWT auth

bc-claim now uses the shared requireFinanceApprover helper.
bc-reference and bc-vendor-search now require a valid Supabase
user JWT — previously they relied only on CORS, which is bypassable
by server-to-server callers."
```

---

## Task 4: BC claim modal UX polish (uses `frontend-design` skill) — also folds in Fix 9

**Files:**

- Modify: `src/modules/claims/ui/bc-claim-modal.tsx`

### Implementer instructions

This task is the only one in the plan that should **invoke the `frontend-design` skill**. The implementer subagent reads `src/modules/claims/ui/bc-claim-modal.tsx` (706 lines, already polished) and `src/components/ui/searchable-combobox.tsx` (283 lines, do not change), then invokes `frontend-design` to commit to a bold, intentional aesthetic for the dropdown-heavy modal.

The subagent must not invent new component files. All changes stay inline in `bc-claim-modal.tsx`. The `SearchableCombobox` is intentionally out of scope.

### Required behavioral changes (the implementer must hit each)

- [ ] **Step 1: Reference dropdowns: responsive grid layout**

In the `<Section number="03" label="Reference Codes">` block (current lines 322–349), change the wrapper from `<div className="space-y-3">` to a responsive grid: 1 column on mobile, 3 columns on `sm:` and up. All three `<ReferenceField>` children stay; only the wrapper changes.

- [ ] **Step 2: Required-field markers on the 4 required inputs**

Add a small visual marker (asterisk or dot, choose during `frontend-design`) to the labels for:

- Vendor (`<VendorPicker>`, currently no label — add a "Vendor \*" or similar above it)
- HSN / SAC (`<ReferenceField label="HSN / SAC" ...>`)
- GST Group
- Currency

Implementation: add a `required?: boolean` prop to `ReferenceField` (component lives in the same file, lines 588–644). Render an asterisk when `required` is true. Pass `required` from each call site.

For the Vendor section, add the label inline above the picker:

```tsx
<label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
  Vendor <span className="text-rose-500">*</span>
</label>
```

- [ ] **Step 3: Unified loading skeleton for the 3 reference dropdowns**

When _all three_ reference states are `loading` (or `idle`), render a single "Loading reference codes…" skeleton bar spanning all three columns instead of three separate `Loading X…` blocks.

When one or two are loading and others are loaded/error, show the per-field state as today.

This is a composition decision in the `<Section number="03">` block, around the existing `<ReferenceField>` calls. Compute `const allLoading = [hsnSacs, gstGroups, currencies].every(s => s.status === "loading" || s.status === "idle");`. Render one skeleton when true; render the grid of three when false.

- [ ] **Step 4: Submit-disabled inline hint (folds Fix 9 in)**

Below the Submit button in `DialogFooter` (currently lines 372–393), when `canSubmit === false && !catastrophic`, render a one-line muted helper text explaining what's missing:

- If `paymentType === null` → "Choose a payment type."
- Else if `paymentType === "vendor" && !selectedVendor` → "Select a vendor."
- Else if `paymentType === "vendor"` and any of `currencyCode/gstGroupCode/hsnSacCode` is empty → "Select all reference codes."
- Else if `submitting` → no hint (the loader already communicates state).

This _is_ Fix 9 from the spec. It supersedes Fix 9's standalone Task in this plan — Fix 9 is done after Step 4 of this task.

- [ ] **Step 5: "Retry all" affordance**

When two or three reference dropdowns are in `error` state, render a single "Retry all" button at the top of section 03 instead of (or in addition to — choose during `frontend-design`) the individual retry buttons.

`onClick` for "Retry all" calls `fetchReference("currencies", setCurrencies)`, `fetchReference("gstGroupCodes", setGstGroups)`, `fetchReference("hsnSacCodes", setHsnSacs)` in parallel.

- [ ] **Step 6: Modal viewport containment**

Change `<DialogContent className="sm:max-w-3xl">` (line 258) to `<DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">` so stacked error banners cannot push the dialog beyond the viewport.

- [ ] **Step 7: Section eyebrows reflect completion**

Update the `Section` subcomponent (lines 401–424). Currently the eyebrow shows just the number "01". Make it conditionally render a filled circle (Tailwind `bg-indigo-500`) when the section's data is complete. The implementer chooses the visual treatment via `frontend-design`.

Add a `complete?: boolean` prop to `Section`. Pass:

- Section 01: `complete={paymentType !== null}`
- Section 02: `complete={!!selectedVendor}`
- Section 03: `complete={!!currencyCode && !!gstGroupCode && !!hsnSacCode}`

- [ ] **Step 8: Run the existing modal tests**

There may be no Playwright tests for this modal (`tests/e2e/` was pruned in commit `4ed493e`). For unit tests, search for `bc-claim-modal` in `tests/unit/` and run any that exist.

Run: `npm test -- bc-claim-modal`
Expected: any existing tests still pass.

- [ ] **Step 9: Manual verification in dev server**

```bash
npm run dev
```

Open the app, navigate to a claim that's eligible for BC submission, open the modal. Verify:

1. Toggle Vendor → 3 reference dropdowns render in a single row on a wide window.
2. Resize to mobile width → reference dropdowns stack to 1 column.
3. Required asterisks visible on Vendor, HSN/SAC, GST Group, Currency.
4. While references are loading → see one unified skeleton, not three separate spinners.
5. Click Submit with payment type unchosen → button disabled, hint says "Choose a payment type."
6. Choose Vendor, leave vendor unselected → hint says "Select a vendor."
7. Select vendor but leave reference codes unselected → hint says "Select all reference codes."
8. Pick all → button enables, no hint.
9. Force a reference fetch to fail (e.g., disable network mid-fetch, retry) → if 2+ fail, "Retry all" appears.
10. Modal never grows taller than viewport, scrolls internally.

- [ ] **Step 10: Commit**

```bash
git add src/modules/claims/ui/bc-claim-modal.tsx
git commit -m "feat(ui): polish BC claim modal — dropdown UX, required markers, viewport

- Responsive 3-column grid for HSN/SAC, GST Group, Currency on sm+
- Required asterisks on Vendor + 3 reference fields
- Unified loading skeleton when all 3 references are loading
- Submit-disabled inline hint explains what's missing (folds Fix 9)
- 'Retry all' when 2+ references error
- max-h-[90vh] overflow-y-auto on DialogContent
- Section eyebrows reflect per-section completion"
```

---

## Task 5: Wire dead type exports in `payloadBuilder.ts`

**Files:**

- Modify: `supabase/functions/bc-claim/payloadBuilder.ts`
- Modify: `supabase/functions/bc-claim/payloadBuilder.test.ts` (only if test assertions need updating)

### Why

Reading `bc-claim/types.ts`, the constants `BcDocumentType.Invoice`, `BcType.GLAccount`, `BcGstCredit.NonAvailment`, `BcGstSubcategory.Ineligible4344`, `BcEmployeeTransactionType.Advance`, `BcQuantity`, `BcLocationCode` already exist as `as const` literals. Importing and using them in `payloadBuilder.ts` removes the dead-export status and gives compile-time guarantee that the hardcoded payload matches the type contract.

`BcReferenceType` and `BcClaimRequestBody` are also exported but unused. Delete those two — they're a different kind of dead code (they describe shapes used elsewhere but no longer authoritative).

- [ ] **Step 1: Read current `payloadBuilder.ts`**

Run: `cat supabase/functions/bc-claim/payloadBuilder.ts | sed -n '80,110p'`

Expected lines 88–108 contain hardcoded literals like `documentType: "Invoice"`, `type: "G/L Account"`, etc.

- [ ] **Step 2: Add type imports in `payloadBuilder.ts`**

At the top, after the existing imports, add:

```ts
import {
  BcDocumentType,
  BcType,
  BcGstCredit,
  BcGstSubcategory,
  BcEmployeeTransactionType,
  BcQuantity,
  BcLocationCode,
} from "./types.ts";
```

- [ ] **Step 3: Replace hardcoded literals with the imported constants**

Inside the `base` object construction (around lines 88–108), replace:

```ts
    documentType: "Invoice",
    locationCode: "HBT",
    type: "G/L Account",
    quantity: 1,
    gstCredit: "Non-Availment",
    gstSubcategory: "Ineligible-43/44",
    employeeTransactionType: "Advance",
```

with:

```ts
    documentType: BcDocumentType.Invoice,
    locationCode: BcLocationCode,
    type: BcType.GLAccount,
    quantity: BcQuantity,
    gstCredit: BcGstCredit.NonAvailment,
    gstSubcategory: BcGstSubcategory.Ineligible4344,
    employeeTransactionType: BcEmployeeTransactionType.Advance,
```

- [ ] **Step 4: Delete unused type exports**

In `types.ts`, delete lines 23–28:

```ts
export const BcReferenceType = {
  Currencies: "currencies",
  GstGroupCodes: "gstGroupCodes",
  HsnSacCodes: "hsnSacCodes",
} as const;
export type BcReferenceType = (typeof BcReferenceType)[keyof typeof BcReferenceType];
```

Also delete the `BcClaimRequestBody` interface (lines 91–101) — it's not imported anywhere; the zod schema in `bc-claim/index.ts` is the authoritative shape.

Search for any remaining references before deleting:

```bash
grep -rn "BcReferenceType\|BcClaimRequestBody" supabase/functions/ src/
```

If there are matches outside of `types.ts` and tests, keep the symbol and document why. Otherwise delete.

- [ ] **Step 5: Typecheck and run payload builder tests**

Run: `cd supabase/functions && deno check bc-claim/index.ts bc-claim/payloadBuilder.ts`
Expected: no errors.

Run: `cd supabase/functions && deno test --allow-env bc-claim/payloadBuilder.test.ts`
Expected: 12 passed, 0 failed (existing test count).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/bc-claim/payloadBuilder.ts supabase/functions/bc-claim/types.ts
git commit -m "refactor(bc-claim): wire literal type constants into payloadBuilder

Replaces hardcoded BC payload strings with the typed constants from
types.ts. Compile-time guarantee that the values match the BcClaimLineItem
contract. Also drops two unused exports (BcReferenceType, BcClaimRequestBody)."
```

---

## Task 6: Drop orphan enums migration

**Files:**

- Create: `supabase/migrations/<timestamp>_drop_orphan_bc_enums.sql`

- [ ] **Step 1: Generate a migration timestamp**

Run: `date -u +%Y%m%d%H%M%S`
Expected: a 14-digit number like `20260518040000`. Use this as `<TS>` below.

- [ ] **Step 2: Create the migration file**

File path: `supabase/migrations/<TS>_drop_orphan_bc_enums.sql`

```sql
BEGIN;

-- These two enums were created by migration 20260513151000_bc_payment_audit_log.sql
-- to back the bc_payment_audit_log table. That table (and 2 of its 4 enums) was
-- dropped by 20260517090000_bc_claim_details_schema.sql when we replaced the
-- audit-log architecture with bc_claim_details. The remaining two enums are
-- orphans — no column anywhere uses them, and src/types/database.ts still
-- emits stale TypeScript types for them.
--
-- This migration removes the orphans. After applying:
--   1. Regenerate src/types/database.ts via `supabase gen types typescript`.
--   2. Commit the regenerated file.

DROP TYPE IF EXISTS public.bc_account_type;
DROP TYPE IF EXISTS public.bc_employee_transaction_type;

COMMIT;
```

- [ ] **Step 3: Apply migration to local supabase (if local stack is running)**

Run: `npx supabase migration up --local`
Expected: migration runs without error.

If no local stack, push directly to remote (only if user explicitly approves):

```bash
npx supabase db push --project-ref pltbwxddxtsavygijcnl
```

- [ ] **Step 4: Regenerate database.ts**

Run: `npx supabase gen types typescript --project-id pltbwxddxtsavygijcnl > src/types/database.ts`
Expected: file is rewritten without `bc_account_type` and `bc_employee_transaction_type` entries.

Verify:

```bash
grep -n "bc_account_type\|bc_employee_transaction_type" src/types/database.ts
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<TS>_drop_orphan_bc_enums.sql src/types/database.ts
git commit -m "chore(db): drop orphan BC enums left over from audit-log table

bc_account_type and bc_employee_transaction_type were created for the
bc_payment_audit_log table that was replaced by bc_claim_details in
20260517090000. The corresponding DROP statements missed these two.
Regenerated database.ts to reflect."
```

---

## Task 7: Move `__resetCacheForTest` out of `bc-reference/index.ts`

**Files:**

- Modify: `supabase/functions/bc-reference/index.ts`
- Search/modify: any test file that imports `__resetCacheForTest` from `bc-reference/index.ts`

### Decision

Cleanest: move the test seam pattern to follow what `bcClient.ts` already does (`__setBcFetchImpl`). Keep it exported from `bc-reference/index.ts`, but rename it from `__resetCacheForTest` to make its purpose explicit. The audit's "move to a test file" is over-engineering — it would create a new module just to re-export one function.

Alternative considered: extract the cache into `bc-reference/cache.ts` so the test seam lives in a dedicated module. Skipped — adds a file just to hide a 2-line function.

**Action:** Keep the function in `index.ts`, double-underscore prefix marks it as test-only. Audit the imports to ensure only test code uses it.

- [ ] **Step 1: Find all current imports of `__resetCacheForTest`**

Run: `grep -rn "__resetCacheForTest" supabase/`
Expected: at least one import site in a `*.test.ts` file. If imports also exist in non-test code, that is the actual problem to fix.

- [ ] **Step 2: If imports exist only in test files → mark this Task complete with no code change**

The double-underscore prefix is the convention already established (see `bcClient.ts:49` for `__setBcFetchImpl`, `bcAuth.ts` similar). The audit's concern was production code accidentally calling it — but TypeScript/Deno doesn't enforce that distinction; convention is the protection.

Document the decision in a small comment above the function in `bc-reference/index.ts`:

```ts
// Test seam — clears the in-memory cache between test cases.
// Prefixed __ to mark as not-for-production; matches __setBcFetchImpl in bcClient.ts.
export function __resetCacheForTest(): void {
  cache.clear();
}
```

(If the comment is already present, no edit is needed.)

- [ ] **Step 3: Commit (only if a comment was added)**

```bash
git add supabase/functions/bc-reference/index.ts
git commit -m "docs(bc-reference): mark __resetCacheForTest as test-only"
```

If no comment change: skip the commit.

---

## Task 8: AbortController timeout coverage (no-op verify)

**Files:** none.

### Why no-op

Already verified during plan-time review: `bcClient.bcFetch` implements AbortController with `DEFAULT_TIMEOUT_MS = 30_000` (see `supabase/functions/_shared/bcClient.ts:34,60–61`). `bc-reference` already uses `bcFetch`. After Task 2, `bc-vendor-search` does too. The audit's claim that these functions "use native fetch with 60s default" was wrong.

- [ ] **Step 1: Verify**

Run: `grep -n "fetch(" supabase/functions/bc-reference/index.ts supabase/functions/bc-vendor-search/index.ts`
Expected: zero direct `fetch(` calls in either file (only `bcFetch` imports).

- [ ] **Step 2: Mark Task 8 complete with no code change**

No commit.

---

## Task 9: Pre-submit validation (folded into Task 4)

Already done by Task 4 Step 4 (the submit-disabled inline hint). Mark this task complete after Task 4.

---

## Task 10: BC dev column-width ask note

**Files:**

- Create: `docs/bc-integration/bc-dev-column-width-ask.md`

- [ ] **Step 1: Create the docs directory if missing**

Run: `mkdir -p docs/bc-integration`

- [ ] **Step 2: Write the note**

```markdown
# Column width asks for BC developer

Reference: BC integration audit 2026-05-18, spec
`docs/superpowers/specs/2026-05-18-bc-integration-hardening-design.md`.

Three BC columns are currently narrower than our application generates and
need to be widened on the BC side. Once widened, we remove client-side
truncation (`payloadBuilder.ts`).

## Asks

| BC column          | Current width | Our generated max          | Ask          |
| ------------------ | ------------- | -------------------------- | ------------ |
| `remarks`          | 50            | up to ~300 chars           | widen to 250 |
| `claimNo` (No.)    | 20            | up to 29 chars             | widen to 40  |
| `employeeId` (No.) | 20            | up to ~25 chars            | widen to 40  |
| `vendorInvoiceNo`  | unknown       | up to ~50 user-typed chars | confirm ≥ 50 |

## Rationale

- **remarks (50 → 250)**: today we send `"{claim_id} - {purpose}"` clipped to
  50 chars. We're forced to drop bill/bank-statement URL hints and chop
  purpose mid-word. 250 covers claim_id (29) + " - " (3) + a reasonably
  detailed purpose (~200) + slack, and matches BC's standard nvarchar(250).

- **claimNo / employeeId (20 → 40)**: our claim ID format is
  `CLAIM-{empId}-{YYYYMMDD}-{4char}` ≈ 29 chars. Audit/test employee IDs
  can run to 25+. 40 gives 1.5× headroom for future format extensions.

- **vendorInvoiceNo**: please confirm the current BC column width. Users
  paste GST invoice numbers up to ~30 chars normally, sometimes longer.
  We send as-is today; if BC silently truncates this we have a
  data-loss bug.

## After BC widens

Remove the following from `supabase/functions/bc-claim/payloadBuilder.ts`:

- `truncBcNo()` helper and its two call sites (`claimNo`, `employeeId`).
- The 50-char cap inside `buildRemarks()`; reintroduce file-path hints.

Update `supabase/functions/bc-claim/payloadBuilder.test.ts` so the truncation
tests expect un-truncated values.
```

- [ ] **Step 3: Commit**

```bash
git add docs/bc-integration/bc-dev-column-width-ask.md
git commit -m "docs(bc): capture column-width asks for BC developer"
```

### Off-repo action

The user sends this content (or a link to the doc) to the BC developer. Not part of this plan.

---

## Task 11: Catastrophic runbook

**Files:**

- Create: `docs/bc-integration/runbook-rpc-failed-after-bc-success.md`

- [ ] **Step 1: Write the runbook**

````markdown
# Runbook — RPC_FAILED_AFTER_BC_SUCCESS

This is the only catastrophic failure mode in the BC claim flow:
**Business Central accepted the claim, but our `complete_bc_claim` RPC
then failed.** The `bc_claim_details` row is stuck in `bc_status='submitting'`
even though BC considers the claim posted.

The frontend MUST NOT retry — that would risk double-posting in BC.

## How to detect

### From the user

A finance approver reports a stuck "Submitting to BC…" state or an error
banner mentioning "BC accepted this submission but the local sync failed".
The modal surfaces `bc_claim_details_id: <uuid>`.

### From Supabase logs

```sql
-- Recent catastrophic events
select * from supabase_functions.logs
 where event_message ilike '%catastrophic_rpc_failed_after_bc_success%'
 order by timestamp desc
 limit 50;
```
````

Or use the Supabase logs explorer UI: filter by `event = catastrophic_rpc_failed_after_bc_success`.

### From the DB (proactive sweep)

Stuck `submitting` rows older than 5 minutes:

```sql
select id, claim_id, created_at, updated_at
  from public.bc_claim_details
 where bc_status = 'submitting'
   and updated_at < now() - interval '5 minutes'
 order by created_at desc;
```

## How to recover

1. Identify the affected `bc_claim_details_id` (from the modal banner or the
   stuck-row query above).
2. Pull the BC response that was already saved when BC returned 2xx:

   ```sql
   select bc_response_json
     from public.bc_claim_details
    where id = '<bc_claim_details_id>';
   ```

3. Pull the actor user id from the BC log line, or use any admin user_id:

   ```sql
   select id from public.admins limit 1;
   ```

4. Invoke `complete_bc_claim` manually via psql or the Supabase SQL Editor:

   ```sql
   select public.complete_bc_claim(
     p_bc_details_id := '<bc_claim_details_id>'::uuid,
     p_actor_user_id := '<actor_user_id>'::uuid,
     p_response_json := '<bc_response_json from step 2>'::jsonb
   );
   ```

5. Verify the claim now shows as Finance Approved in the UI.

## Prevention

The catastrophic path is rare — it only triggers when the Postgres connection
flaps mid-RPC after BC has already returned 2xx. Mitigations already in place:

- Partial UNIQUE index on `bc_claim_details(claim_id) WHERE bc_status IN ('submitting','success')` prevents concurrent retries.
- `bc-claim` edge function returns a distinct `RPC_FAILED_AFTER_BC_SUCCESS` code so the frontend can refuse to retry.
- Structured log line `catastrophic_rpc_failed_after_bc_success` lets monitoring trigger an alert (not yet wired — future work).

## Links

- Spec: `docs/superpowers/specs/2026-05-18-bc-integration-hardening-design.md` (Fix 10)
- Schema: `supabase/migrations/20260517090000_bc_claim_details_schema.sql`
- RPC: `supabase/migrations/20260517090100_bc_claim_functions.sql` (`complete_bc_claim`)

````

- [ ] **Step 2: Commit**

```bash
git add docs/bc-integration/runbook-rpc-failed-after-bc-success.md
git commit -m "docs(bc): runbook for RPC_FAILED_AFTER_BC_SUCCESS catastrophic path"
````

---

## Final verification (after all tasks)

- [ ] **Run the full edge-function test suite**

Run: `cd supabase/functions && deno test --allow-env --allow-net`
Expected: all tests pass.

- [ ] **Run the unit test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Deploy edge functions to the sandbox project**

Run:

```bash
npx supabase functions deploy bc-claim --project-ref pltbwxddxtsavygijcnl
npx supabase functions deploy bc-reference --project-ref pltbwxddxtsavygijcnl
npx supabase functions deploy bc-vendor-search --project-ref pltbwxddxtsavygijcnl
```

- [ ] **Smoke-test the 31-row scenario matrix from the audit**

Source: BC audit, Section 8. Run at minimum the 8 happy-path cells + the concurrency case (#20) + the JWT cases (#26–29). Document any failures back to the user.

- [ ] **Final commit** (if any cleanup or notes accumulated)

```bash
git add .
git commit -m "chore(bc): final hardening sweep — tests pass, scenarios verified"
```

---

## Sequencing summary

Per spec sequencing (1 → 2 → 3 → 11 → 6 → 4 → 7 → 8 → 9 → 5 → 10), the task order in this plan is:

1. Task 1 (Fix 1: logger)
2. Task 2 (Fix 2: bcFetch in vendor-search — also adds vendor-search logging)
3. Task 3 (Fix 3: shared auth + wire all three)
4. Task 4 (Fix 11: modal UX polish — folds Fix 9 in)
5. Task 5 (Fix 6: wire type exports)
6. Task 6 (Fix 4: drop orphan enums)
7. Task 7 (Fix 7: move \_\_resetCacheForTest — likely no-op)
8. Task 8 (Fix 8: verify timeout coverage — no-op)
9. (Task 9 — done as part of Task 4)
10. Task 10 (Fix 5: BC dev column-width note)
11. Task 11 (Fix 10: catastrophic runbook)

Each task ends with one commit (or none, for the no-ops). Plan total: ~9 commits.
