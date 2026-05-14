# BC Integration — Expand from Reimbursement to All Expense Modes

**Date**: 2026-05-14
**Branch**: `bc_int`
**Status**: Design approved, awaiting written-spec review before plan handoff.

## Problem

The BC payment integration shipped scoped to a single payment mode: `reimbursement`. Operationally we want every **expense** payment mode to route through BC on Finance Approve. Advance payment modes (`petty cash request`, `bulk petty cash request`) must remain on the existing direct Finance Approve flow.

## Scope

**In scope — route through BC on Finance Approve:**

- `reimbursement` (already live)
- `corporate card`
- `happay`
- `forex`
- `petty cash`

This set matches the `EXPENSE_PAYMENT_MODE_NAMES` constant already defined in `src/core/constants/payment-modes.ts`.

**Out of scope — keep direct Finance Approve, no BC routing:**

- `petty cash request`
- `bulk petty cash request`

**Out of scope for this design (named follow-ups):**

- Bulk Finance Approve through BC. The current bulk path continues to call `approveFinanceAction` directly for every selected claim, regardless of mode. A separate plan will retrofit bulk.
- New payment modes beyond the five listed. Adding more later requires another migration + a constant update; not free.

## Pre-implementation audit (test Supabase project `pltbwxddxtsavygijcnl`, 2026-05-14)

A full audit of the BC infrastructure was run before this design was finalised. **No new tables, enums, columns, indexes, triggers, or RLS policies are needed for this expansion.** Every required object is already in place from the original BC drop:

**Enums** (all present):

- `bc_account_type` — `Employee`, `Vendor`
- `bc_bal_account_type` — `G/L Account`
- `bc_employee_transaction_type` — `ADVANCE` (single-value, intentionally reused across all expense modes per the requirements call)
- `bc_payment_audit_status` — `PENDING`, `SUCCESS`, `FAILED`

**Tables**:

- `bc_payment_audit_log` — `id`, `claim_id` (FK→`claims.id`, no cascade), `idempotency_key` (UUID UNIQUE), `status`, `payload_json`, `bc_response_json`, `error_message`, `created_at`, `resolved_at`. RLS enabled, no policies (service-role-only). Indexes on `(status, created_at)` and `(claim_id)`.
- `bc_claim_vendors` — `id`, `claim_id` (FK→`claims.id`, ON DELETE CASCADE), `bc_vendor_id` (NULLABLE ✓), `bc_vendor_name` (NULLABLE ✓), `created_at`, `updated_at` with maintenance trigger. RLS enabled, 1 policy. Index on `claim_id`.
- `claims` — `bc_payments_flag BOOLEAN NOT NULL DEFAULT false` and `is_vendor_payment BOOLEAN NOT NULL DEFAULT false` columns already present and exposed by `vw_admin_claims_dashboard` and `vw_enterprise_claims_dashboard`.

**Functions**:

- `get_bc_claim_payload(text) → jsonb` — `STABLE`, `SECURITY INVOKER`, `search_path = public`.
- `complete_bc_payment(text, uuid, boolean, text, text, uuid, jsonb) → void` — volatile, `SECURITY INVOKER`, `search_path = public`. Inserts into `claim_audit_logs` with `action_type = 'L2_APPROVED'`; this is mode-agnostic, no change needed.

**Cascading triggers**: `master_expense_categories.is_active` and `expense_category_bc_mappings.is_active` are kept in sync via two triggers (`sync_bc_mapping_active_from_category`, `sync_category_active_from_bc_mapping`). Already wired, no change needed.

**Migrations on the canonical tracker** match the 5 `.sql` files on `bc_int`: `20260513150000`, `20260513151000`, `20260513152000`, `20260513153000`, `20260513154000`.

### Assumption-1 verification — `expense_details` coverage

The current `get_bc_claim_payload` reads from `expense_details` (filtered by `is_active = true`). Confirmed every expense mode populates this table:

| Payment mode       | Claims | With `expense_details` | With ACTIVE `expense_details` |
| ------------------ | -----: | ---------------------: | ----------------------------: |
| Petty Cash         |   2150 |            2150 (100%) |                    1944 (90%) |
| Reimbursement      |   2052 |             2016 (98%) |                    1846 (90%) |
| Corporate Card     |     84 |              84 (100%) |                      64 (76%) |
| Happay             |     15 |              15 (100%) |                     15 (100%) |
| Forex              |      6 |               6 (100%) |                      6 (100%) |
| Petty Cash Request |    128 |                  **0** |                         **0** |

