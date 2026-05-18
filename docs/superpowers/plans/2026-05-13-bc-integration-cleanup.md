# BC Integration Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address 5 post-review follow-ups on the BC Payment Integration: lock down CORS to an allow-list, clean up the `auditLogId` sentinel, document the BC URL asymmetry, document the vendor-search case-variants workaround, and add a Playwright E2E for the BC modal flow.

**Architecture:** Both Edge Functions adopt a single CORS helper that reads `BC_ALLOWED_ORIGINS` from env (comma-separated, parsed once). `resolveCors(req)` returns either an allow-decision with origin-echo headers, or a deny-decision with `Vary: Origin` only. Preflight returns 204/403 accordingly; POST responses always carry the resolved CORS headers (browser blocks reads from disallowed origins; server-to-server callers are not affected). `auditLogId` becomes `string | null` in the error type, with the orchestrator emitting `null` only when the audit-row insert itself failed. URL comments + spec notes lock in the design decisions for future readers. Playwright E2E uses `page.route()` to intercept Edge Function calls so the test never hits BC.

**Tech Stack:** Deno + TypeScript (Edge Functions), Playwright, React Hook Form, shadcn/ui (Dialog), sonner (toast).

**Authoritative references:**

- `docs/superpowers/specs/2026-05-13-bc-integration-cleanup-design.md` — design doc (this plan implements that spec).
- `plan_bc.md` — original feature spec (for vendor-search known-limitation note).
- `postman/sandbox/bc-claims-api.postman_collection.json` and `postman/sandbox/bc-vendor-api.postman_collection.json` — referenced in code comments.

---

## File Structure

**Modified:**

- `supabase/functions/_shared/bcEnv.ts` — add `allowedOrigins: Set<string>`
- `supabase/functions/_shared/cors.ts` — rewrite exports (`resolveCors`, `corsPreflightResponse`, test seam)
- `supabase/functions/_shared/cors.test.ts` — NEW; Deno tests for `resolveCors`
- `supabase/functions/bc-vendor-search/index.ts` — adopt new CORS helpers + URL comment + expanded case-variants comment
- `supabase/functions/bc-payment/types.ts` — `auditLogId: string | null`
- `supabase/functions/bc-payment/index.ts` — adopt new CORS helpers + emit `auditLogId: null` on audit-insert failure
- `supabase/functions/bc-payment/bcPaymentsClient.ts` — add URL asymmetry comment
- `plan_bc.md` — add "Known limitation: case-variants" subsection under BC Vendor Search API
- `tests/e2e/claims/bc-payment-modal.spec.ts` — NEW; Playwright E2E

**Dependency order:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Each task is independently committable and verifiable.

---

## Task 1: Add `allowedOrigins` to typed env

**Files:**

- Modify: `supabase/functions/_shared/bcEnv.ts`

- [ ] **Step 1: Replace the file content with the version below**

```ts
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
  // BC_ALLOWED_ORIGINS is optional. Empty/missing => empty set => browsers
  // from any origin are blocked by the CORS check. Server-to-server callers
  // (without an Origin header) are unaffected by the allow-list.
  allowedOrigins: Set<string>;
};

let cached: BcEnv | null = null;

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

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
    allowedOrigins: parseAllowedOrigins(Deno.env.get("BC_ALLOWED_ORIGINS")),
  };
  return cached;
}

// Test-only seam. Allows tests to reset the module-level cache.
export function __resetBcEnvCache(): void {
  cached = null;
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/bcEnv.ts
git commit -m "feat(bc): add allowedOrigins to typed BC env

Reads BC_ALLOWED_ORIGINS (comma-separated, optional) into a Set.
Empty/missing means no browser origins allowed (fail-closed).
Adds a __resetBcEnvCache() test seam consistent with bcAuth.ts."
```

---

## Task 2: Rewrite `_shared/cors.ts` with allow-list logic + Deno tests

**Files:**

