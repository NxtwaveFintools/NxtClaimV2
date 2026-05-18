# BC Integration Cleanup — Design

**Date:** 2026-05-13
**Branch:** `bc_int`
**Status:** Approved
**Parent spec:** `plan_bc.md` (BC Payment Integration feature)
**Parent code-review:** issued in-session against commits `5ae3bdf`..`6f0c040` on `bc_int`

## Context

The BC Payment Integration shipped to the test Supabase project (`pltbwxddxtsavygijcnl`) and was verified end-to-end (vendor search, dry-run, real non-vendor send, real vendor send, success toast, audit log states). A code review surfaced a handful of small-to-medium follow-ups. This spec covers **5 of those follow-ups** as a single PR-sized cleanup. CI setup (the sixth review item) is deferred — establishing GitHub Actions for this repo is its own project with its own spec.

## Goals

1. Restrict CORS on both Edge Functions to a configured allow-list (replacing `*`).
2. Clean up the `auditLogId: ""` sentinel by typing `auditLogId` as `string | null`.
3. Document the intentional BC URL asymmetry between `bc-vendor-search` and `bc-payment`.
4. Document the vendor-search case-variants workaround (no code change to the logic itself).
5. Add a Playwright E2E test that mocks the Edge Function boundary and covers the BC modal flow.

## Non-goals

- Establishing CI (separate spec).
- Refactoring vendor search to use BC's `Search Name` field (documented as a follow-up; needs schema confirmation).
- Bulk approval through BC (separate spec, already named).
- Rotating `BC_CLIENT_SECRET` (operational, not code).
- Changing any DB schema, RPCs, or migrations.

---

## 1. CORS lock-down

### Why

Current `_shared/cors.ts` returns `Access-Control-Allow-Origin: *`. Acceptable for sandbox; not acceptable for production. Any browser on any origin can invoke these functions today (subject to JWT verification).

### Approach

Drive CORS from a comma-separated env var `BC_ALLOWED_ORIGINS`. Both Edge Functions adopt a single helper.

### Interface

```ts
// supabase/functions/_shared/cors.ts
export function resolveCors(req: Request): {
  allow: boolean;
  headers: Record<string, string>;
};

export function corsPreflightResponse(req: Request): Response;
```

`resolveCors` returns:

- `allow: true` and `headers` containing `Access-Control-Allow-Origin: <exact origin echo>` + `Vary: Origin` + the existing `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` when the request's `Origin` header matches an allow-list entry.
- `allow: false` and `headers` containing only `Vary: Origin` (no `Access-Control-Allow-Origin`) when the origin is unmatched or missing.

### Behaviour

- `OPTIONS` preflight: `corsPreflightResponse(req)` returns `204 No Content` with CORS headers when allowed; `403 Forbidden` (with `Vary: Origin`, no ACAO) when not.
- `POST` actual call: function logic runs regardless of CORS outcome (so server-to-server callers without browser CORS still work). The response includes the `resolveCors(req).headers` so a browser caller from a disallowed origin gets the request through but their browser blocks the response from being read — exactly the intended browser-only access boundary.

### Env var

New Supabase secret: `BC_ALLOWED_ORIGINS`, comma-separated. Example values:

- Sandbox: `BC_ALLOWED_ORIGINS=http://localhost:3000,https://nxtclaim-test.example`
- Prod: `BC_ALLOWED_ORIGINS=https://nxtclaim.nxtwave.example`

Reader parses once, caches as `Set<string>`. Trims whitespace. Empty/missing env var → empty set → all origins denied (fail-closed for browsers; server-to-server still works because no ACAO is checked there).

### Files touched

- `supabase/functions/_shared/cors.ts` — rewrite exports.
- `supabase/functions/_shared/bcEnv.ts` — add `allowedOrigins: Set<string>` to the typed env.
- `supabase/functions/bc-vendor-search/index.ts` — swap `CORS_HEADERS`/`corsPreflight()` for `resolveCors(req)`/`corsPreflightResponse(req)`.
- `supabase/functions/bc-payment/index.ts` — same swap; ensure every response (success, dry-run, error) carries the CORS headers from `resolveCors(req)`.

### Operational

The implementer does not deploy. The user must `npx supabase secrets set BC_ALLOWED_ORIGINS=...` and then redeploy the two functions. Documented in the spec's Verification section.

