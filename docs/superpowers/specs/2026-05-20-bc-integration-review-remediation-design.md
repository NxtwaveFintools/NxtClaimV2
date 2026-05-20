# BC Integration Review Remediation — Design

**Date:** 2026-05-20
**Branch:** `bc_int` (PR #120 → `development`)
**Author:** arjun (with Claude)

## Context

A four-reviewer pass over PR #120 (the Business Central integration: edge functions,
SECURITY DEFINER RPCs, migrations, payment/reference modal) produced ~20 findings
(5 merge-blockers, 6 important, plus minors/nits/test-gaps). This spec defines the
remediation for **all** of them.

## Decisions (locked with the user)

1. **Scope:** Everything — blockers + important + minor + nits + test-coverage gaps.
2. **Migration strategy:** New **append-only** corrective migration. Do not edit
   already-applied migration files (they ran against the NxtClaimTest remote).
3. **Status gate:** A BC submission is allowed only when the claim status is
   `'HOD approved - Awaiting finance approval'`. Anything else → distinct error.
4. **CORS finding:** Document that auth is the real gate (no behavior change). All
   endpoints are auth-gated; enforcing 403 on Origin risks breaking server-to-server
   callers that omit `Origin`.
5. **Vendor `Ammount` when `foreign_basic_amount === 0`:** **Fall back to
   `db.basic_amount`** (mirror the non-vendor path). This is a financial logic change.
6. **10-year signed-URL expiry:** Deliberate — keep behavior, add a rationale comment.

## Discoveries

- `SearchableCombobox` is used once (`bc-claim-modal.tsx:796`) but serves all three
  reference fields via `ReferenceField`. Only HSN also has a server-debounced search
  box on top → the duplicate. Fix: suppress the combobox's internal search for the
  HSN (searchable) field only.
- There is **no `.github/workflows/`** in the repo, so the department-mapping
  "CI guard" currently guards nothing. Code change: integration tests **fail when
  `process.env.CI` is set but secrets are missing** (skip only locally).

## Workstreams

Each workstream is independently testable. TDD throughout (RED → GREEN → REFACTOR).

### A. Database — new migration `supabase/migrations/20260520040000_bc_payload_status_gate_and_search_path.sql`

Wrapped in `BEGIN/COMMIT`.