- Create: `supabase/functions/_shared/cors.test.ts`
- Modify: `supabase/functions/_shared/cors.ts`

- [ ] **Step 1: Write the test file first (TDD)**

Path: `supabase/functions/_shared/cors.test.ts`

```ts
import { assertEquals, assert } from "std/assert/mod.ts";
import { __resetBcEnvCache } from "./bcEnv.ts";
import { __setCorsTestOverrides, resolveCors, corsPreflightResponse } from "./cors.ts";

function reqWith(origin: string | null, method = "OPTIONS"): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  return new Request("https://example.com/fn", { method, headers });
}

Deno.test("resolveCors: allowed origin echoes back ACAO + Vary", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({
    allowedOrigins: new Set(["http://localhost:3000", "https://app.example"]),
  });
  const r = resolveCors(reqWith("http://localhost:3000"));
  assertEquals(r.allow, true);
  assertEquals(r.headers["Access-Control-Allow-Origin"], "http://localhost:3000");
  assertEquals(r.headers["Vary"], "Origin");
  assert(r.headers["Access-Control-Allow-Methods"].includes("POST"));
  assert(r.headers["Access-Control-Allow-Headers"].includes("authorization"));
  __setCorsTestOverrides(null);
});

Deno.test("resolveCors: disallowed origin returns Vary only, no ACAO", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({
    allowedOrigins: new Set(["https://app.example"]),
  });
  const r = resolveCors(reqWith("https://evil.example"));
  assertEquals(r.allow, false);
  assertEquals(r.headers["Vary"], "Origin");
  assertEquals(r.headers["Access-Control-Allow-Origin"], undefined);
  __setCorsTestOverrides(null);
});

Deno.test("resolveCors: missing Origin header is treated as disallowed", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set(["https://app.example"]) });
  const r = resolveCors(reqWith(null));
  assertEquals(r.allow, false);
  assertEquals(r.headers["Access-Control-Allow-Origin"], undefined);
  __setCorsTestOverrides(null);
});

Deno.test("resolveCors: empty allow-list denies everything", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set() });
  const r = resolveCors(reqWith("http://localhost:3000"));
  assertEquals(r.allow, false);
  __setCorsTestOverrides(null);
});

Deno.test("corsPreflightResponse: 204 when allowed", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set(["http://localhost:3000"]) });
  const resp = corsPreflightResponse(reqWith("http://localhost:3000"));
  assertEquals(resp.status, 204);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
  __setCorsTestOverrides(null);
});

Deno.test("corsPreflightResponse: 403 when not allowed", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set(["https://app.example"]) });
  const resp = corsPreflightResponse(reqWith("https://evil.example"));
  assertEquals(resp.status, 403);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(resp.headers.get("Vary"), "Origin");
  __setCorsTestOverrides(null);
});
```

- [ ] **Step 2: Replace `_shared/cors.ts` content**