---

## 2. `auditLogId` sentinel cleanup

### Why

`bc-payment/index.ts:114` returns `auditLogId: ""` when the PENDING audit insert itself fails. The empty string is a sentinel hiding an actual missing value. Type honesty: it should be `null`.

### Changes

`supabase/functions/bc-payment/types.ts` — `DB_UPDATE_FAILED` variant becomes:

```ts
| { code: "DB_UPDATE_FAILED"; claimId: string; auditLogId: string | null }
```

`supabase/functions/bc-payment/index.ts`:

- Audit-insert failure → return `auditLogId: null`.
- `complete_bc_payment` failure after BC success → return the real `auditLogId` (string).

`src/modules/claims/ui/bc-payment-modal.tsx` `formatError`: no functional change. The displayed text is identical for both cases ("contact admin"); `auditLogId` is structural data for the runbook + future admin UI.

### Verification

Unit test (Deno) confirming the orchestrator returns `null` when audit insert fails (mock-based; we can't easily trigger this without a broken DB, so a unit test on the error-mapping branch is the right level of coverage).

---

## 3. BC URL asymmetry — code comments

### Why

The two Edge Functions build different-shaped URLs:

- `bc-payment`: `https://api.businesscentral.dynamics.com/v2.0/{environment}/api/Alletec/Claim/v1.0/companies({companyId})/Claims`
- `bc-vendor-search`: `https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/ODataV4/Company('{companyName}')/vendors`

Both are correct per the Postman collections, but the asymmetry is a "what's wrong with this picture" moment for any future maintainer. A drive-by "unification" attempt would break one side.

### Changes

Add a 4-line comment block above the URL construction in each file. Each comment references the corresponding Postman collection as the source of truth.

**`supabase/functions/bc-payment/bcPaymentsClient.ts`** above the URL template:

```ts
// BC's custom Alletec Claim API endpoint shape.
// Source: postman/sandbox/bc-claims-api.postman_collection.json (NxtClaim request).
// Note: this URL does NOT include {tenantId} in the path, unlike the BC vendor
// OData endpoint used by bc-vendor-search. Do not "unify" them.
```

**`supabase/functions/bc-vendor-search/index.ts`** above the URL template:

```ts
// BC's standard OData v4 Vendor entity endpoint shape.
// Source: postman/sandbox/bc-vendor-api.postman_collection.json (GetVendorRequest).
// Note: this URL DOES include {tenantId} in the path, unlike the BC Claims
// API used by bc-payment. Do not "unify" them.
```

### Files touched

- `supabase/functions/bc-payment/bcPaymentsClient.ts`
- `supabase/functions/bc-vendor-search/index.ts`

No behaviour change.

---

## 4. Vendor search documentation (no code change)

### Why

The case-variants workaround in `bc-vendor-search` (OR over as-typed / lowercase / uppercase / capitalize-first) was added because BC's `contains(tolower(Name), 'x')` returned 0 rows for partial substring matches in our testing. The choice to use case-variants instead of investigating `Search Name` should be captured for the next maintainer.

### Changes

**`supabase/functions/bc-vendor-search/index.ts`** — expand the existing comment above the case-variants block to:

```ts
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
```

**`plan_bc.md`** § "BC Vendor Search API" — add a "Known limitation" subsection with the same content (shorter, in user-facing language) so spec readers know what to expect.

### Files touched

- `supabase/functions/bc-vendor-search/index.ts`
- `plan_bc.md`

---

## 5. Playwright E2E for the BC modal flow

### Why

Manual sandbox verification was sufficient for shipping but doesn't protect against regression. An E2E that mocks the Edge Function boundary catches modal-logic + UI wiring drift on every test run.

### Approach

Standard Playwright spec, runs against the local dev server (matching the existing project pattern in `tests/e2e/`). Edge Function calls are intercepted with `page.route()`; no real BC traffic, no real Supabase Edge Function invocation.

### File

`tests/e2e/claims/bc-payment-modal.spec.ts`

### Scenarios (test cases)

1. **`approves Reimbursement claim as non-vendor`** — logs in as a Finance Approver fixture user; navigates to a Reimbursement claim in `HOD approved - Awaiting finance approval`; clicks Approve; modal opens; clicks "Non-Vendor Payment"; mocks `bc-payment` to return `{ok: true, claimId, bcResponses: [{}], auditLogId: "test"}`; clicks Confirm; asserts success toast appears, modal closes, page state updates (Approve button no longer present, status changed).
2. **`approves Reimbursement claim as vendor`** — same start; clicks "Vendor Payment"; mocks `bc-vendor-search` to return `[{no: 'VEN/0001', name: 'Test Vendor'}, ...]`; types in the search; clicks the first result; mocks `bc-payment` success; clicks Confirm; asserts toast + close.
3. **`shows inline error when BC rejects`** — non-vendor flow but mocks `bc-payment` to return `{ok: false, error: {code: "BC_API_ERROR", status: 502, body: "..."}}`; asserts the inline error text "Business Central rejected the request..."; asserts modal stays open and Confirm re-enables.
4. **`blocks duplicate send`** — mocks `bc-payment` to return `{ok: false, error: {code: "ALREADY_SENT", claimId: "..."}}`; asserts the inline error text "This claim has already been sent to Business Central."
5. **`shows empty state when no vendors match`** — Vendor flow; mocks `bc-vendor-search` to return `{vendors: []}`; types a query; asserts the "No vendors match X" empty state is visible.
6. **`disables Confirm during submission`** — non-vendor flow; mocks `bc-payment` with a 200ms delay; clicks Confirm; asserts the button is disabled and shows "Sending to BC…" while the promise is in flight.

### Fixtures and dependencies

- Reuses `tests/global.setup.ts` for the Finance Approver login.
- Test needs a Reimbursement claim seeded in `HOD approved - Awaiting finance approval` status. If a fixture for this doesn't already exist, the test creates one inline via a server action or uses an existing fixture pattern from other claims specs (look at `tests/e2e/claims-workflow.spec.ts` for prior art).
- No DB writes: since BC mocks short-circuit before `complete_bc_payment`, the test claim never transitions and can be reused across runs.

### Verification

`npm run test:e2e -- bc-payment-modal` passes locally against `npm run dev`.

### Files touched

- `tests/e2e/claims/bc-payment-modal.spec.ts` — new
- `tests/global.setup.ts` — only if the existing setup doesn't provide a Finance Approver login (read it first; do not modify if it already covers this)

---

## File inventory

**Modified:**

- `supabase/functions/_shared/cors.ts` — rewrite for origin allow-list
- `supabase/functions/_shared/bcEnv.ts` — add `allowedOrigins` to typed env
- `supabase/functions/bc-vendor-search/index.ts` — CORS swap + comment expansion
- `supabase/functions/bc-payment/index.ts` — CORS swap + sentinel cleanup
- `supabase/functions/bc-payment/types.ts` — `auditLogId: string | null`
- `supabase/functions/bc-payment/bcPaymentsClient.ts` — URL comment
- `plan_bc.md` — vendor search known-limitation subsection

**New:**

- `tests/e2e/claims/bc-payment-modal.spec.ts`

**Optional (only if existing setup doesn't cover it):**

- `tests/global.setup.ts` adjustments

## Verification

After implementation:

1. `npm run typecheck` — exit 0
2. `npm run lint` — exit 0 errors
3. `deno test supabase/functions/_shared/cors.test.ts supabase/functions/bc-payment/payloadBuilder.test.ts supabase/functions/_shared/bcAuth.test.ts` — all pass (if Deno is locally available; otherwise tests are CI-readable)
4. `npm run test:e2e -- bc-payment-modal` — passes against local dev server
5. User sets `BC_ALLOWED_ORIGINS` on the test project and redeploys both Edge Functions
6. User retries the modal flow in the browser — both functions still work from `http://localhost:3000`
7. User curls one of the functions from an arbitrary origin (e.g., via DevTools fetch from a different domain) — browser blocks; sandbox curl with manual Origin header → preflight 403

## Out of scope (named follow-ups)

- Establishing GitHub Actions CI (separate spec).
- Vendor search refactor to use BC `Search Name` field (needs $metadata investigation).
- Bulk approval through BC.
- `BC_CLIENT_SECRET` rotation in Azure AD.
- Backfilling test-project `_migration_history` history into `supabase_migrations.schema_migrations` for the 33 March-2026 migrations (separate cleanup, not blocking).
