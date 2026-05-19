# PR #127 Cleanup Pass — Design

**Date:** 2026-05-19
**Branch:** `ForeignC`
**Triggered by:** Remaining items from PR #127 code review after the P0+P1 fix sweep (see `2026-05-19-pr-127-fix-sweep-design.md`).
**Status:** Approved, ready for implementation plan.

## Goal

Close out the residual P2 nits from the PR #127 code review and resolve the 20 pre-existing CI test failures that were already failing on `ForeignC` before the P0+P1 sweep landed.

## In Scope (4 items)

| #                     | Item                                                                                                                                               | Strategy                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1 + P2.4           | Resolve AI prompt RULE 7 vs RULE 8 inconsistency in `parse-receipt.ts` + add "currency_code = always INR" invariant doc comment                    | Small surgical edits                                                                                                                                                                                                                                                                                                                                    |
| P2.2                  | De-duplicate `total = basic + gst` computation across DB generated column, finance-edit form, new-claim form                                       | Extract `computeInrTotal` / `computeForeignTotal` helpers in a new `src/modules/claims/utils/compute-totals.ts` (or co-located file matching repo convention); replace inline math in both forms                                                                                                                                                        |
| P2.3                  | `calculatedTotalAmount` ↔ React Hook Form state desync (surgical, time-boxed)                                                                      | Drive DOM display from `useWatch` value instead of locally computed; ensure all `setValue` calls pass `{ shouldValidate: true, shouldDirty: true }`; use the helper from P2.2. **Time-box: 60 minutes**; if unresolved, snapshot current state in this spec file, revert P2.3 changes only, keep the rest.                                              |
| Pre-existing failures | 20 tests across 4 suites — `actions.test.ts`, `parse-receipt.action.test.ts`, `finance-edit-claim-form.test.tsx`, `new-claim-form-client.test.tsx` | Investigation-driven. Likely root causes: (a) `totalAmount` field in `.strict()` schema fixtures, (b) `getByLabelText(/Basic Amount/i)` matching both INR and Foreign labels post-PR-127, (c) prompt-related expectations that change after P2.1. Fix each by either updating the fixture/selector OR fixing the production code, decided case-by-case. |

## Out of Scope

- Approach B for P2.3 (Controller migration) — too large for this pass.
- Any new features or unrelated refactors.
- Tests beyond what's needed to verify the changes.

## Approach for each item

### P2.1 — AI prompt alignment

Read `parse-receipt.ts` around RULES 7 and 8 (approximately lines 400–430 per the original code review). Identify the contradictory null-handling guidance. Choose one consistent semantic (`null` always means "absent", or always means "explicit empty") and apply to both rules. The choice should not change observable behavior for existing receipt formats — the goal is to stop telling the AI two different things.

### P2.4 — Invariant doc

Add a single comment block in `src/core/domain/claims/contracts.ts` near the expense type definitions (around the `PreparedClaimSubmission` or expense detail interface) explaining:

> Invariant: `currency_code` on `expense_details` is always `'INR'` (the `local_currency_code` enum only permits `'INR'`). Non-INR settlements are encoded via `foreign_currency_code` + `foreign_basic_amount` + `foreign_gst_amount`. The INR-side amounts (`basic_amount`, `cgst/sgst/igst_amount`, `total_amount`) represent the INR settlement amount, which is 0 for a foreign-only invoice until reconciled from a bank statement.

Mirror a short version in the header comment of `supabase/migrations/20260518123723_..._expense_details_foreign_currency.sql` (already has a partial design doc reference; expand with the invariant statement).

### P2.2 — Extract shared total helper

Create `src/modules/claims/utils/compute-totals.ts` exporting two pure functions:

```ts
export function computeInrTotal(input: {
  basic: number;
  cgst: number;
  sgst: number;
  igst: number;
}): number {
  return Math.round((input.basic + input.cgst + input.sgst + input.igst) * 100) / 100;
}

export function computeForeignTotal(input: { basic: number; gst: number }): number {
  return Math.round((input.basic + input.gst) * 100) / 100;
}
```

Replace inline math in:

- `src/modules/claims/ui/new-claim-form-client.tsx` (`calculatedTotalAmount`, `foreignTotalAmount` computation)
- `src/modules/claims/ui/finance-edit-claim-form.tsx` (`roundCurrency(foreignBasicAmount + foreignGstAmount)`)