```ts
import { getBcEnv } from "./bcEnv.ts";

const BASE_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
} as const;

type TestOverrides = { allowedOrigins: Set<string> };
let overrides: TestOverrides | null = null;

// Test-only seam. In tests, call __setCorsTestOverrides({ allowedOrigins: ... })
// to bypass the env reader. Pass null to restore env-driven behaviour.
export function __setCorsTestOverrides(o: TestOverrides | null): void {
  overrides = o;
}

function getAllowedOrigins(): Set<string> {
  if (overrides) return overrides.allowedOrigins;
  return getBcEnv().allowedOrigins;
}

export function resolveCors(req: Request): {
  allow: boolean;
  headers: Record<string, string>;
} {
  const origin = req.headers.get("Origin");
  if (!origin) {
    return { allow: false, headers: { Vary: "Origin" } };
  }
  const allowed = getAllowedOrigins();
  if (allowed.has(origin)) {
    return {
      allow: true,
      headers: { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin },
    };
  }
  return { allow: false, headers: { Vary: "Origin" } };
}

export function corsPreflightResponse(req: Request): Response {
  const { allow, headers } = resolveCors(req);
  return new Response(null, { status: allow ? 204 : 403, headers });
}
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: exit 0. (The Deno-targeted files are excluded from Next.js tsc; this just sanity-checks the rest of the repo.)

- [ ] **Step 4: Note about Deno tests**

Deno may not be installed locally. The 6 test cases above will run in CI / on any dev machine with `deno` available. If `which deno` returns a path, run:

```bash
cd supabase/functions/_shared && deno test --no-check cors.test.ts
```

Expected: 6 tests pass.

If Deno isn't installed, skip the test execution. The file is still valuable as executable documentation.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/cors.test.ts
git commit -m "feat(bc): allow-list CORS via BC_ALLOWED_ORIGINS env

resolveCors(req) returns either an allow-decision with origin echo-back
+ Vary, or a deny-decision with Vary-only. corsPreflightResponse(req)
returns 204 / 403 accordingly. Six Deno tests cover allowed/disallowed/
missing-origin/empty-allow-list/preflight-204/preflight-403."
```

---

## Task 3: Adopt new CORS helpers in `bc-vendor-search` + URL & search comments

**Files:**

- Modify: `supabase/functions/bc-vendor-search/index.ts`

- [ ] **Step 1: Read the current file once**

Run: `cat supabase/functions/bc-vendor-search/index.ts`

Confirm the file currently imports `{ CORS_HEADERS, corsPreflight }` from `../_shared/cors.ts` and has an OPTIONS branch that calls `corsPreflight()`, plus a `json()` helper that spreads `CORS_HEADERS`.

- [ ] **Step 2: Replace the file with the version below**

