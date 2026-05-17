# BC Integration Hardening — Design

**Status:** Draft for review
**Date:** 2026-05-18
**Branch:** `bc_int`
**Author:** Arjun Chander (with Claude)

---

## Background

The BC (Microsoft Dynamics 365 Business Central) integration on the `bc_int` branch has shipped end-to-end submission, reference lookups, and vendor search. A comprehensive audit (see `MEMORY.md` and the audit conversation 2026-05-18) surfaced 11 concrete items to address before declaring the integration production-grade.

Items range from observability (P0) to dead-code cleanup (P2) to documentation (P3). They are independent — any subset can ship without blocking the others.

This spec consolidates all 11 into a single design so they can be planned and executed as one connected piece of work.

## Goals

- Make production BC failures debuggable from Supabase function logs alone, with no DB digging.
- Close two real reliability/security gaps: token-refresh on `bc-vendor-search`, and authenticated access on the two read-only edge functions.
- Remove dead code and dead schema introduced during the build-out.
- Document the one residual catastrophic failure path (`RPC_FAILED_AFTER_BC_SUCCESS`) so on-call can recover without re-reading source.

## Non-goals

- No changes to the BC payload shape or business logic in `payloadBuilder.ts`.
- No new features. No UI redesign beyond a small pre-submit validation tweak.
- No changes to RLS policies, indexes, or table schemas (they audited clean).
- No log aggregation, alerting, dashboards. Just structured emission.

---

## Architecture overview

Three edge functions live under `supabase/functions/`:

- `bc-claim/` — POSTs a claim to BC's Custom Alletec Claims API.
- `bc-reference/` — fetches Currency / GST Group / HSN-SAC reference codes via BC OData.
- `bc-vendor-search/` — types-ahead vendor lookup via BC OData.

Shared helpers live in `supabase/functions/_shared/`: `bcAuth.ts`, `bcClient.ts`, `bcEnv.ts`, `cors.ts`. These are the strong-shape parts of the codebase and most of this hardening builds _on top_ of them — no rework of the shared layer.

The hardening work is organized around three themes:

1. **Observability** — uniform structured logging across all 3 functions, via one new `_shared/logger.ts`.
2. **Reliability + Security** — bring `bc-reference` and `bc-vendor-search` up to the same quality bar `bc-claim` already has: JWT auth, `bcClient`-mediated token retry, AbortController timeouts.
3. **Hygiene** — delete dead enums, dead exports, leaked test seams, plus one pre-submit UI guard and one runbook.

---

## The 11 fixes

For each fix below: **what changes**, **why**, **files touched**, **definition of done**.

### Fix 1 — P0 — Structured logging across all 3 edge functions

**What:** Add a tiny `_shared/logger.ts` that emits one-line JSON per event. Each edge function imports it and emits 1–5 log lines per request.

**Why:** Today, a failed BC submission leaves no breadcrumbs in Supabase function logs beyond the HTTP status. The DB rows in `bc_claim_details` hold the full BC payload + response, but you have to know to look. For `bc-reference` and `bc-vendor-search` there is _no_ persisted trail at all.

**Log shape:**

```json
{"ts":"<ISO-8601>","fn":"bc-claim","level":"info|warn|error","event":"<verb>","claim_id":"…","actor":"<user-uuid>","duration_ms":N,"bc_status":N,"error_code":"…","error_detail":"…"}
```

Fields beyond `ts/fn/level/event` are optional and context-specific.

**Events emitted per function:**

