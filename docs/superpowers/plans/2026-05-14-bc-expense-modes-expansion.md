# BC Expense Modes Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every expense payment mode (Reimbursement, Corporate Card, Happay, Forex, Petty Cash) through Business Central on Finance Approve; reject advance modes with a renamed typed error.

**Architecture:** Two-layer gate — widen the payment-mode check inside the DB function `get_bc_claim_payload` and swap the frontend interceptor to use the existing `isExpensePaymentModeName(...)` helper. Rename the typed error variant `NOT_REIMBURSEMENT` → `NOT_EXPENSE_MODE` so it stays truthful. No new tables, enums, columns, indexes, RLS policies, or files — only one additive forward-only SQL migration plus four mechanical TypeScript edits.

**Tech Stack:** PostgreSQL (PL/pgSQL functions), Supabase CLI migrations, Supabase Edge Functions (Deno + TypeScript + Zod), Next.js 16 / React 19 client.

---

## File Structure

**Created:**

- `supabase/migrations/<ts>_expand_bc_payment_modes.sql` — `CREATE OR REPLACE` of `get_bc_claim_payload` with the widened gate, renamed error variant, and updated in-DB `COMMENT ON FUNCTION` block.

**Modified:**

- `supabase/functions/bc-payment/types.ts:54` — rename one variant in the `BcPaymentError` discriminated union.
- `supabase/functions/bc-payment/index.ts:184-189` — rename one case in `mapDbError()`.
- `src/modules/claims/ui/claim-decision-action-form.tsx:8-11, 44-47, 60, 100` — swap gate from `=== PAYMENT_MODE_REIMBURSEMENT` to `isExpensePaymentModeName(...)`.
- `src/modules/claims/ui/bc-payment-modal.tsx:315-326` — add a `NOT_EXPENSE_MODE` case in `formatError()`.

**Unchanged but verified compatible:**

- `supabase/functions/bc-payment/payloadBuilder.ts` + `payloadBuilder.test.ts` — pure, mode-agnostic, 9 unit tests stay green.
- `supabase/functions/bc-payment/bcPaymentsClient.ts` — HTTP-only, no mode awareness.
- `supabase/functions/bc-vendor-search/index.ts` — read-only, mode-agnostic.
- `supabase/functions/_shared/*` — auth, env, CORS unchanged.
- `tests/e2e/claims/bc-payment-modal.spec.ts` — 6 Playwright scenarios mock the Edge Function response shape, mode-agnostic.

---

## Tasks

### Task 1: Edge Function — rename error variant `NOT_REIMBURSEMENT` → `NOT_EXPENSE_MODE`

`types.ts` and `index.ts` are coupled — they must change together for TypeScript to compile. Single task with both edits.

**Files:**

- Modify: `supabase/functions/bc-payment/types.ts:54`
- Modify: `supabase/functions/bc-payment/index.ts:184-189`

- [ ] **Step 1: Edit `types.ts` — rename the union variant**

In `supabase/functions/bc-payment/types.ts`, change line 54 from:

```ts
  | { code: "NOT_REIMBURSEMENT"; paymentMode: string }
```

to:

```ts
  | { code: "NOT_EXPENSE_MODE"; paymentMode: string }
```

- [ ] **Step 2: Edit `index.ts` — rename the case label in `mapDbError`**

In `supabase/functions/bc-payment/index.ts`, replace lines 184-189:

```ts
if (e === "NOT_REIMBURSEMENT")
  return errResp(
    corsHeaders,
    { code: "NOT_REIMBURSEMENT", paymentMode: String(p.payment_mode) },
    400,
  );
```

with:

```ts
if (e === "NOT_EXPENSE_MODE")
  return errResp(
    corsHeaders,
    { code: "NOT_EXPENSE_MODE", paymentMode: String(p.payment_mode) },
    400,
  );
```

- [ ] **Step 3: Verify TypeScript compiles**

Run from repo root:

```bash
deno check supabase/functions/bc-payment/index.ts supabase/functions/bc-payment/types.ts
```

Expected: clean exit, no diagnostics.

- [ ] **Step 4: Run existing Deno tests**

Run:

```bash
deno test --allow-env supabase/functions/bc-payment/payloadBuilder.test.ts supabase/functions/_shared/cors.test.ts supabase/functions/_shared/bcAuth.test.ts
```

