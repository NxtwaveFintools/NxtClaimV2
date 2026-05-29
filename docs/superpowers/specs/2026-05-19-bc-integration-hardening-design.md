# BC Integration Hardening — Design

**Date:** 2026-05-19
**Branch:** `bc_int`
**Audience:** reviewers of the hardening PR, future engineers debugging BC

## Problem

A post-deploy audit of the BC integration (live on NxtClaimTest) surfaced three issues of decreasing severity:

1. **Critical bug.** `claims.submission_type` is stored as `'Self'` / `'On Behalf'` (verified across 4,529 rows). The BC code compares against `'On_behalf'` (underscore, lowercase b) in two places — `get_bc_claim_payload` RPC and `payloadBuilder.ts`. Every on-behalf claim that ever submits to BC will send the **submitter's** employee_id + name instead of the beneficiary's. Today 1,129 on-behalf claims are waiting; zero have been BC-submitted yet, so blast radius is currently zero — but the next finance approval of any on-behalf claim ships wrong data.

2. **Silent latent failure.** Nine active departments lack the `master_department_responsible_mappings` row required by `get_bc_claim_payload`. Any BC submission for a claim in those departments will fail with `MISSING_MAPPING` (P0003). Departments: Content Marketing, Graphic Design, Management, Marketing, NXTINTERN, Tech, Test, test_tech_team, Testing.

3. **Improvement.** `bc-reference?type=hsnSacCodes` returns the full HSN/SAC list (BC has 10k+ rows) on every cold cache load. Currencies (~150) and GST groups (~30) are fine as-is.

## Goals

- Close the on-behalf bug so the first on-behalf BC submission sends the right person.
- Add a CI-visible signal when ops adds an active department without a BC mapping.
- Make HSN/SAC search-as-you-type so the dropdown is fast even with large BC tables.

## Non-goals

- Backfilling the 9 unmapped departments (ops decision, not engineering).
- Reworking currencies / GST group dropdowns (small data, fine as-is).
- Building a reconciliation cron for catastrophic "BC accepted but our RPC failed" rows (separate spec).
- Changing storage URL strategy or remarks formatting (shipped in the previous batch).

## Architecture

Three independent units, each independently testable and revertable. All land in a single stacked PR on `bc_int`.