```ts
import { z } from "zod";
import { getBcAccessToken } from "../_shared/bcAuth.ts";
import { getBcEnv } from "../_shared/bcEnv.ts";
import { corsPreflightResponse, resolveCors } from "../_shared/cors.ts";

const InputSchema = z.object({
  query: z.string().trim().min(1).max(60),
});

type BcVendor = { No: string; Name: string };
type BcVendorResponse = { value?: BcVendor[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }
  const cors = resolveCors(req);

  if (req.method !== "POST") {
    return json(cors.headers, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(cors.headers, { error: "INVALID_JSON" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return json(cors.headers, { error: "INVALID_INPUT", issues: parsed.error.flatten() }, 400);
  }

  const env = getBcEnv();
  const token = await getBcAccessToken();

  // BC's contains(tolower(field), value) is unreliable for partial substring
  // search on Name — likely because the underlying SQL collation isn't applied
  // the way OData's tolower() docs imply. Workaround: generate a small set of
  // case variants (as-typed, lower, upper, capitalize-first) and OR them
  // across the same field. BC allows OR within a field but rejects it across
  // distinct fields. No (Code field) is always upper in BC, so only upper variant.
  //
  // Known limitation: this misses unusual case combos like 'PvT lTd'. A real
  // fix would use BC's auto-uppercased Search Name field once we confirm the
  // vendor entity exposes it via OData $metadata. Tracked as a follow-up.
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
  // No (Code field) is always uppercase in BC, so only the uppercase variant matters.
  const noFilter = `contains(No,'${q.toUpperCase().replace(/'/g, "''")}')`;

  // BC's standard OData v4 Vendor entity endpoint shape.
  // Source: postman/sandbox/bc-vendor-api.postman_collection.json (GetVendorRequest).
  // Note: this URL DOES include {tenantId} in the path, unlike the BC Claims
  // API used by bc-payment. Do not "unify" them.
  const baseUrl =
    `https://api.businesscentral.dynamics.com/v2.0/${env.tenantId}/${env.environment}` +
    `/ODataV4/Company('${encodeURIComponent(env.companyName)}')/vendors`;
  const buildUrl = (filter: string) => `${baseUrl}?$filter=${encodeURIComponent(filter)}&$top=20`;

  const [byName, byNo] = await Promise.all([
    fetch(buildUrl(nameFilter), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(buildUrl(noFilter), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  for (const r of [byName, byNo]) {
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return json(
        cors.headers,
        { error: "BC_API_ERROR", status: r.status, body: text.slice(0, 500) },
        502,
      );
    }
  }

  const [nameData, noData] = (await Promise.all([
    byName.json(),
    byNo.json(),
  ])) as BcVendorResponse[];

  const merged = new Map<string, { no: string; name: string }>();
  for (const v of [...(nameData.value ?? []), ...(noData.value ?? [])]) {
    if (!merged.has(v.No)) merged.set(v.No, { no: v.No, name: v.Name });
    if (merged.size >= 20) break;
  }
  return json(cors.headers, { vendors: Array.from(merged.values()) });
});

function json(corsHeaders: Record<string, string>, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/bc-vendor-search/index.ts
git commit -m "feat(bc): bc-vendor-search uses allow-list CORS + URL/search comments

Adopts resolveCors(req)/corsPreflightResponse(req) so every response
(success, error, preflight) emits origin-echo CORS headers when the
caller is in BC_ALLOWED_ORIGINS, or Vary-only headers otherwise.

Documents the BC OData v4 URL shape (tenantId in path) and explains
why we don't unify it with the Alletec Claims API URL (no tenantId).

Expands the case-variants comment to call out the known-limitation
(missed unusual case combos; Search Name field is a future fix)."
```

---

## Task 4: Update `bc-payment/types.ts` — `auditLogId` becomes nullable

**Files:**

- Modify: `supabase/functions/bc-payment/types.ts`

- [ ] **Step 1: Locate the `BcPaymentError` union and update the `DB_UPDATE_FAILED` variant**

Open the file. Find the line:

```ts
  | { code: "DB_UPDATE_FAILED"; claimId: string; auditLogId: string }
```

Change it to:

```ts
  | { code: "DB_UPDATE_FAILED"; claimId: string; auditLogId: string | null }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (The orchestrator currently passes a string in both cases; widening the type is non-breaking.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/bc-payment/types.ts
git commit -m "refactor(bc): auditLogId in DB_UPDATE_FAILED is nullable

When the PENDING audit row insert itself fails, there's no audit log
id to surface. The orchestrator will emit null in that case (the
\"\" sentinel cleanup happens in the next commit)."
```

---

## Task 5: Adopt new CORS helpers in `bc-payment` + emit `null` for missing audit id

**Files:**

- Modify: `supabase/functions/bc-payment/index.ts`

- [ ] **Step 1: Read the current file**

Run: `cat supabase/functions/bc-payment/index.ts`

Note the import line for `cors.ts`, the OPTIONS branch, the `errResp` helper at the bottom, and the two non-error `new Response(...)` blocks (dry-run and final success).

- [ ] **Step 2: Replace the file with the version below**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "zod";
import { buildBcLineItems } from "./payloadBuilder.ts";
import { postBcLineItems } from "./bcPaymentsClient.ts";
import { corsPreflightResponse, resolveCors } from "../_shared/cors.ts";
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
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  const cors = resolveCors(req);

  if (req.method !== "POST") {
    return errResp(cors.headers, { code: "INVALID_INPUT", issues: "method" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errResp(cors.headers, { code: "INVALID_INPUT", issues: "json" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return errResp(cors.headers, { code: "INVALID_INPUT", issues: parsed.error.flatten() }, 400);
  }

  const { claimId, isVendorPayment, bcVendorId, bcVendorName, dryRun } = parsed.data;

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return errResp(cors.headers, { code: "UNAUTHORIZED" }, 401);

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Step 0 — finance-approver auth gate.
  const { data: userData, error: userErr } = await serviceClient.auth.getUser(jwt);
  if (userErr || !userData.user) return errResp(cors.headers, { code: "UNAUTHORIZED" }, 401);
  const actorUserId = userData.user.id;

  const { data: approverRow, error: approverErr } = await serviceClient
    .from("master_finance_approvers")
    .select("id")
    .eq("user_id", actorUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (approverErr) return errResp(cors.headers, { code: "UNAUTHORIZED" }, 401);
  if (!approverRow) return errResp(cors.headers, { code: "UNAUTHORIZED" }, 401);

  // Step 3 — resolve payload + validate.
  const { data: payloadJson, error: payloadErr } = await serviceClient.rpc("get_bc_claim_payload", {
    p_claim_id: claimId,
  });
  if (payloadErr) {
    return errResp(cors.headers, { code: "INVALID_INPUT", issues: payloadErr.message }, 400);
  }

  const payload = payloadJson as Record<string, unknown>;
  if (typeof payload.error === "string") {
    return mapDbError(cors.headers, payload);
  }
  const dbPayload = payload as unknown as BcClaimPayloadFromDb;

  if (dbPayload.bc_payments_flag)
    return errResp(cors.headers, { code: "ALREADY_SENT", claimId }, 409);
  if (isVendorPayment && (!bcVendorId || !bcVendorName))
    return errResp(cors.headers, { code: "MISSING_VENDOR_SELECTION" }, 400);
  if (!isVendorPayment && !dbPayload.bc_code) {
    return errResp(
      cors.headers,
      { code: "MISSING_BC_CODE", expenseCategoryId: dbPayload.expense_category_id },
      400,
    );
  }

  let lines;
  try {
    lines = buildBcLineItems(dbPayload, { isVendorPayment, bcVendorId, bcVendorName });
  } catch (e) {
    return errResp(cors.headers, { code: "INVALID_INPUT", issues: (e as Error).message }, 400);
  }

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
      headers: { ...cors.headers, "content-type": "application/json" },
    });
  }

  // Step 4 — PENDING audit row.
  const { data: auditRow, error: auditErr } = await serviceClient
    .from("bc_payment_audit_log")
    .insert({ claim_id: claimId, status: "PENDING", payload_json: lines })
    .select("id")
    .single();
  if (auditErr || !auditRow) {
    return errResp(cors.headers, { code: "DB_UPDATE_FAILED", claimId, auditLogId: null }, 500);
  }
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
    return errResp(
      cors.headers,
      { code: "BC_API_ERROR", status: failure.status, body: failure.body },
      502,
    );
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
    return errResp(cors.headers, { code: "DB_UPDATE_FAILED", claimId, auditLogId }, 500);
  }

  const success: BcPaymentSuccess = { ok: true, claimId, bcResponses, auditLogId };
  return new Response(JSON.stringify(success), {
    status: 200,
    headers: { ...cors.headers, "content-type": "application/json" },
  });
});

function errResp(
  corsHeaders: Record<string, string>,
  err: BcPaymentError,
  status: number,
): Response {
  return new Response(JSON.stringify({ ok: false, error: err }), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function mapDbError(corsHeaders: Record<string, string>, p: Record<string, unknown>): Response {
  const e = p.error as string;
  if (e === "CLAIM_NOT_FOUND")
    return errResp(corsHeaders, { code: "CLAIM_NOT_FOUND", claimId: String(p.claim_id) }, 404);
  if (e === "NOT_REIMBURSEMENT")
    return errResp(
      corsHeaders,
      { code: "NOT_REIMBURSEMENT", paymentMode: String(p.payment_mode) },
      400,
    );
  if (e === "EXPENSE_DETAILS_MISSING")
    return errResp(
      corsHeaders,
      { code: "EXPENSE_DETAILS_MISSING", claimId: String(p.claim_id) },
      400,
    );
  if (e === "MISSING_MAPPING")
    return errResp(
      corsHeaders,
      { code: "MISSING_MAPPING", field: String(p.field), detail: JSON.stringify(p) },
      400,
    );
  return errResp(corsHeaders, { code: "INVALID_INPUT", issues: p }, 400);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/bc-payment/index.ts
git commit -m "feat(bc): bc-payment uses allow-list CORS + null auditLogId sentinel

Adopts resolveCors(req)/corsPreflightResponse(req) so every response
(error, dry-run, success) carries origin-echo CORS headers when the
caller is in BC_ALLOWED_ORIGINS, or Vary-only otherwise.

Audit-insert failure now emits auditLogId: null (matches the type
change in the previous commit). The complete_bc_payment-failure
branch still emits the real auditLogId since the row exists."
```

---

## Task 6: BC URL asymmetry comment in `bcPaymentsClient.ts`

**Files:**

- Modify: `supabase/functions/bc-payment/bcPaymentsClient.ts`

- [ ] **Step 1: Add the comment block above the `url` template**

Find the function `postOne` (or wherever the URL is constructed). Above the `const url = ...` line, insert:

```ts
// BC's custom Alletec Claim API endpoint shape.
// Source: postman/sandbox/bc-claims-api.postman_collection.json (NxtClaim request).
// Note: this URL does NOT include {tenantId} in the path, unlike the BC vendor
// OData endpoint used by bc-vendor-search. Do not "unify" them.
```

The full function should now look like:

```ts
async function postOne(line: BcClaimLineItem): Promise<BcPostResult> {
  const env = getBcEnv();
  // BC's custom Alletec Claim API endpoint shape.
  // Source: postman/sandbox/bc-claims-api.postman_collection.json (NxtClaim request).
  // Note: this URL does NOT include {tenantId} in the path, unlike the BC vendor
  // OData endpoint used by bc-vendor-search. Do not "unify" them.
  const url =
    `https://api.businesscentral.dynamics.com/v2.0/${env.environment}` +
    `/api/Alletec/Claim/v1.0/companies(${env.companyId})/Claims`;
  // ... rest unchanged
```

(The rest of `postOne` and the rest of the file are unchanged.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/bc-payment/bcPaymentsClient.ts
git commit -m "docs(bc): comment the Alletec Claim API URL shape

Documents why this URL omits {tenantId} (BC's custom API path)
and warns future maintainers not to unify it with the OData v4
vendor endpoint used by bc-vendor-search. References the
Postman collection as the source of truth."
```

---

## Task 7: Add vendor-search "Known limitation" subsection to `plan_bc.md`

**Files:**

- Modify: `plan_bc.md`

- [ ] **Step 1: Open `plan_bc.md` and locate the "BC Vendor Search API" section**

Run: `grep -n "BC Vendor Search API" plan_bc.md`

Note the line number. The section ends at the next `###` or `---` divider.

- [ ] **Step 2: Insert a "Known limitation" subsection at the end of that section**

Just before the `---` (or `### …`) that follows the BC Vendor Search API content, append:

```markdown
#### Known limitation: case-variants workaround

BC's `contains(tolower(Name), 'x')` returned 0 rows for partial substring search in our testing — likely because the underlying SQL collation isn't applied the way OData's `tolower()` docs imply. As a workaround, `bc-vendor-search` generates a small set of case variants of the user's query (as-typed, lowercase, uppercase, capitalize-first) and OR-s them across the `Name` field; BC accepts OR within the same field but not across distinct fields. The `No` field (Code type) is always uppercase in BC, so only the uppercase variant is sent for it.

This misses unusual case combinations like `'PvT lTd'`. A more robust fix would use BC's auto-uppercased `Search Name` field once the vendor entity's OData `$metadata` is confirmed to expose it. Tracked as a follow-up in the BC integration roadmap.
```

- [ ] **Step 3: Verify the markdown renders correctly**

Run: `head -200 plan_bc.md | grep -A 5 "Known limitation"`
Expected: the new subsection appears with correct heading level (`####`).

- [ ] **Step 4: Commit**

```bash
git add plan_bc.md
git commit -m "docs(bc): document vendor-search case-variants known limitation

Captures the BC tolower() unreliability and the OR-across-case-variants
workaround used by bc-vendor-search. Names the Search Name field as
the future-fix path."
```

---

## Task 8: Playwright E2E for the BC modal flow

**Files:**

- Create: `tests/e2e/claims/bc-payment-modal.spec.ts`

- [ ] **Step 1: Read existing E2E patterns for reference**

Run: `cat tests/global.setup.ts`
Also: `ls tests/e2e/claims/` to see how claim-specific tests are organised.

Note the auth pattern (likely uses a stored auth state file or login fixture) and how other specs set up a claim in a specific status. You'll mirror that pattern.

- [ ] **Step 2: Create the spec file**

Path: `tests/e2e/claims/bc-payment-modal.spec.ts`

```ts
import { test, expect, type Page } from "@playwright/test";

// Edge Function URL prefix used in mocks. Replace the project ref if your
// test environment points at a different Supabase project.
const FN_URL = /https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/(bc-payment|bc-vendor-search)/;

// Helper: pick the first Reimbursement claim awaiting Finance Approval and
// navigate to its detail page. Uses generic table-row selectors that match
// the project's current claims-list markup; if a future redesign breaks
// these, update them here in one place.
async function gotoFinanceApprovableReimbursementClaim(page: Page) {
  await page.goto("/dashboard/claims?status=HOD+approved+-+Awaiting+finance+approval");
  const firstClaim = page.locator("table tbody tr").first();
  await firstClaim.locator("a").first().click();
  await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
}

async function mockBcPayment(page: Page, response: unknown, status = 200) {
  await page.route(/bc-payment(\?|$)/, async (route, request) => {
    if (!FN_URL.test(request.url())) return route.continue();
    if (!request.url().includes("/bc-payment")) return route.continue();
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

async function mockBcVendorSearch(page: Page, vendors: { no: string; name: string }[]) {
  await page.route(/bc-vendor-search(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ vendors }),
    });
  });
}

test.describe("BC payment modal", () => {
  test("approves Reimbursement claim as non-vendor", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcPayment(page, {
      ok: true,
      claimId: "TEST-CLAIM",
      bcResponses: [{}],
      auditLogId: "audit-1",
    });

    await page.getByRole("button", { name: /approve/i }).click();
    await expect(page.getByText("Send to Business Central")).toBeVisible();

    await page.getByText("Non-Vendor Payment").click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText(/Sent to Business Central/i)).toBeVisible({ timeout: 4000 });
    await expect(page.getByText("Send to Business Central")).toBeHidden({
      timeout: 4000,
    });
  });

  test("approves Reimbursement claim as vendor with vendor search", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcVendorSearch(page, [
      { no: "VEN/0001", name: "Test Vendor One" },
      { no: "VEN/0002", name: "Test Vendor Two" },
    ]);
    await mockBcPayment(page, {
      ok: true,
      claimId: "TEST-CLAIM",
      bcResponses: [{}, {}],
      auditLogId: "audit-2",
    });

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Vendor Payment").click();
    await page.getByPlaceholder("Search vendor by name or ID").fill("test");
    await page.getByText("Test Vendor One").click();
    await expect(page.getByText("Selected: Test Vendor One (VEN/0001)")).toBeVisible();

    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/Sent to Business Central/i)).toBeVisible({ timeout: 4000 });
  });

  test("shows inline error when BC rejects (BC_API_ERROR)", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcPayment(
      page,
      {
        ok: false,
        error: { code: "BC_API_ERROR", status: 502, body: "BC down" },
      },
      502,
    );

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Non-Vendor Payment").click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText("Business Central rejected the request. Please contact admin."),
    ).toBeVisible({ timeout: 4000 });
    // Modal stays open so user can retry or cancel
    await expect(page.getByText("Send to Business Central")).toBeVisible();
  });

  test("blocks duplicate send (ALREADY_SENT)", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcPayment(
      page,
      {
        ok: false,
        error: { code: "ALREADY_SENT", claimId: "TEST-CLAIM" },
      },
      409,
    );

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Non-Vendor Payment").click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText("This claim has already been sent to Business Central."),
    ).toBeVisible({ timeout: 4000 });
  });

  test("shows empty state when no vendors match", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcVendorSearch(page, []);

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Vendor Payment").click();
    await page.getByPlaceholder("Search vendor by name or ID").fill("nonexistent");

    await expect(page.getByText(/No vendors match/i)).toBeVisible({ timeout: 2000 });
  });

  test("disables Confirm during submission", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    // Delay the mock so we can observe the loading state.
    await page.route(/bc-payment(\?|$)/, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          claimId: "TEST-CLAIM",
          bcResponses: [{}],
          auditLogId: "audit-3",
        }),
      });
    });

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Non-Vendor Payment").click();
    const confirm = page.getByRole("button", { name: "Confirm" });
    await confirm.click();
    await expect(page.getByRole("button", { name: /Sending to BC/i })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run the new spec against the local dev server**

In one terminal:

```bash
npm run dev
```

In another:

```bash
npm run test:e2e -- bc-payment-modal
```

Expected: 6 tests pass.

If any test fails because of fixture/setup issues (e.g., no Reimbursement claim in `HOD approved` status, or the auth setup file isn't seeding a Finance Approver), STOP and report BLOCKED with the specific failure. Do not silently rewrite the test to fit broken fixtures — the test is the spec; if reality diverges, that's a separate fix.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/claims/bc-payment-modal.spec.ts
git commit -m "test(bc): Playwright E2E for the BC payment modal flow

Six scenarios with Edge Function calls mocked via page.route():
1. Non-vendor happy path -> success toast
2. Vendor happy path with vendor search -> success toast
3. BC rejection -> inline error, modal stays open
4. Duplicate send (ALREADY_SENT) -> inline error
5. Vendor search empty state -> 'No vendors match'
6. Loading state -> Confirm button disabled + 'Sending to BC...'

Tests never hit BC; complete_bc_payment is never invoked because
bc-payment is mocked, so the test claim's state is unchanged
across runs."
```

---

## Verification (full run)

After all 8 tasks land:

- [ ] **Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Lint**

```bash
npm run lint
```

Expected: 0 errors. Pre-existing warnings (9 in unrelated files) are acceptable.

- [ ] **Deno tests** (if Deno is locally available)

```bash
cd supabase/functions/_shared && deno test --no-check cors.test.ts
cd supabase/functions/bc-payment && deno test --no-check payloadBuilder.test.ts
cd supabase/functions/_shared && deno test --allow-env --allow-net bcAuth.test.ts
```

Expected: all pass.

- [ ] **Playwright E2E**

```bash
npm run test:e2e -- bc-payment-modal
```

Expected: 6 tests pass.

- [ ] **Operational follow-up (user task; out of subagent scope)**

```bash
# Set the allow-list secret on the test project
npx supabase secrets set BC_ALLOWED_ORIGINS=http://localhost:3000,https://nxtclaim-test.example

# Redeploy both functions to pick up the new code + env
npx supabase functions deploy bc-vendor-search
npx supabase functions deploy bc-payment
```

Then in the browser (dev console on a logged-in page) retry the same fetch from Steps 2 and 3 of the original verification — both should still return 200. From a non-allowed origin, the preflight should return 403.

## Out of scope

- Establishing CI (separate spec).
- Vendor search refactor to use `Search Name` (deferred follow-up).
- Bulk approval through BC.
- Rotating `BC_CLIENT_SECRET`.
- Backfilling pre-April migrations into `supabase_migrations.schema_migrations`.
