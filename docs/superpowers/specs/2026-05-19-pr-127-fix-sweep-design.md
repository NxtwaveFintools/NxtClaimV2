# PR #127 Fix Sweep — Design

**Date:** 2026-05-19
**Branch:** `ForeignC`
**Triggered by:** Code review of PR #127 ("Foreign c") — see [TL;DR in conversation].
**Status:** Approved, ready for implementation plan.

## Goal

Address 7 P0+P1 issues surfaced in the PR #127 code review. All changes remain on `ForeignC`.

## In Scope (7 items)

| #   | Severity | Issue                                                                               |
| --- | -------- | ----------------------------------------------------------------------------------- |
| 1   | P0       | New RPCs lack caller-authorization checks                                           |
| 2   | P0       | `own-edit-schema.ts` rejects foreign-currency claims (basicAmount required > 0)     |
| 3   | P0       | 2-arg `update_claim_by_finance` overload is silently broken by the BEFORE-trigger   |
| 4   | P1       | `CREATE TYPE` in foreign-currency migration is not idempotent                       |
| 5   | P1       | Foreign-currency migration has no rollback file                                     |
| 6   | P1       | `existsExpenseByCompositeKey` collides for all foreign-only claims (total_amount=0) |
| 7   | P1       | Security-invoker migration bundled in PR #127 — decision: **keep on ForeignC**      |

## Out of Scope

- P2 nits (AI prompt rules in `parse-receipt.ts`, three-way `basic+gst` duplication, invariant doc).
- `calculatedTotalAmount` ↔ React Hook Form desync from prior `bc_int` debugging session — needs its own session.
- Splitting the security-invoker migration into a separate PR (user opted to keep bundled).

## Design

### DB-side changes

**New migration:** `supabase/migrations/20260519120000_harden_finance_rpc_authorization.sql`

- `update_claim_by_finance(p_claim_id text, p_actor_id uuid, p_edit_reason text, p_payload jsonb)`:
  preface with `IF NOT EXISTS (SELECT 1 FROM public.master_finance_approvers WHERE user_id = p_actor_id AND is_active = true) THEN RAISE EXCEPTION 'p_actor_id is not an active finance approver'; END IF;` — mirrors the pattern already in `bulk_process_claims`.
- `update_claim_by_submitter(p_claim_id text, p_actor_id uuid, p_payload jsonb)`:
  after the `SELECT INTO v_claim`, add `IF p_actor_id IS DISTINCT FROM v_claim.submitted_by THEN RAISE EXCEPTION 'p_actor_id is not the claim submitter'; END IF;`.
- `DROP FUNCTION IF EXISTS public.update_claim_by_finance(text, jsonb);` — the broken 2-arg overload. Grep confirms zero callers in `src/`.
- Use `CREATE OR REPLACE FUNCTION` so the migration is idempotent.

**Modify in place:** `supabase/migrations/20260518123723_20260518123552_expense_details_foreign_currency.sql`

- Wrap `CREATE TYPE public.local_currency_code AS ENUM (...)` and (if present) `foreign_currency_code` enum creation in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
- Already applied on remote — modifying the file does not change remote state; only fresh-install dev DBs benefit.

**New rollback:** `supabase/rollbacks/20260518123723_20260518123552_expense_details_foreign_currency_rollback.sql`

- Reverse order: drop generated `foreign_total_amount` column → drop `foreign_basic_amount` / `foreign_gst_amount` / `foreign_currency_code` columns → drop enums → restore prior column definitions if any.

**New rollback:** `supabase/rollbacks/20260519120000_harden_finance_rpc_authorization_rollback.sql`

- Recreate the prior 4-arg `update_claim_by_finance` (without auth gate).
- Recreate the prior `update_claim_by_submitter` (without auth gate).
- Recreate the deleted 2-arg `update_claim_by_finance` (its prior body from migration 20260518063735).

### Code-side changes

**`src/modules/claims/validators/own-edit-schema.ts`**

- `basicAmount`: `.positive()` → `.nonnegative()` (or `.min(0)`).
- Add `superRefine` at the schema level: require `basicAmount > 0 OR foreignBasicAmount > 0`; otherwise issue `ctx.addIssue({ path: ["basicAmount"], message: "Either INR amount or foreign currency amount is required" })`. Mirror the pattern from `new-claim-schema.ts:243`.

**Dedup logic — `existsExpenseByCompositeKey` (location TBD during implementation)**

- Extend predicate to include `foreign_currency_code` and `foreign_basic_amount`.
- NULL-safe equality: use `IS NOT DISTINCT FROM` so INR claims (where foreign cols are NULL/default) continue to dedupe by the original tuple.

### Tests

- **Schema test (new or extend existing):** foreign claim with `basicAmount=0`, `foreignBasicAmount>0`, `foreignCurrencyCode='USD'` → passes. INR claim with `basicAmount=0` → fails.
- **Dedup test:** two claims with same `bill_no` + `transaction_date`, one INR one USD → both saved (no collision).
- **RPC integration test:** call `update_claim_by_finance` with a `p_actor_id` that is NOT in `master_finance_approvers` → expect raise. Same for `update_claim_by_submitter` with a non-owner UUID. Only add if a test pattern for RPCs already exists in the repo; otherwise document as a coverage gap.

## Sequencing

1. Write new RPC migration + rollback file.
2. Dry-run: `npx supabase db push --linked --dry-run`.
3. Push: `npx supabase db push --linked`.
4. Verify on remote: query `pg_proc.prosrc` for each function, confirm the auth-check text is present.
5. Regenerate types (or hand-edit) `src/types/database.ts` for the dropped 2-arg overload + new submitter RPC signature.
6. Apply code changes: own-edit schema, dedup query.
7. Add tests.
8. Modify the foreign-currency migration file for idempotency + write its rollback.
9. Run `npm run lint`, `npm run typecheck`, `npm test`.
10. Commit (logical groupings — one commit per fix or sensibly grouped).

## Risks

- **Authorization rollout:** any caller passing a wrong `p_actor_id` will now fail. Before pushing, verify the existing call sites:
  - `SupabaseClaimRepository.ts:2083` — passes `actorId` derived from `auth.getUser()` for finance edit.
  - `SupabaseClaimRepository.updateClaimDetailsBySubmitter` — passes submitter's user ID.
- **Dedup behavior change:** any pre-existing foreign claims in production that bypassed the bug may now newly collide with each other. Mitigation: count pre-existing foreign rows (`SELECT count(*) FROM expense_details WHERE foreign_currency_code IS NOT NULL AND foreign_currency_code <> 'INR'`) before deploying.
- **Type regeneration churn:** `supabase gen types` may emit unrelated diff lines. Mitigation: only commit foreign-currency / RPC-signature changes; revert unrelated drift if it appears.

## Verification (evidence-before-claims)

- Migration applied: query showing both new RPCs exist with auth-check substring present in `pg_proc.prosrc`; query showing the 2-arg overload is gone.
- Schema test, dedup test, RPC test outputs: command + result captured.
- `npm run lint`, `npm run typecheck`, `npm test`: full output, exit codes.
- Post-fix MCP check: call the authed RPC as a non-finance actor, expect raise.