### Assumption-2 verification — `bc_code` mapping coverage

The function joins `expense_category_bc_mappings` (NOT `master_expense_categories.bc_code` directly) for the BC account code. Confirmed full coverage for every active claim across all 5 in-scope modes:

| Payment mode   | Active claims | With `bc_code` mapping | Missing |
| -------------- | ------------: | ---------------------: | ------: |
| Petty Cash     |          1944 |            1944 (100%) |       0 |
| Reimbursement  |          1748 |            1748 (100%) |       0 |
| Corporate Card |            64 |              64 (100%) |       0 |
| Happay         |            15 |              15 (100%) |       0 |
| Forex          |             6 |               6 (100%) |       0 |

Conclusion: the expansion is safe to enable for all 5 modes today. No operational backlog of missing mappings, no schema gaps.

## Approach

**Selected: Hard-code the 5 expense modes inside the DB function and gate the frontend with the existing `isExpensePaymentModeName(...)` helper.**

Rejected alternatives:

- Adding a `master_payment_modes.bc_eligible` boolean column. Over-engineering for 5 rows; introduces a runtime toggle without a code-review trail.
- Gating only in the frontend. Loses the DB-level safety net that the current Reimbursement-only design has — anyone calling the Edge Function directly (admin tool, future script) could send an ineligible claim.

The selected approach preserves the existing two-layer guarantee (UI + DB), keeps the diff small, and reuses an existing well-tested constant set.

## Changes

### 1. New DB migration — additive, forward-only

**File**: `supabase/migrations/20260514HHMMSS_expand_bc_payment_modes.sql`

`CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT) RETURNS JSONB`. Same signature, same `SECURITY INVOKER`, same `STABLE`, same `search_path`. The only behavioural change is the payment-mode gate.

Before:

```sql
IF lower(trim(coalesce(v_payment_mode_name, ''))) <> 'reimbursement' THEN
  RETURN jsonb_build_object('error', 'NOT_REIMBURSEMENT',
                            'payment_mode', coalesce(v_payment_mode_name, '<null>'));
END IF;
```

After:

```sql
IF lower(trim(coalesce(v_payment_mode_name, ''))) NOT IN (
     'reimbursement', 'corporate card', 'happay', 'forex', 'petty cash'
   ) THEN
  RETURN jsonb_build_object('error', 'NOT_EXPENSE_MODE',
                            'payment_mode', coalesce(v_payment_mode_name, '<null>'));
END IF;
```

The error variant name moves from `NOT_REIMBURSEMENT` to `NOT_EXPENSE_MODE` so the typed error remains truthful when an ADVANCE-mode claim is rejected.

**Why a new migration, not editing `20260513152000_get_bc_claim_payload.sql`:** the test Supabase project already has the original applied. Editing a historical migration creates drift between tracked SQL and deployed function definition. Forward-only is the project's existing pattern.

### 2. Edge Function — `bc-payment`

**`supabase/functions/bc-payment/index.ts`**

In `mapDbError(...)`, rename the case:

```ts
if (e === "NOT_EXPENSE_MODE")
  return errResp(
    corsHeaders,
    { code: "NOT_EXPENSE_MODE", paymentMode: String(p.payment_mode) },
    400,
  );
```

**`supabase/functions/bc-payment/types.ts`**

In the `BcPaymentError` discriminated union, rename the variant:

```ts
| { code: "NOT_EXPENSE_MODE"; paymentMode: string }
```

No new fields, no structural change, no new error code.

**Untouched in this Edge Function:**

- `payloadBuilder.ts` — pure, mode-agnostic. All 9 existing unit tests stay green without changes.
- `bcPaymentsClient.ts` — HTTP layer, no mode awareness.
- The `employeeTransactionType: "ADVANCE"` constant in the payload — confirmed unchanged by the requirements call.

### 3. Edge Function — `bc-vendor-search`

No changes. Vendor search is mode-agnostic.

### 4. Shared

`_shared/bcAuth.ts`, `_shared/bcEnv.ts`, `_shared/cors.ts`, `_shared/cors.test.ts` — all untouched.

### 5. Frontend — interceptor

**`src/modules/claims/ui/claim-decision-action-form.tsx`**