The DB `foreign_total_amount` generated column remains the source of truth; these helpers are display-only mirrors.

Add a unit test `tests/unit/claims/compute-totals.test.ts` covering rounding edge cases.

### P2.3 — Form-state desync (surgical, time-boxed)

In `src/modules/claims/ui/new-claim-form-client.tsx`:

1. Replace `value={calculatedTotalAmount.toFixed(2)}` on the totalAmount display field with the value driven by `useWatch({ name: "expense.totalAmount" })`. The DOM and form state then read from one source.
2. Ensure the `useEffect` that calls `setValue("expense.totalAmount", ...)` passes `{ shouldValidate: true, shouldDirty: true }` so dependent watchers fire consistently.
3. Replace the inline `basicAmount + cgst + sgst + igst` math with the new `computeInrTotal` helper from P2.2.
4. Mirror the same pattern for `foreignTotalAmount`.
5. Verify the DOM-vs-state coupling by:
   - Running the `new-claim-form-client.test.tsx` suite — if `getByLabelText(/Basic Amount/i)` errors clear up, that's a smoking gun the desync was contributing.
   - Manually opening the form in a dev server is OUT of scope for this pass (no browser instrumentation here); rely on the test suite.

**Time-box:** Spend at most 60 minutes on P2.3. If after 60 minutes the change either:

- doesn't compile / typecheck, OR
- regresses any test that was passing before, OR
- doesn't measurably improve the failing `new-claim-form-client.test.tsx` cases —

then snapshot the current state in this spec file under a "P2.3 attempt result" section, revert the P2.3 commit (keep P2.1/2.2/2.4), and proceed to the pre-existing failures phase.

### Pre-existing failures — investigation-driven fixes

For each failing test in the 4 suites:

1. Read the test name and the failure message.
2. Categorize:
   - **Fixture stale** (e.g., test fixture has fields the new schema rejects): update the fixture.
   - **Selector ambiguous** (e.g., new "Foreign Basic Amount" label collides with `/Basic Amount/i`): tighten the selector.
   - **Production regression** (e.g., the new code path returns a different shape than the test asserts): fix the code if the test was right, fix the test if the test was wrong.
3. Flag any case where the categorization is unclear.

Suspected pattern (from observation 919): the `own-edit-schema.ts` strict mode rejects `totalAmount` in form-data fixtures. If true, the right fix is to either (a) drop `totalAmount` from the fixture (it's a generated/derived value) or (b) loosen the schema. Per the existing invariant that the DB generates `total_amount`, removing it from fixtures is the right call.

## Sequencing

1. **P2.1 + P2.4** → single commit (`docs/fix: align AI prompts and document invariant`)
2. **P2.2** → single commit (`refactor: extract compute-totals helper`)
3. **P2.3** → single commit, time-boxed (`fix: drive total display from form state`)
4. **Pre-existing failures** → commit per fixed suite (`test: fix <suite>`)

## Verification (evidence-before-claims)

- `npm run lint` exit 0
- `npm run typecheck` exit 0
- New `compute-totals.test.ts` passes
- All 9 previously-added tests from the P0+P1 sweep still pass
- Pre-existing 20-test failure backlog: each suite explicitly addressed — fixed or documented with reason
- Final `npm run test:unit` output captured (count and any remaining failures explained)
- `git push origin ForeignC` succeeds
- PR comment summary posted to #127

## Risks

- **P2.3 might not yield in the time-box.** Mitigation: explicit time-box + revert-on-failure protocol. Other 3 items are independent and worth landing regardless.
- **P2.2 refactor could regress amount math.** Mitigation: dedicated unit test for the helper + full test-suite run after.
- **Fixture updates could mask real bugs.** Mitigation: per-case categorization. If unsure whether a failure is fixture-vs-code, flag and ask before committing.
- **The 4 failing suites may interact.** Fixing one might surface or resolve issues in another (especially with P2.3 potentially affecting form-component tests). Re-run full suite after each fix.

## Out-of-scope reminders (carried forward from prior spec)

- Splitting the security-invoker migration into a separate PR (user opted to keep bundled).
- Migrating `updateClaimDetailsBySubmitter` to use the new `update_claim_by_submitter` RPC (it currently uses direct table writes; the new RPC is defense-in-depth for when that path migrates).