Expected: all tests pass. No new tests are added for this rename — it is a literal string match (no behaviour change), covered end-to-end by the manual sandbox probe in Task 6.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bc-payment/types.ts supabase/functions/bc-payment/index.ts
git commit -m "refactor(bc-payment): rename NOT_REIMBURSEMENT error variant to NOT_EXPENSE_MODE"
```

---

### Task 2: Frontend — switch the interceptor gate to the expense-mode helper

**Files:**

- Modify: `src/modules/claims/ui/claim-decision-action-form.tsx:8-11, 44-47, 60, 100`

- [ ] **Step 1: Update the import statement**

In `src/modules/claims/ui/claim-decision-action-form.tsx`, replace lines 8-11:

```ts
import {
  PAYMENT_MODE_REIMBURSEMENT,
  normalizePaymentModeName,
} from "@/core/constants/payment-modes";
```

with:

```ts
import { isExpensePaymentModeName } from "@/core/constants/payment-modes";
```

(`PAYMENT_MODE_REIMBURSEMENT` and `normalizePaymentModeName` have no other references in this file — removing both.)

- [ ] **Step 2: Rename the boolean and use the helper**

Replace lines 44-47:

```ts
const isReimbursementApprove =
  decision === "approve" &&
  claimId !== undefined &&
  normalizePaymentModeName(paymentModeName) === PAYMENT_MODE_REIMBURSEMENT;
```

with:

```ts
const isExpenseModeApprove =
  decision === "approve" && claimId !== undefined && isExpensePaymentModeName(paymentModeName);