- Recreate `get_bc_claim_payload` with:
  - `SET search_path = public, pg_temp` **baked into the function definition**
    (closes blocker #1 skip-risk; the standalone `...020000` pin becomes redundant).
  - **Status gate:** if claim status ≠ `'HOD approved - Awaiting finance approval'`,
    `RAISE EXCEPTION USING ERRCODE = 'P0005', MESSAGE = 'INVALID_CLAIM_STATE'`
    (blocker #2). Keep existing `is_active = true` and `bc_claim_details_id IS NULL`
    checks (ordering: existing checks first, then status gate, per current message
    contract — see acceptance criteria).
- Recreate `start_bc_claim_attempt`, `complete_bc_claim`, `record_bc_claim_failure`
  with `search_path` baked into the definition + reaffirm
  `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` and
  `GRANT EXECUTE ... TO service_role` (closes #3).
- **lock_timeout (important):** the `claims` table rewrite already ran; this is now
  advisory. Add a one-line note to `docs/runbooks/` (or the migration header) that
  future `ALTER COLUMN TYPE` on large tables should set `lock_timeout`.

**Acceptance:** dry-run the migration against NxtClaimTest; verify the four functions
have the pinned `search_path` (`pg_proc.proconfig`), the grant matrix is service_role
-only, and `get_bc_claim_payload` rejects a non-eligible-status claim with P0005.

### B. Edge functions — shared modules

- `_shared/bcSearch.ts`: add `escapeOdataLiteral(value: string): string` — doubles
  `'` and strips control chars (`\x00-\x1F`). Make it the single escape source.
  (blocker #3)
- `_shared/bcAuth`/callers: `bc-vendor-search/index.ts` and `bc-reference/index.ts`
  use `escapeOdataLiteral()` instead of inline `.replace(/'/g, "''")`.
- `_shared/bcSearch.test.ts`: add tests asserting `'`-doubling and control-char
  stripping (replaces the test that documented quotes are preserved).
- `_shared/auth.ts`: `requireFinanceApprover` returns a `{ ok: false; status: 403;
code: "FORBIDDEN" }` variant for authenticated-but-unauthorized (was 401). Update
  callers + `auth.test.ts`. (minor)
- `_shared/cors.ts`: doc comment — `allow` is browser-display advisory; auth is the
  enforcement gate. (CORS decision)

### C. Edge functions — handlers / payload

- `bc-claim/index.ts`:
  - Map `P0005` → `{ code: "INVALID_CLAIM_STATE", status: 409 }`.
  - **Check & log the `record_bc_claim_failure` RPC result** on both failure paths
    (lines ~217, ~239); surface a distinct log/code if it errors. (blocker #4)
  - Add `INTERNAL_ERROR` code for non-`P0003` 500 fallthroughs (lines ~129, ~190)
    so infra failures don't masquerade as `MISSING_MAPPING`. (minor)
  - Comment that `bcVendorName` is display-only (the vendor `code` is authoritative).
- `bc-claim/payloadBuilder.ts`:
  - `paymentRequired`: `db.payment_mode_name?.trim().toLowerCase() === "reimbursement"`.
    (important)
  - **Vendor `Ammount` fallback:** `isVendorPayment ? (db.foreign_basic_amount > 0 ?
db.foreign_basic_amount : db.basic_amount) : ...`. (decision #5)
- `bc-vendor-search/index.ts`:
  - Prioritize exact code (`No`) matches before name matches in the 20-result merge.
    (minor)
  - Guard `Deno.serve` with `if (import.meta.main)`. (nit)
- `bc-reference/index.ts`: use `escapeOdataLiteral()` (see B).

### D. Frontend

- `src/components/ui/searchable-combobox.tsx`:
  - Add `enableSearch?: boolean` (default `true`); when `false`, render the option
    list without the internal search input.
  - Update the stale doc comment (no 16k virtualization; HSN is server-`$top=20`).
  - Remove genuinely-unused props (`emptyText`, and `maxVisible` if unused). (nit)
- `src/modules/claims/ui/bc-claim-modal.tsx`:
  - `ReferenceField` passes `enableSearch={!isSearchable}` → kills HSN double-search.
    (important)
  - `allRefsLoading`: gate on `status === "loading"` only (not `"idle"`). (important)
  - Add `void` to floating `fetchReference` calls in Retry-all / `onRetry`. (nit)
  - Runtime-guard the `result as {…}` cast in the submit handler. (nit)
  - `VendorPicker`: add `role="listbox"`/`role="option"` + arrow-key navigation. (minor)
- `src/core/domain/claims/ExportClaimsService.ts`: add the 10-year-URL rationale
  comment (match `page.tsx`). (nit, no behavior change)

### E. Tests (coverage gaps)

- Handler tests for `bc-claim/index.ts`: auth gate, P0001/P0002/P0003/P0005 →
  status-code mapping, `23505` → `ALREADY_IN_FLIGHT`, and the
  `RPC_FAILED_AFTER_BC_SUCCESS` catastrophic path.
- `payloadBuilder.test.ts`: vendor-path `foreign_basic_amount === 0` → asserts
  fallback to `basic_amount` (decision #5).
- Frontend RTL test for the debounced-search `cancelled` cleanup (stale responses
  dropped on rapid query changes).

### F. Integration-test gating (blocker #5)

For the 4 BC integration files (`bc-claim-rpc`, `bc-rpc-anon-lockdown`,
`department-mapping-completeness`, `bc-edge-deployment`): when required env vars are
missing, **fail if `process.env.CI` is set**, otherwise skip (local dev). A shared
helper encapsulates the check.

## Out of scope / no change

- 10-year signed-URL expiry value (deliberate; comment only).
- CORS 403 enforcement (documented instead, per decision #4).
- `dept-mapping-guard.ts` logic (reviewed clean).
- Editing already-applied migration files.

## Testing strategy

- Deno tests for `supabase/functions/**` (`deno test`), Jest for `src/**` and
  `tests/**`, `tsc --noEmit`, `eslint`.
- Migration dry-run + verification queries against NxtClaimTest (read-only checks).
- Full claims unit suite must stay green; new tests for each behavior change.

## Risks

- The vendor `Ammount` fallback changes a financial value — covered by a dedicated
  test and is a deliberate decision.
- The status gate could reject legitimate flows if other entry points submit at a
  different status; mitigated by matching the existing UI gate + `isPendingFinanceApprovalStatus`.
