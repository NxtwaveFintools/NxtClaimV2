# Amount-column cleanup on `changes`

**Date:** 2026-05-18
**Branch:** `changes`
**Status:** approved for implementation

## Background

The `20260518063735_simplify_amount_columns` migration is applied on the remote DB (`pltbwxddxtsavygijcnl`). It dropped `expense_details.approved_amount` / `advance_details.approved_amount` and renamed `requested_total_amount` to `total_amount` on both tables. The `dropapprovedamount` → `changes` merge brought the simplified application code into `changes`, but three artefacts still reference the dropped columns:

1. `src/types/database.ts` — six type references at lines 57, 74, 91, 725, 756, 787.
2. Three E2E specs query the dropped columns via stringly-typed Supabase selects:
   - `tests/e2e/claims/audit-trail-submission.spec.ts:105`
   - `tests/e2e/claims/fraud-duplicate-detection.spec.ts:90, 127, 145`
   - `tests/e2e/navigation-filter-finance-edit.spec.ts:700`
3. Two unit-test mocks use `requested_total_amount` as a fixture key:
   - `tests/unit/admin/supabase-admin-repository.test.ts:369`
   - `tests/unit/claims/supabase-claim-repository.test.ts:520, 564`

The TypeScript compiler does not catch (1)–(3) because Supabase `select(...)` arguments are strings and the fixture objects are loosely typed. Unit fixtures will not error at runtime (they never hit the DB), but the E2E queries will fail when run.

## Scope

Replace dropped-column references with `total_amount` (or drop them where they were tracking the now-removed `approved_amount`). Verify with type-check, unit tests, and the affected E2E specs.

## Out of scope

- Migration changes (DB state is already correct).
- Behavioural changes to the affected tests beyond the column rename.

## Implementation steps

1. **Regenerate `src/types/database.ts`** via `mcp__claude_ai_Supabase__generate_typescript_types` against project `pltbwxddxtsavygijcnl`. Overwrite the file. Expect `requested_total_amount` references to be replaced by `total_amount` and `approved_amount` references to disappear.
2. **Edit the 3 E2E specs.** For each `.select("requested_total_amount, approved_amount")`, replace with `.select("total_amount")`. For each `.eq("requested_total_amount", value)`, replace the column name with `total_amount`. Update assertion lines that read `row.requested_total_amount` to read `row.total_amount`. Where a test was specifically asserting an `approved_amount` value (cross-checking that approval matched submission), drop that assertion line — `approved_amount` no longer exists as a stored column, and the test will need a different angle of coverage later.
3. **Edit the 2 unit-test mocks.** Replace `requested_total_amount` keys with `total_amount` in fixture objects. Drop `approved_amount` fixture keys.
4. **Verification gate** — run in order, all must pass:
   - `npx tsc --noEmit` — must report 0 errors (parity with the pre-cleanup baseline of 0).
   - `npx vitest tests/unit/admin/supabase-admin-repository.test.ts tests/unit/claims/supabase-claim-repository.test.ts --run` — both files green.
   - `npx playwright test tests/e2e/claims/audit-trail-submission.spec.ts tests/e2e/claims/fraud-duplicate-detection.spec.ts tests/e2e/navigation-filter-finance-edit.spec.ts` — all three green (with the Next.js dev server running on :3000 against the test Supabase project).
5. **Commit** all edits in a single commit: `chore: drop residual approved_amount/requested_total_amount refs after column simplification`.
6. **Push** to `origin/changes`.

## Rollback

The work is small and isolated to test files + a regenerated types file. If E2E run uncovers semantic issues with a test (i.e., a test was actually verifying `approved_amount` behaviour), the change to that file is reverted via `git checkout HEAD~1 -- <path>` and the test is escalated to a follow-up (approach C in the brainstorm) rather than blocking this cleanup.

## Success criteria

- `git grep "requested_total_amount\|approved_amount" -- src/ tests/` returns no matches outside `docs/`.
- All three verification gates pass.
- Branch `changes` pushed.