```

- [ ] **Step 3: Rename the two downstream references**

Replace line 60:

```ts
    if (isReimbursementApprove) {
```

with:

```ts
    if (isExpenseModeApprove) {
```

Replace line 100:

```tsx
      {isReimbursementApprove && claimId ? (
```

with:

```tsx
      {isExpenseModeApprove && claimId ? (
```

- [ ] **Step 4: Verify TypeScript compiles**

Run:

```bash
npm run typecheck 2>&1 | tail -30
```

Expected: clean exit, no errors involving `claim-decision-action-form.tsx`.

- [ ] **Step 5: Lint the changed file**

Run:

```bash
npx eslint src/modules/claims/ui/claim-decision-action-form.tsx
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/claims/ui/claim-decision-action-form.tsx
git commit -m "feat(claims): route all expense payment modes to BC on Finance Approve"
```

---

### Task 3: Frontend — add `NOT_EXPENSE_MODE` case to modal error formatter

**Files:**

- Modify: `src/modules/claims/ui/bc-payment-modal.tsx:315-326`

The current `formatError` has no `NOT_REIMBURSEMENT` case (the interceptor in Task 2 means the modal only opens for eligible modes, so this error code wouldn't have surfaced in practice). The new `NOT_EXPENSE_MODE` case is added as defensive coverage for race-condition or admin-tool scenarios.

- [ ] **Step 1: Add the new case in `formatError`**

In `src/modules/claims/ui/bc-payment-modal.tsx`, replace lines 315-326:

```ts
function formatError(error: unknown, data: unknown): string {
  const e = (data as { error?: { code?: string } } | undefined)?.error;
  if (e?.code === "ALREADY_SENT") return "This claim has already been sent to Business Central.";
  if (e?.code === "MISSING_MAPPING")
    return `Missing mapping: ${(data as { error: { field: string } }).error.field}. Contact admin.`;
  if (e?.code === "MISSING_BC_CODE") return "Expense category has no BC account code configured.";
  if (e?.code === "DB_UPDATE_FAILED")
    return "Payment was sent to Business Central but our records could not be updated. Please contact admin.";
  if (e?.code === "BC_API_ERROR")
    return "Business Central rejected the request. Please contact admin.";
  return (error as Error | undefined)?.message ?? "Something went wrong. Please try again.";
}
```

with:

```ts
function formatError(error: unknown, data: unknown): string {
  const e = (data as { error?: { code?: string } } | undefined)?.error;
  if (e?.code === "ALREADY_SENT") return "This claim has already been sent to Business Central.";
  if (e?.code === "NOT_EXPENSE_MODE")
    return "This claim's payment mode isn't eligible for Business Central.";
  if (e?.code === "MISSING_MAPPING")
    return `Missing mapping: ${(data as { error: { field: string } }).error.field}. Contact admin.`;
  if (e?.code === "MISSING_BC_CODE") return "Expense category has no BC account code configured.";
  if (e?.code === "DB_UPDATE_FAILED")
    return "Payment was sent to Business Central but our records could not be updated. Please contact admin.";
  if (e?.code === "BC_API_ERROR")
    return "Business Central rejected the request. Please contact admin.";
  return (error as Error | undefined)?.message ?? "Something went wrong. Please try again.";
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
npm run typecheck 2>&1 | tail -30
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add src/modules/claims/ui/bc-payment-modal.tsx
git commit -m "feat(bc-modal): handle NOT_EXPENSE_MODE error code"
```

---

### Task 4: Write the new SQL migration

**Files:**

- Create: `supabase/migrations/<ts>_expand_bc_payment_modes.sql`

The migration `CREATE OR REPLACE`s `get_bc_claim_payload` with: (1) the widened payment-mode gate; (2) the renamed error variant; (3) the updated in-DB `COMMENT ON FUNCTION` block. Same function signature (`(p_claim_id TEXT) RETURNS JSONB`), same `STABLE`, `SECURITY INVOKER`, `search_path TO 'public'`. Wrapped in `BEGIN ... COMMIT` to match the surrounding migration style.

- [ ] **Step 1: Generate the filename timestamp**

Run:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
echo "supabase/migrations/${TS}_expand_bc_payment_modes.sql"
```

Use that printed path in Step 2. (Do not reuse a hard-coded timestamp — Supabase tracks each file by its filename version.)

- [ ] **Step 2: Create the migration file**

Write the file at the path printed in Step 1, with this exact content:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_claim                RECORD;
  v_expense              RECORD;
  v_payment_mode_name    TEXT;
  v_bc_code              TEXT;
  v_program_code         TEXT;
  v_sub_product_code     TEXT;
  v_responsible_dept     TEXT;
  v_beneficiary_dept     TEXT;
  v_region_code          TEXT;
BEGIN
  SELECT c.id, c.employee_id, c.department_id, c.payment_mode_id,
         c.bc_payments_flag, c.is_active
    INTO v_claim
    FROM public.claims c
   WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'CLAIM_NOT_FOUND', 'claim_id', p_claim_id);
  END IF;

  SELECT name INTO v_payment_mode_name
    FROM public.master_payment_modes
   WHERE id = v_claim.payment_mode_id;

  IF lower(trim(coalesce(v_payment_mode_name, ''))) NOT IN (
       'reimbursement', 'corporate card', 'happay', 'forex', 'petty cash'
     ) THEN
    RETURN jsonb_build_object('error', 'NOT_EXPENSE_MODE',
                              'payment_mode', coalesce(v_payment_mode_name, '<null>'));
  END IF;

  SELECT ed.purpose, ed.receipt_file_path, ed.bank_statement_file_path,
         ed.approved_amount, ed.expense_category_id, ed.product_id, ed.location_id
    INTO v_expense
    FROM public.expense_details ed
   WHERE ed.claim_id = p_claim_id AND ed.is_active = true
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'EXPENSE_DETAILS_MISSING', 'claim_id', p_claim_id);
  END IF;

  SELECT bc_code INTO v_bc_code
    FROM public.expense_category_bc_mappings
   WHERE expense_category_id = v_expense.expense_category_id AND is_active = true
   LIMIT 1;
  -- bc_code may be NULL here; non-vendor flow errors at the Edge Function, vendor flow allows it.

  SELECT program_code INTO v_program_code
    FROM public.master_program_product_mappings
   WHERE product_id = v_expense.product_id AND is_active = true
   LIMIT 1;
  IF v_program_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'nwProgramCode',
                              'product_id', v_expense.product_id);
  END IF;

  SELECT sub_product_code INTO v_sub_product_code
    FROM public.master_sub_product_mappings
   WHERE product_id = v_expense.product_id AND is_active = true
   LIMIT 1;
  IF v_sub_product_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'subProductCode',
                              'product_id', v_expense.product_id);
  END IF;

  SELECT responsible_department_code, beneficiary_department_code
    INTO v_responsible_dept, v_beneficiary_dept
    FROM public.master_department_responsible_mappings
   WHERE department_id = v_claim.department_id AND is_active = true
   LIMIT 1;
  IF v_responsible_dept IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'responsibleDepartment',
                              'department_id', v_claim.department_id);
  END IF;

  SELECT region_code INTO v_region_code
    FROM public.master_expense_location_mappings
   WHERE location_id = v_expense.location_id AND is_active = true
   LIMIT 1;
  IF v_region_code IS NULL THEN
    RETURN jsonb_build_object('error', 'MISSING_MAPPING', 'field', 'regionCode',
                              'location_id', v_expense.location_id);
  END IF;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'employee_id', v_claim.employee_id,
    'bc_payments_flag', v_claim.bc_payments_flag,
    'approved_amount', v_expense.approved_amount,
    'purpose', v_expense.purpose,
    'receipt_file_path', v_expense.receipt_file_path,
    'bank_statement_file_path', v_expense.bank_statement_file_path,
    'expense_category_id', v_expense.expense_category_id,
    'bc_code', v_bc_code,
    'program_code', v_program_code,
    'sub_product_code', v_sub_product_code,
    'responsible_department_code', v_responsible_dept,
    'beneficiary_department_code', v_beneficiary_dept,
    'region_code', v_region_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bc_claim_payload(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_bc_claim_payload(TEXT) IS
$comment$
Returns one of the following JSONB shapes for the given claim_id:

Success: {
  claim_id, employee_id, bc_payments_flag, approved_amount, purpose,
  receipt_file_path, bank_statement_file_path, expense_category_id,
  bc_code, program_code, sub_product_code,
  responsible_department_code, beneficiary_department_code, region_code
}

Error variants:
  { error: 'CLAIM_NOT_FOUND', claim_id }
  { error: 'NOT_EXPENSE_MODE', payment_mode }
  { error: 'EXPENSE_DETAILS_MISSING', claim_id }
  { error: 'MISSING_MAPPING', field: 'nwProgramCode',         product_id }
  { error: 'MISSING_MAPPING', field: 'subProductCode',        product_id }
  { error: 'MISSING_MAPPING', field: 'responsibleDepartment', department_id }
  { error: 'MISSING_MAPPING', field: 'regionCode',            location_id }

Eligible payment modes (expense modes only):
  reimbursement, corporate card, happay, forex, petty cash

bc_code may be null in success output; non-vendor flow rejects null
bc_code at the Edge Function, vendor flow ignores it.
$comment$;

COMMIT;
```

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/*_expand_bc_payment_modes.sql
git commit -m "feat(db): widen BC payment gate from reimbursement to all expense modes"
```

---

### Task 5: Apply migration + deploy Edge Function to test project

**Test Supabase project ref:** `pltbwxddxtsavygijcnl`

Production deployment is intentionally out of scope for this plan — it is a follow-up after sandbox passes.

- [ ] **Step 1: Apply the new migration**

If you have Supabase MCP access, invoke `mcp__claude_ai_Supabase__apply_migration` with:

- `project_id`: `pltbwxddxtsavygijcnl`
- `name`: `expand_bc_payment_modes`
- `query`: the full SQL body from Task 4 Step 2 (everything between and including the `BEGIN;` / `COMMIT;`)

Otherwise from the repo:

```bash
supabase db push --project-ref pltbwxddxtsavygijcnl
```

- [ ] **Step 2: Verify the function definition reflects the new gate**

Run via MCP `execute_sql` (or `psql`):

```sql
SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_bc_claim_payload';
```

Expected: function body contains
`NOT IN ('reimbursement', 'corporate card', 'happay', 'forex', 'petty cash')`
and the literal `'NOT_EXPENSE_MODE'`.

- [ ] **Step 3: Verify the COMMENT block is updated**

```sql
SELECT obj_description(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_bc_claim_payload';
```

Expected: contains the line `{ error: 'NOT_EXPENSE_MODE', payment_mode }` and the new "Eligible payment modes (expense modes only)" section.

- [ ] **Step 4: Deploy the `bc-payment` Edge Function**

If you have Supabase MCP access, invoke `mcp__claude_ai_Supabase__deploy_edge_function` with:

- `project_id`: `pltbwxddxtsavygijcnl`
- `slug`: `bc-payment`
- All 5 files from `supabase/functions/bc-payment/` plus the shared imports.

Otherwise:

```bash
supabase functions deploy bc-payment --project-ref pltbwxddxtsavygijcnl
```

`bc-vendor-search` is unchanged. **Do NOT redeploy `bc-vendor-search`.**

- [ ] **Step 5: Smoke-test the deployed function via dry-run**

Pick a known Petty Cash claim ID from the test DB. In the browser DevTools console with a logged-in Finance Approver session at `https://nxt-claim.vercel.app` (or `http://localhost:3000`), run:

```js
const { data, error } = await window.supabase.functions.invoke("bc-payment", {
  body: {
    claimId: "<paste a known petty cash claim id>",
    isVendorPayment: false,
    dryRun: true,
  },
});
console.log({ data, error });
```

Expected: `data.ok === true`, `data.dryRun === true`, `data.wouldSend` is a single-item array with `accountType: "Employee"` and a non-empty `balAccountNo` equal to that claim's `bc_code`.

If you get `{ ok: false, error: { code: "NOT_EXPENSE_MODE", ... } }`, the migration didn't apply — recheck Step 2 first.

---

### Task 6: Manual sandbox verification

Each step is one Finance-approvable claim from the test DB. Run them in order. If any step fails, STOP and roll back before continuing.

- [ ] **Step 1: Real-send — Corporate Card claim, non-vendor**

Pick a Finance-approvable Corporate Card claim. Click **Approve**. In the BC modal: choose **Non-Vendor Payment**, click **Confirm**. Expected:

- Toast: "Sent to Business Central".
- Modal closes.
- Claim status becomes `Finance Approved - Payment under process`.
- One row appears in `bc_payment_audit_log` with `status='SUCCESS'` for this claim_id.
- One row appears in `bc_claim_vendors` with `bc_vendor_id IS NULL` and `bc_vendor_name IS NULL`.

- [ ] **Step 2: Real-send — Happay claim, vendor flow**

Pick a Finance-approvable Happay claim. Approve → **Vendor Payment** → search for a known sandbox vendor → click result → Confirm. Expected:

- `bc_payment_audit_log` row with `status='SUCCESS'`, `bc_response_json` contains 2 elements (Employee line + Vendor line).
- `bc_claim_vendors` row with non-NULL `bc_vendor_id` and `bc_vendor_name`.
- Claim `is_vendor_payment` is now `true`.

- [ ] **Step 3: Real-send — Forex claim, non-vendor**

Same procedure as Step 1, on a Forex claim. Same expectations.

- [ ] **Step 4: Real-send — Petty Cash claim, non-vendor**

Same procedure as Step 1, on a Petty Cash claim. Same expectations.

- [ ] **Step 5: Negative — Petty Cash Request (ADVANCE) stays on direct flow**

Pick a Finance-approvable Petty Cash Request claim. Click **Approve**. Expected:

- BC modal does NOT open.
- Standard `approveFinanceAction` runs (toast "Approving claim..." → "Claim approved").
- Claim `bc_payments_flag` remains `false`.
- No new row in `bc_payment_audit_log` for this claim.

- [ ] **Step 6: Direct Edge-Function probe — ADVANCE rejection**

From the browser console (Finance Approver session):

```js
const { data } = await window.supabase.functions.invoke("bc-payment", {
  body: {
    claimId: "<a petty cash request claim id>",
    isVendorPayment: false,
  },
});
console.log(data);
```

Expected: `{ ok: false, error: { code: "NOT_EXPENSE_MODE", paymentMode: "Petty Cash Request" } }`. No row inserted into `bc_payment_audit_log` (verify with `SELECT COUNT(*) FROM bc_payment_audit_log WHERE claim_id = '<claim>'` — count unchanged).

- [ ] **Step 7: Regression — Reimbursement still works**

Approve one Reimbursement claim end-to-end (the original mode). Same expectations as Step 1. This confirms the rename + gate widening didn't break the existing path that's been live since 2026-05-13.

---

## Self-Review Checklist

**Spec coverage:**

- DB migration with widened gate + COMMENT update → Task 4 ✓
- `types.ts` rename → Task 1 Step 1 ✓
- `index.ts` `mapDbError` rename → Task 1 Step 2 ✓
- Frontend interceptor swap (`isExpensePaymentModeName`) → Task 2 ✓
- Modal `formatError` `NOT_EXPENSE_MODE` case → Task 3 ✓
- "No new automated test for the rename, manual probe covers it" → Task 1 Step 4 + Task 6 ✓
- Manual sandbox verification (4 new modes + 1 ADVANCE negative + 1 Edge probe + 1 regression) → Task 6 ✓
- Migration applied to test project → Task 5 Step 1-3 ✓
- `bc-payment` Edge Function redeploy → Task 5 Step 4 ✓
- `bc-vendor-search` NOT redeployed → noted in Task 5 Step 4 ✓
- No new tables, enums, columns, indexes, triggers, RLS policies → confirmed by the spec audit, no task creates any ✓

**Placeholder scan:** None. Every step contains exact code blocks, exact filenames, exact commands.

**Type consistency:** `isExpenseModeApprove` used identically in Task 2 Steps 2, 3 (twice). `NOT_EXPENSE_MODE` used identically in types.ts (Task 1 Step 1), index.ts (Task 1 Step 2), bc-payment-modal.tsx (Task 3 Step 1), and the SQL migration (Task 4 Step 2). `isExpensePaymentModeName` (helper from `payment-modes.ts`) used once in Task 2 Step 2.