Replace the Reimbursement-only check with the existing helper:

```ts
// before
const isReimbursementApprove =
  isFinanceApprove && normalizePaymentModeName(paymentModeName) === PAYMENT_MODE_REIMBURSEMENT;

// after
const isExpenseModeApprove = isFinanceApprove && isExpensePaymentModeName(paymentModeName);
```

The downstream branch that decides whether to mount `<BcPaymentModal>` references the renamed boolean. Import the `isExpensePaymentModeName` helper from `src/core/constants/payment-modes.ts`; drop the now-unused `PAYMENT_MODE_REIMBURSEMENT` import if no other reference remains.

### 6. Frontend — BC modal

**`src/modules/claims/ui/bc-payment-modal.tsx`**

In `formatError(...)`, rename the case to `NOT_EXPENSE_MODE` and update the user-facing copy to _"This payment mode isn't eligible for Business Central."_ Drop the `NOT_REIMBURSEMENT` case (no longer emitted).

No layout change. The Vendor-vs-Non-Vendor toggle stays as-is — confirmed meaningful for all 5 modes.

## Tests

- **Deno unit tests**:
  - `payloadBuilder.test.ts` — no change (mode-agnostic). All 9 tests continue to pass.
  - `cors.test.ts` — no change.
- **No new automated test for `mapDbError`**: the rename is a literal string match (`"NOT_EXPENSE_MODE"`). A unit test would only assert that string equals itself. Coverage is the manual sandbox probe in Step 3 below, which exercises the full DB → Edge Function → typed-error path against a real Petty Cash Request claim.
- **Playwright `bc-payment-modal.spec.ts`** — no change. The 6 scenarios mock the Edge Function response shape and are mode-agnostic.

## Manual sandbox verification

After deploying the migration and Edge Function to the test Supabase project (`pltbwxddxtsavygijcnl`):

1. Pick one Finance-approvable claim each in: `corporate card`, `happay`, `forex`, `petty cash`. Walk through the BC modal and confirm:
   - Modal opens on Finance Approve.
   - Both Non-Vendor and Vendor paths complete.
   - BC accepts the line(s).
   - Audit row in `bc_payment_audit_log` lands `SUCCESS`.
   - Claim status transitions to `Finance Approved - Payment under process`.
2. Pick a Finance-approvable claim in `petty cash request`. Click Finance Approve:
   - Confirm the BC modal does **not** open.
   - Confirm the standard `approveFinanceAction` flow runs.
3. Direct Edge Function probe — invoke `bc-payment` with a `petty cash request` claim payload. Expect `NOT_EXPENSE_MODE` response, no BC call, no audit row created.

## Deployment

1. Land the code changes on `bc_int` (this branch).
2. Apply the new migration to the test Supabase project via `supabase db push` or MCP `apply_migration`.
3. Redeploy the `bc-payment` Edge Function. `bc-vendor-search` is untouched — skip its redeploy.
4. Run the manual sandbox verification above.
5. When this eventually merges to `development` and lands in prod, repeat steps 2–4 against the prod Supabase project.

No CORS, secret, or env-variable changes. No new env vars.

## Risks

- **Risk**: a new-mode claim is missing its `bc_code` mapping in `expense_category_bc_mappings` (active row joined on `expense_category_id`), causing a `MISSING_MAPPING` response. Likelihood: low — Assumption-2 verification above shows 100% coverage across all 5 in-scope modes on the test DB today. Mitigation: this is the existing typed-error path; the modal already surfaces "Mapping missing — contact admin." Failure mode is identical to today's Reimbursement behaviour.
- **Risk**: a non-Reimbursement claim has only inactive `expense_details` rows. Mitigation: existing typed error `EXPENSE_DETAILS_MISSING` already covers this; user retries after operations marks a row active.
- **Risk**: the renamed error code surfaces somewhere we missed. Mitigation: a grep for `NOT_REIMBURSEMENT` across the repo is a one-step task in the plan.

No new attack surface, no new secrets, no schema additions, no RLS changes.

## Out of scope — explicit reminders

- Bulk Finance Approve through BC (follow-up plan).
- Adding any payment mode beyond the five enumerated above.
- Changes to `employeeTransactionType` per mode — stays `"ADVANCE"`.
- Any change to the Vendor-vs-Non-Vendor modal flow.
- Any change to `bc-vendor-search`.