```
┌─ Fix A2 ─ submission_type enum + correct literals everywhere ──────┐
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Migration: create enum, recreate views + CHECK, fix RPC  │      │
│  └──────────────────────────────────────────────────────────┘      │
│         │                                                          │
│         ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ TS code: payloadBuilder.ts + types.ts + test fixtures    │      │
│  └──────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────┘

┌─ Fix B1 ─ Department mapping completeness as test ─────────────────┐
│                                                                    │
│  ┌─────────────────────────┐    ┌─────────────────────────────┐    │
│  │ Unit test (mocked repo) │    │ Integration test (real DB)  │    │
│  └─────────────────────────┘    └─────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘

┌─ Fix C ─ HSN/SAC search-as-you-type (edge fn + frontend) ──────────┐
│                                                                    │
│  ┌─────────────────────────┐    ┌─────────────────────────────┐    │
│  │ bc-reference: accept    │ ←─ │ bc-claim-modal: switch HSN  │    │
│  │ ?query=, $top=20 (HSN)  │    │ to debounced search pattern │    │
│  └─────────────────────────┘    └─────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Fix A2 — submission_type enum

### Why enum (vs. just fixing the string literal)

The DB already has `claims_submission_type_check CHECK (submission_type IN ('Self', 'On Behalf'))`, so the bug isn't "no enforcement." The bug is that the BC code compares against a literal the DB never produces. We could fix this without an enum.

Choosing the enum buys:

- **Schema-level vocabulary** — the type name documents the allowed values to anyone reading the schema.
- **Tighter Supabase-generated TypeScript types** — `submission_type` becomes `"Self" | "On Behalf"` instead of `string`. The bug would have surfaced at TypeScript compile time if the enum had existed when the BC code was written.
- **Drift prevention across schemas** — if another table or function ever needs the same vocabulary, the enum becomes the single source of truth.

### What the DB validation found (relevant inputs)

| Check                                               | Result                                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Distinct values in 4,529 rows                       | exactly `'Self'` (3,400) and `'On Behalf'` (1,129)                                                                               |
| NULLs / whitespace anomalies                        | 0 / 0                                                                                                                            |
| Other tables with `submission_type` column          | none                                                                                                                             |
| Indexes on `claims.submission_type`                 | none                                                                                                                             |
| Views referencing `claims.submission_type`          | `vw_admin_claims_dashboard`, `vw_enterprise_claims_dashboard` (both project the column; neither compares to a literal)           |
| CHECK constraints involving the column              | `claims_submission_type_check` (simple IN-list), `claims_on_behalf_fields` (cross-field, references `'On Behalf'::text` literal) |
| Functions referencing the bad `'On_behalf'` literal | only `public.get_bc_claim_payload`                                                                                               |
| Existing enum named `claim_submission_type`         | none — safe to create                                                                                                            |

### Migration

Single file: `supabase/migrations/<ts>_claim_submission_type_enum.sql`. All steps in one transaction:

1. `DROP VIEW vw_admin_claims_dashboard` and `vw_enterprise_claims_dashboard` (Postgres requires this before `ALTER COLUMN TYPE`; both view defs are pasted verbatim into the migration for recreation in step 5).
2. `DROP CONSTRAINT claims_submission_type_check` (redundant after enum).
3. `DROP CONSTRAINT claims_on_behalf_fields` (references `'On Behalf'::text` — needs recreation with enum-aware comparison).
4. `CREATE TYPE public.claim_submission_type AS ENUM ('Self', 'On Behalf');`
5. `ALTER TABLE public.claims ALTER COLUMN submission_type TYPE public.claim_submission_type USING submission_type::text::public.claim_submission_type;`
6. Recreate `claims_on_behalf_fields` CHECK using `submission_type = 'On Behalf'::claim_submission_type` (and same for `'Self'`).
7. Recreate `vw_admin_claims_dashboard` and `vw_enterprise_claims_dashboard` from captured definitions (no change to view bodies — they SELECT the column unchanged).
8. `CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(...)` with the corrected `CASE WHEN c.submission_type = 'On Behalf'::claim_submission_type`.

Estimated lock window on `claims`: sub-second at 4,529 rows. Whole migration runs in one transaction so partial failure rolls back.

### Code changes (4 files)

| File                                                 | Change                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `supabase/functions/bc-claim/payloadBuilder.ts`      | Line ~60: `db.submission_type === "On_behalf"` → `=== "On Behalf"`                   |
| `supabase/functions/bc-claim/types.ts`               | `submission_type: "Self" \| "On_behalf"` → `"Self" \| "On Behalf"`                   |
| `supabase/functions/bc-claim/payloadBuilder.test.ts` | All fixture/test strings `"On_behalf"` → `"On Behalf"` (3 occurrences)               |
| `src/types/database.ts`                              | Regenerated via `supabase gen types typescript --linked` after the migration applies |

### Tests (TDD)

| RED                                                                                                                                                                                                                                                       | GREEN                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `payloadBuilder.test.ts` — on-behalf fixture with `submission_type: "On Behalf"` + `on_behalf_employee_code: "NW0009999"` asserts `line.employeeId === "NW0009999"`. Fails today (current code matches `"On_behalf"`, falls through to `db.employee_id`). | Flip the literal in `payloadBuilder.ts`.      |
| Integration test against test DB — call `get_bc_claim_payload(claimId)` for an on-behalf claim, expect `employee_name` to be the beneficiary's full_name. Fails today (RPC's CASE never matches).                                                         | Migration recreates RPC with correct literal. |

### Rollback

To reverse post-deploy:

```sql
BEGIN;
DROP VIEW vw_admin_claims_dashboard; DROP VIEW vw_enterprise_claims_dashboard;
ALTER TABLE public.claims ALTER COLUMN submission_type TYPE text USING submission_type::text;
DROP TYPE public.claim_submission_type;
-- recreate the two CHECK constraints and the two views
COMMIT;
```

---

## Fix B1 — department mapping completeness test

### Why two test layers

- **Unit test** runs in every CI invocation without needing a test DB. Catches regressions in the guard logic itself (e.g., someone changes the SQL or the empty/non-empty assertion).
- **Integration test** is the actual signal — it queries the live test DB. Failing red means there are unmapped active departments in NxtClaimTest right now. Ops backfills, test goes green. Future drift (someone adds a department without mapping) re-fails it.

Both are needed because the unit test alone wouldn't catch real ops drift, and the integration test alone wouldn't catch a code change that breaks the guard.

### Unit test

Location: `src/core/domain/claims/__tests__/dept-mapping-guard.test.ts`

Approach:

- Define a `getUnmappedActiveDepartments(repo): Promise<string[]>` function in `src/core/domain/claims/DeptMappingGuard.ts` that takes a minimal repo interface (one method: `findUnmappedActiveDepartments(): Promise<{ name: string }[]>`).
- Mock the repo. Test cases:
  - Repo returns `[]` → function returns `[]`. Caller can decide pass/fail.
  - Repo returns `[{ name: 'Tech' }, { name: 'Marketing' }]` → function returns `['Tech', 'Marketing']`.
  - Repo throws → function rethrows (no silent swallowing).

### Integration test

Location: `tests/integration/department-mapping-completeness.test.ts`

Approach:

- Uses the existing integration test harness (admin Supabase client against `NxtClaimTest`, env-gated via `INTEGRATION_TESTS=1` — mirrors `tests/integration/rpc-auth-gates.test.ts`).
- Runs:
  ```sql
  SELECT d.name FROM master_departments d
  LEFT JOIN master_department_responsible_mappings drm
         ON drm.department_id = d.id AND drm.is_active = true
  WHERE d.is_active = true AND drm.department_id IS NULL
  ORDER BY d.name
  ```
- Asserts result is empty. If non-empty, includes the list of names in the failure message so ops sees exactly what to backfill.
- Today: fails with the 9 known departments. CI shows red until ops backfills.

### Why not block deploys

The integration test is gated by `INTEGRATION_TESTS=1`, so it only runs in the dedicated integration job (same pattern as `rpc-auth-gates.test.ts`). Local `npm test` and the unit test job stay fast and don't depend on a live DB. Treat the integration-test failure as a P2 ops ticket, not a deploy blocker.

---

## Fix C — HSN/SAC search-as-you-type

### Why HSN/SAC only

| Reference       | Approx rows          | Action                                         |
| --------------- | -------------------- | ---------------------------------------------- |
| currencies      | ~150                 | leave as-is (full list + 15-min cache is fine) |
| gstGroupCodes   | ~30                  | leave as-is                                    |
| **hsnSacCodes** | **10,000+ possible** | switch to search-as-you-type                   |

### Edge function changes (`supabase/functions/bc-reference/index.ts`)

New URL contract:

```
GET /bc-reference?type=hsnSacCodes&query=996   → ≤20 case-insensitive matches on Code OR Description
GET /bc-reference?type=hsnSacCodes              → first 20 (no query) — used for "open dropdown" empty state
GET /bc-reference?type=currencies               → unchanged (full list)
GET /bc-reference?type=gstGroupCodes            → unchanged (full list)
```

Implementation pattern (mirrors `bc-vendor-search` exactly so reviewers have one shape to learn):

- Read `query` param; trim; ignore if `type !== 'hsnSacCodes'`.
- Build case variants (`as-typed`, `lower`, `UPPER`, `Capitalised`) the same way vendor-search does — works around BC's flaky `tolower()` in OData.
- BC filter: `(contains(Code,'$v') or contains(Description,'$v')) or …` ORed across variants.
- Always `$select=Code,Description` and `$top=20`.
- Cache key: `${type}::${query}` so a query for "996" doesn't poison the no-query cache. Cache TTL stays 15 min.

### Frontend changes (`src/modules/claims/ui/bc-claim-modal.tsx`)

The vendor-search pattern in the same file (lines 138–165) is the reference implementation. HSN gets the same treatment:

- Replace the `hsnSacs.options` "load once, render all" state with `{ query, debouncedQuery, options, status }`.
- Use the existing `useDebouncedValue` hook (300ms — same as vendor search).
- New `useEffect`: when `paymentType === "vendor"` and `debouncedQuery.trim().length > 0`, call `fetchReference("hsnSacCodes", { query: debouncedQuery }, setHsnSacs)`.
- When `debouncedQuery` is empty, show helper text "Type to search HSN/SAC codes" instead of the dropdown body.
- On vendor toggle: still pre-fetch currencies + GST groups; do NOT pre-fetch HSN.
- `fetchReference` signature gains an optional `params` object (passed as query-string for GET).

### Tests

- **Edge fn** (deno test): mock `bcFetch` to assert that `?query=996` results in an OData URL with the correct contains() OR-of-variants filter and `$top=20`; assert no-query path doesn't include `$filter`; assert non-HSN types ignore `query`.
- **Frontend** (jest + RTL): render BcClaimModal in vendor mode, type "996" into HSN search, advance debounce timer, assert `fetchReference` was called with `{ query: "996" }` exactly once.

---

## Testing approach summary

| Fix | Where                                                              | What                                                                                                                |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| A2  | `supabase/functions/bc-claim/payloadBuilder.test.ts`               | RED: on-behalf fixture asserts beneficiary is sent. GREEN after literal fix.                                        |
| A2  | `tests/integration/bc-claim-rpc.test.ts` (new)                     | RED: invoke `get_bc_claim_payload` on real on-behalf claim, expect beneficiary name. GREEN after migration applies. |
| B1  | `src/core/domain/claims/__tests__/dept-mapping-guard.test.ts`      | Unit: guard function behavior with mocked repo.                                                                     |
| B1  | `tests/integration/department-mapping-completeness.test.ts`        | RED today (9 unmapped depts), GREEN after ops backfills.                                                            |
| C   | `supabase/functions/bc-reference/__tests__/index.test.ts`          | Deno: assert OData URL shape for HSN with/without query.                                                            |
| C   | `src/modules/claims/ui/__tests__/bc-claim-modal.test.tsx` (extend) | React: typing in HSN box fires debounced fetch.                                                                     |

---

## Rollout

- Single stacked PR on `bc_int`, one commit per fix:
  1. `feat(bc): submission_type enum + fix On Behalf literal across RPC and edge fn`
  2. `test(claims): add department mapping completeness guard (unit + integration)`
  3. `feat(bc-reference): HSN/SAC search-as-you-type (edge fn + modal wiring)`
- Migration applies to NxtClaimTest first via `supabase db push --linked`; verify the on-behalf RPC test goes green; then redeploy `bc-claim` and `bc-reference` edge functions.
- Don't merge to `development` until the user explicitly approves (consistent with prior rounds).

## Risk register

| Risk                                             | Mitigation                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration locks `claims` table too long          | 4,529 rows + no indexes on the column = sub-second alter. Run during low-traffic window if user prefers.                                       |
| View recreate misses a column the original had   | Migration uses verbatim `pg_get_viewdef()` output. Adding a CI check that diffs view defs is overkill for one-shot recreation.                 |
| Frontend HSN UX changes catch a user mid-flow    | Reference data only loads when Finance opens the BC modal — no in-flight forms to disrupt.                                                     |
| HSN edge fn cache poisoning across queries       | Cache key includes the query string. Different queries = different cache entries.                                                              |
| Integration test fails CI permanently            | Gated by `INTEGRATION_TESTS=1`; doesn't run in default `npm test` or `test:unit`. Ops fixes the 9 depts → test goes green.                     |
| Type regeneration ripples through unrelated code | `submission_type` becomes a union type instead of `string`. All current call sites already pass `"Self"` or `"On Behalf"` (verified via grep). |

## Out of scope (will track separately if needed)

- Reconciliation job for `bc_status='submitting'` rows stuck after catastrophic RPC failure.
- Removing the BC remarks signed-URL leakage window (would require either making the bucket public or adding a proxy endpoint).
- Pagination / "load more" for HSN/SAC dropdown — `$top=20` + search should cover the common case; revisit if users complain.

## References

- `supabase/functions/bc-claim/payloadBuilder.ts` (current bug location)
- `supabase/migrations/20260517074656_bc_claim_functions.sql` (RPC with wrong literal)
- `supabase/functions/bc-vendor-search/index.ts` (reference pattern for search edge fn)
- `tests/integration/rpc-auth-gates.test.ts` (reference pattern for env-gated integration test)
- `src/modules/claims/ui/bc-claim-modal.tsx` lines 138–165 (reference pattern for debounced search in same file)