| Function           | Events                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bc-claim`         | `request_start`, `payload_loaded`, `attempt_started`, `bc_post_outcome`, `attempt_completed` (or `attempt_failed`, or `catastrophic_rpc_failed_after_bc_success`) |
| `bc-reference`     | `cache_hit` or `bc_fetch_outcome`                                                                                                                                 |
| `bc-vendor-search` | `search_outcome` (query, result count, duration, bc_status)                                                                                                       |

**Logger contract:**

```ts
export function log(
  fn: "bc-claim" | "bc-reference" | "bc-vendor-search",
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
): void;
```

Implementation: `console.log(JSON.stringify({ts: new Date().toISOString(), fn, level, event, ...fields}))`. ~15 lines including types. Supabase ingests `console.log` lines and indexes JSON keys for filtering.

**Redactions:** never log bearer tokens, full request authorization headers, raw BC error bodies beyond first 500 chars.

**Files:**

- New: `supabase/functions/_shared/logger.ts`, `supabase/functions/_shared/logger.test.ts`
- Edit: `bc-claim/index.ts`, `bc-reference/index.ts`, `bc-vendor-search/index.ts`

**Done when:** A failed submission's `claim_id` returns the full attempt timeline when filtered in Supabase logs; sensitive fields confirmed absent.

---

### Fix 2 — P0 — `bc-vendor-search` uses `bcClient`

**What:** Replace the two raw `fetch()` calls in `bc-vendor-search/index.ts` (current lines ~51–64) with calls to the shared `bcClient` helper.

**Why:** `bcClient` automatically retries once on 401 with a refreshed BC OAuth2 token. `bc-claim` already uses it. `bc-vendor-search` does not — so when the cached BC token expires (every ~1 hour), vendor search hard-fails until the function instance restarts or the user refreshes. The other two functions recover transparently.

**Implementation note:** `bcClient` already supports `endpoint: "odata"` and `path: string` — same shape `bc-reference` uses. The two parallel filter requests (`Name` filter and `No` filter) stay as two parallel calls, but each goes through `bcClient`.

**Files:** `supabase/functions/bc-vendor-search/index.ts` only.

**Done when:** Forcing the cached BC token to expire (or waiting >1h) → vendor search continues to work without page refresh.

---

### Fix 3 — P0 — JWT check on `bc-reference` and `bc-vendor-search`

**What:** Add Supabase JWT validation at the top of each handler, matching the pattern in `bc-claim/index.ts`. Return 401 if no/invalid JWT.

**Why:** Both functions currently rely only on the CORS Origin allow-list. Server-to-server callers bypass CORS entirely, so today these endpoints leak BC reference data + vendor master to any caller who knows the URL. CORS is a browser-only protection.

**Implementation:** extract the JWT check from `bc-claim/index.ts` into `_shared/auth.ts` (small refactor — a few lines) so all three functions share the same auth gate. This is the _only_ refactor of `_shared/` in the scope.

**Files:**

- New: `supabase/functions/_shared/auth.ts`
- Edit: `bc-claim/index.ts` (use the new helper), `bc-reference/index.ts`, `bc-vendor-search/index.ts`

**Done when:** `curl …/bc-reference/currencies` without an `Authorization` header → 401. Same call with a valid logged-in user's JWT → 200 with data.

---

### Fix 4 — P1 — Drop orphan enums

**What:** New migration that drops `public.bc_account_type` and `public.bc_employee_transaction_type`.

**Why:** Migration `20260517090000_bc_claim_details_schema.sql:9–11` already DROPped the `bc_payment_audit_log` table that owned these enums, plus 2 of its 4 enums (`bc_payment_audit_status`, `bc_bal_account_type`). It missed the other 2. They're now unreferenced types in the public schema.

**Files:** New migration `supabase/migrations/YYYYMMDDHHmmss_drop_orphan_bc_enums.sql`.

**Done when:** `\dT public.bc_*` in `psql` no longer lists the two enums. `src/types/database.ts` is regenerated (manual `supabase gen types` step) and no longer mentions them.

---

### Fix 5 — P1 — Email BC dev on column widths

**What:** Send the BC developer (off-team) the three column-widening asks documented in the audit:

- `remarks`: 50 → 250
- `No.` columns (`claimNo`, `employeeId`): 20 → 40
- `vendorInvoiceNo`: confirm ≥ 50 (currently unknown — verify)

**Why:** Today `payloadBuilder.ts` truncates `claim_id` and `employee_id` to 20 chars and clips `remarks` to 50. The truncation is documented as "TODO: drop once BC widens." This unblocks that.

**Files:** none in repo. Add a short note (`docs/bc-integration/bc-dev-column-width-ask.md`) capturing the ask + rationale so it's recoverable.

**Done when:** Note committed. Sending the email is the user's action (off-repo).

---

### Fix 6 — P1 — Remove dead exports from `bc-claim/types.ts`

**What:** Two options; pick one:

- **(A)** Delete the unused type exports: `BcDocumentType`, `BcType`, `BcGstCredit`, `BcGstSubcategory`, `BcEmployeeTransactionType`, `BcQuantity`, `BcLocationCode`, `BcReferenceType`, `BcClaimRequestBody`.
- **(B)** Wire them into `payloadBuilder.ts` so the hardcoded literals (`"Invoice"`, `"G/L Account"`, etc.) are typechecked.

**Recommendation:** (B) — costs nothing extra and gains compile-time guarantee that the hardcoded payload values match the type contract.

**Why:** Either way the dead-export state is unfit for prod review.

**Files:** `bc-claim/types.ts`, `bc-claim/payloadBuilder.ts`, `bc-claim/payloadBuilder.test.ts` (update assertions if needed).

**Done when:** `deno check` clean + tests green. No exported type from `types.ts` is unused.

---

### Fix 7 — P2 — Move `__resetCacheForTest()` out of production code

**What:** Move the test seam currently exported from `bc-reference/index.ts` into a co-located test helper module that the test file imports.

**Why:** Test-only exports in production handlers are an accident waiting to happen.

**Files:** `bc-reference/index.ts`, `bc-reference/index.test.ts` (or a new `bc-reference/test-helpers.ts`).

**Done when:** Production `index.ts` exports only the request handler. Tests still pass.

---

### Fix 8 — P2 — AbortController timeouts on `bc-reference` and `bc-vendor-search`

**What:** Wrap their BC fetch calls in `AbortController` with a 30s timeout, matching what `bcClient` already does for `bc-claim`.

**Why:** Today both functions inherit Deno's default 60s fetch timeout, equal to the Supabase edge function budget. A hung BC connection burns the entire request budget before erroring. 30s leaves headroom for our own response composition + logging.

**Implementation note:** Once Fix 2 lands, `bc-vendor-search` will already get this for free via `bcClient`. So Fix 8 effectively reduces to: do the same for `bc-reference`.

**Files:** `bc-reference/index.ts` (and `bc-vendor-search/index.ts` only if Fix 2 didn't fully cover it).

**Done when:** A 30-second hang on the BC side returns a 504-ish error from our function in ≤32s, not 60s.

---

### Fix 9 — P2 — Frontend pre-submit validation in BC claim modal

**What:** In `src/modules/claims/ui/bc-claim-modal.tsx`, disable Submit (with inline error) when `isVendorPayment === true` and any of `currencyCode`, `gstGroupCode`, `hsnSacCode` is empty.

**Why:** Today the modal allows submit with empty reference fields; the edge function would then send a malformed vendor payload that BC rejects with a generic 400. Validate at the UI layer for a clean UX.

**Files:** `src/modules/claims/ui/bc-claim-modal.tsx`.

**Done when:** Vendor mode + any unselected dropdown → Submit disabled with a visible "select all reference codes" hint.

---

### Fix 11 — P0 — BC claim modal UX polish (uses `frontend-design` skill)

**What:** Polish the dropdown-heavy section of `src/modules/claims/ui/bc-claim-modal.tsx` so the experience matches a production-grade finance tool. The implementer invokes the `frontend-design` skill to commit to a bold, intentional aesthetic — not generic shadcn defaults.

**Why:** The audit conversation flagged "lot of drop down, make sure experience is good." Reading the 706-line modal: three reference dropdowns stack vertically full-width, three separate loading spinners fire when Vendor mode is toggled on, and disabled Submit gives no hint why. The combobox itself (`searchable-combobox.tsx`) is solid — the work is around it.

**Specific changes (all in `bc-claim-modal.tsx`):**

1. **Reference dropdowns: responsive grid** — `grid-cols-1 sm:grid-cols-3` instead of `space-y-3` vertical stack (lines 322–349). Three small columns on `sm+`; single column on mobile.
2. **Required indicators** — small asterisk + colored dot on the labels for HSN/SAC, GST Group, Currency, and Vendor. Use the same indigo accent the modal already establishes.
3. **Unified reference loading** — collapse the 3 separate `Loading X…` blocks into a single skeleton row that animates until all three resolve (or any errors). Reduces cognitive load.
4. **Submit hint when disabled** — under the Submit button when `canSubmit === false`, show a one-line helper: "Select all reference codes" or "Select a vendor first", driven by what's actually missing.
5. **"Retry all" affordance** — when 2+ reference dropdowns are in `error` state, replace the per-field Retry buttons with a single "Retry all" CTA at the top of section 03. Keep the per-field retry when only one fails.
6. **Modal viewport containment** — `DialogContent` gets `max-h-[90vh] overflow-y-auto` so stacked error banners never push the dialog off-screen.
7. **Subtle section progress** — the `01/02/03` section eyebrows become filled circles when that section is complete (vendor selected; all 3 refs picked). Today they're decorative.

**Aesthetic direction:** the implementer running `frontend-design` decides between (e.g.) a refined-minimal sharpen of the current look, vs. a more editorial layout with stronger typographic hierarchy. The frontend-design skill is invoked once during implementation, not pre-committed in this spec.

**Files:** `src/modules/claims/ui/bc-claim-modal.tsx` only. No new components. The `SearchableCombobox` (`src/components/ui/searchable-combobox.tsx`) is not changed — it's already strong.

**Non-changes (call out to avoid scope creep):**

- No change to the vendor-picker search/result/pill pattern — it works.
- No change to the 3-phase lifecycle state or error mapping.
- No new component files. All changes inline in the modal file.

**Done when:**

- All 3 reference dropdowns visible on one row at `sm` breakpoint and up.
- Required-field markers visible on the 4 required inputs.
- Submit-disabled hint appears with the correct missing-input message.
- Modal never overflows the viewport regardless of error-banner stack height.
- Manual run against the deployed `bc-claim` edge function shows the full flow (toggle → vendor → references → submit → success) feels noticeably tighter than before.
- All existing modal tests still pass; new tests cover the disabled-hint logic and the "retry all" reveal threshold.

---

### Fix 10 — P3 — `RPC_FAILED_AFTER_BC_SUCCESS` runbook

**What:** Short markdown runbook (~1 page) documenting:

- What this error means (BC accepted the claim but our `complete_bc_claim` RPC failed)
- How to detect it (Supabase logs filter, or rows in `bc_claim_details` with `bc_status='submitting'` older than ~5 minutes)
- How to recover (manual `complete_bc_claim` invocation with the BC response that's already logged)

**Why:** This is the one residual catastrophic path. Rare in practice but high-impact when it happens; on-call needs a written recipe.

**Files:** `docs/bc-integration/runbook-rpc-failed-after-bc-success.md`.

**Done when:** Runbook committed and linked from `docs/bc-integration/README.md` (or whatever index file exists; create if not).

---

## Sequencing

The 11 fixes have shallow dependencies:

- Fix 3 (JWT auth) creates `_shared/auth.ts`. Fix 1 and Fix 2 don't need it, but Fix 1's logger should be in place _before_ Fix 3 so the JWT-failure path is loggable.
- Fix 2 (`bcClient` refactor) and Fix 8 (timeouts) overlap on `bc-vendor-search`; do Fix 2 first to avoid rework.
- Fix 11 (modal UX polish) is independent — touches only the React modal file. Can run in parallel with backend work.
- Fix 9 (pre-submit validation) and Fix 11 both edit the same file. Do Fix 11 first; fold Fix 9's helper text into Fix 11's `submit-disabled hint` so they don't conflict.
- Fixes 4, 5, 6, 7, 10 are fully independent and can be done in any order.

Recommended order: **1 → 2 → 3 → 11 → 6 → 4 → 7 → 8 → 9 → 5 → 10**. Hardest/highest-impact first, docs last.

## Testing strategy

- **Unit:** new `_shared/logger.test.ts`, new `_shared/auth.test.ts`. Each ~5 cases.
- **Integration / manual:** verify each P0 against the deployed `pltbwxddxtsavygijcnl` sandbox edge functions. The 31-row scenario matrix in the audit report is the acceptance set.
- **Existing tests:** `bcAuth.test.ts`, `bcClient.test.ts`, `cors.test.ts`, `payloadBuilder.test.ts` must remain green.

## Risk

Low overall. The largest risk is Fix 6(B) — wiring the dead type exports as literal types — which could surface a previously-hidden mismatch between the hardcoded value and the declared type. That's a _good_ find, not a regression; we adjust whichever is wrong.

Fix 2 changes a hot path (vendor search) — but the new code path goes through a helper that already has test coverage, so the blast radius is contained.

## Out of scope (deferred)

- Token caching beyond per-instance (no Supabase KV-backed shared cache yet).
- Log aggregation, alerting, dashboards.
- BC payload schema changes (waiting on BC dev for column widening).
- Re-introducing bill/bank-statement file URL hints in `remarks` (waits on BC widening).
- Removing `truncBcNo()` truncation (waits on BC widening).
- JSONB redaction for non-finance staff (no such role exists yet).
