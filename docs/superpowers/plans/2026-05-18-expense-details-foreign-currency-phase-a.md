# Expense Details — Foreign Currency Support (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `foreign_*` amount columns to `expense_details` so consumers can read original-currency amounts (always populated, no NULL handling), and ensure every existing write path populates them. UI for non-INR data entry is out of scope (Phase B, future plan).

**Architecture:** Single migration that (1) creates two enums, (2) tightens `currency_code` to `local_currency_code`, (3) adds four `foreign_*` columns with safe defaults, (4) backfills existing rows, (5) recreates the two RPCs that INSERT/UPDATE `expense_details` (`create_claim_with_detail`, `update_claim_by_finance`) to also write `foreign_*`. Application code is updated alongside: the two TypeScript write paths (`createExpenseDetailDraft`, `updateClaimDetailsBySubmitter`) populate `foreign_*` mirroring the INR side; domain contracts gain optional `foreign*` fields with auto-population defaults so callers don't break.

**Tech Stack:** Postgres 15 (Supabase remote), Supabase JS client, TypeScript, Vitest, Playwright. Migration applied via Supabase MCP `apply_migration`. Types regenerated via Supabase MCP `generate_typescript_types`.

**Reference spec:** `docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md`

---

## File Structure

**SQL — created:**

- `supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql` — schema + RPC recreations
- `supabase/rollbacks/<NEW_TIMESTAMP>_expense_details_foreign_currency_rollback.sql` — reverses the migration

**Auto-regenerated:**

- `src/types/database.ts` — by Supabase MCP `generate_typescript_types`

**TypeScript — modified:**

- `src/core/domain/claims/contracts.ts` — extend three payload types with `foreign*` fields (optional)
- `src/core/domain/claims/SubmitClaimService.ts` — populate `foreign*` in prepared expense (mirror INR by default)
- `src/core/domain/claims/UpdateClaimByFinanceService.ts` — populate `foreign*` in normalized finance payload
- `src/core/domain/claims/UpdateOwnClaimService.ts` — populate `foreign*` in normalized own-edit payload
- `src/modules/claims/repositories/SupabaseClaimRepository.ts` — extend `createExpenseDetailDraft` INSERT (~L2651) and `updateClaimDetailsBySubmitter` UPDATE (~L2115) with `foreign_*` columns
- (RPC-mediated paths — `update_claim_by_finance`, `create_claim_with_detail` — handled in the migration via PL/pgSQL, no TS write needed)

**Tests — modified:**

- `tests/unit/claims/submit-claim.service.test.ts`
- `tests/unit/claims/supabase-claim-repository.test.ts`
- `tests/unit/claims/actions.test.ts`
- `tests/unit/admin/supabase-admin-repository.test.ts` (read-only — only if fixtures reference `expense_details` rows)
- E2E specs that fixture `expense_details` rows (audit during Task 12; update only those that fail typecheck)

---

## Task 1: Pre-flight data validation

**Files:** none (read-only check)

- [ ] **Step 1: Verify `currency_code` data via Supabase MCP**

Run via Supabase MCP `execute_sql`:

```sql
SELECT currency_code, count(*) AS row_count
FROM public.expense_details
GROUP BY currency_code
ORDER BY row_count DESC;
```

**Expected:** A single row, `currency_code = 'INR'`, with `row_count = <total rows>`.

**If any other value appears (e.g., `'inr'`, `'usd'`, `''`, NULL):** STOP. The migration's enum cast will fail. Clean up those rows first with a separate UPDATE (e.g., `UPDATE expense_details SET currency_code = 'INR' WHERE currency_code <> 'INR';`) and re-run this check before proceeding.

- [ ] **Step 2: Confirm no advisor warnings on `expense_details`**

Run via Supabase MCP `get_advisors` (lint mode). Read output — fail the task if any advisor flags performance/security issues that touch the columns we're modifying. Address them before adding more columns.

---

## Task 2: Write the migration SQL file

**Files:**

- Create: `supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql`

Generate `<NEW_TIMESTAMP>` as the current UTC timestamp formatted `YYYYMMDDHHmmss` (e.g., `20260518120000`). It must be strictly greater than the latest existing migration filename in `supabase/migrations/` (currently `20260518113000_fix_finance_expense_amount_sync.sql`).

- [ ] **Step 1: Create the migration file with the schema changes**

```sql
-- Migration: expense_details_foreign_currency
-- Adds foreign-currency support to expense_details without renaming existing columns.
-- See: docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md

-- ─────────────────────────────────────────────────────────────
-- Step 1: Pre-flight assertion — refuse to migrate if data is dirty.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad_count INT;
BEGIN
  SELECT count(*) INTO v_bad_count
  FROM public.expense_details
  WHERE currency_code IS NULL OR currency_code <> 'INR';

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % rows have currency_code that is NULL or not ''INR''. Clean up first.',
      v_bad_count;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- Step 2: Create enums
-- ─────────────────────────────────────────────────────────────
CREATE TYPE public.local_currency_code   AS ENUM ('INR');
CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');

-- ─────────────────────────────────────────────────────────────
-- Step 3: Tighten existing currency_code TEXT → local_currency_code enum.
--   (Drop default, retype, restore default — required order for ALTER TYPE.)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ALTER COLUMN currency_code DROP DEFAULT;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code TYPE public.local_currency_code
  USING currency_code::public.local_currency_code;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code SET DEFAULT 'INR'::public.local_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 4: Add new foreign_* columns with safe defaults so existing rows
--         satisfy NOT NULL during ADD COLUMN.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD COLUMN foreign_basic_amount   NUMERIC(14,2)                NOT NULL DEFAULT 0,
  ADD COLUMN foreign_gst_amount     NUMERIC(14,2)                NOT NULL DEFAULT 0,
  ADD COLUMN foreign_currency_code  public.foreign_currency_code NOT NULL DEFAULT 'INR'::public.foreign_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 5: Backfill — for every existing row, the foreign side equals the INR side.
-- ─────────────────────────────────────────────────────────────
UPDATE public.expense_details
SET foreign_basic_amount  = basic_amount,
    foreign_gst_amount    = cgst_amount + sgst_amount + igst_amount,
    foreign_currency_code = 'INR'::public.foreign_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 6: CHECK on foreign_gst_amount (>= 0). Defer foreign_basic_amount > 0
--         to a follow-up migration after all writers populate the column.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD CONSTRAINT expense_details_foreign_gst_nonneg_check
  CHECK (foreign_gst_amount >= 0);

-- ─────────────────────────────────────────────────────────────
-- Step 7: Add foreign_total_amount as a GENERATED STORED column.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD COLUMN foreign_total_amount NUMERIC(14,2)
    GENERATED ALWAYS AS (foreign_basic_amount + foreign_gst_amount) STORED;
```

- [ ] **Step 2: Append the RPC recreation — `create_claim_with_detail`**

The existing latest version of `create_claim_with_detail` lives in `supabase/migrations/20260518063735_simplify_amount_columns.sql` (lines 29–228). Copy that function verbatim and modify only the `expense` branch INSERT.

In the COPY, locate the `if v_detail_type = 'expense' then` block (≈line 120 of the source). Make these changes:

1. **Add 4 local variables** to the `declare` section (top of the function, alongside `v_basic_amount`):

   ```
   v_foreign_basic_amount    numeric;
   v_foreign_gst_amount      numeric;
   v_foreign_currency_code   public.foreign_currency_code;
   v_local_currency_code     public.local_currency_code;
   ```

2. **Add value extraction** just before the `insert into public.expense_details` call (after `v_expense_total_amount := round(...)`):

   ```
   v_local_currency_code := coalesce(
     nullif(trim(p_payload->'expense'->>'currency_code'), '')::public.local_currency_code,
     'INR'::public.local_currency_code
   );
   v_foreign_basic_amount := coalesce(
     (p_payload->'expense'->>'foreign_basic_amount')::numeric,
     v_basic_amount
   );
   v_foreign_gst_amount := coalesce(
     (p_payload->'expense'->>'foreign_gst_amount')::numeric,
     v_cgst_amount + v_sgst_amount + v_igst_amount
   );
   v_foreign_currency_code := coalesce(
     nullif(trim(p_payload->'expense'->>'foreign_currency_code'), '')::public.foreign_currency_code,
     'INR'::public.foreign_currency_code
   );
   ```

3. **Extend the column list** of `insert into public.expense_details (...)` to add (after `currency_code`):

   ```
   foreign_basic_amount,
   foreign_gst_amount,
   foreign_currency_code,
   ```

4. **Extend the VALUES list** correspondingly (after the existing `currency_code` value `coalesce(nullif(trim(p_payload->'expense'->>'currency_code'), ''), 'INR')`). Replace that one expression with `v_local_currency_code`, then add the three new values:
   ```
   v_local_currency_code,
   v_foreign_basic_amount,
   v_foreign_gst_amount,
   v_foreign_currency_code,
   ```

After these edits, paste the modified function as the next block in the migration file under a header:

```sql
-- ─────────────────────────────────────────────────────────────
-- Step 8: Recreate create_claim_with_detail to populate foreign_* on insert.
--         Mirrors INR side when foreign_* is not supplied (Phase A behavior).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_claim_with_detail(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
AS $$
  -- ... full modified body here ...
$$;
```

- [ ] **Step 3: Append the RPC recreation — `update_claim_by_finance` (4-arg version)**

The existing latest version lives in `supabase/migrations/20260518113000_fix_finance_expense_amount_sync.sql` (lines 1–end of that function). Copy that function verbatim and modify only the `expense` UPDATE branch.

Locate the `update public.expense_details set ...` block in the `expense` branch. Modify it to:

1. **Add value extraction** before the UPDATE (mirroring the create function):

   ```
   v_foreign_basic_amount  := coalesce(
     (p_payload->>'foreignBasicAmount')::numeric,
     v_basic_amount
   );
   v_foreign_gst_amount    := coalesce(
     (p_payload->>'foreignGstAmount')::numeric,
     v_cgst_amount + v_sgst_amount + v_igst_amount
   );
   v_foreign_currency_code := coalesce(
     nullif(trim(p_payload->>'foreignCurrencyCode'), '')::public.foreign_currency_code,
     'INR'::public.foreign_currency_code
   );
   ```

   (Add the matching `declare` entries at the top of the function — same names as above.)

2. **Extend the SET clause** of the existing UPDATE with three lines:
   ```
   foreign_basic_amount  = v_foreign_basic_amount,
   foreign_gst_amount    = v_foreign_gst_amount,
   foreign_currency_code = v_foreign_currency_code,
   ```

Paste the modified function as:

```sql
-- ─────────────────────────────────────────────────────────────
-- Step 9: Recreate update_claim_by_finance (4-arg) to populate foreign_* on update.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_claim_by_finance(
  p_claim_id text, p_actor_id uuid, p_edit_reason text, p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
AS $$
  -- ... full modified body here ...
$$;
```

- [ ] **Step 4: Verify the migration file is syntactically valid SQL**

Read the file end-to-end. Confirm:

- Two `CREATE TYPE` statements at the top.
- Five `ALTER TABLE` statements (drop default, retype, set default, add columns, add CHECK, add generated total).
- One `UPDATE` (backfill).
- Two `CREATE OR REPLACE FUNCTION` blocks (the two RPCs), each ending with `$$;`.
- No trailing TODOs, placeholders, or `-- ... full modified body here ...` literally in the final file.

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql
git commit -m "feat(db): add foreign-currency columns to expense_details

Adds local_currency_code and foreign_currency_code enums plus four
foreign_* columns (basic, gst, total generated, currency_code). Backfills
existing rows so foreign side equals INR side. Recreates the
create_claim_with_detail and update_claim_by_finance RPCs to populate
foreign_* on write (mirroring INR side when the payload omits them).
Schema-only change — application code is updated in follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Write the rollback SQL file

**Files:**

- Create: `supabase/rollbacks/<NEW_TIMESTAMP>_expense_details_foreign_currency_rollback.sql`

Use the same `<NEW_TIMESTAMP>` from Task 2.

- [ ] **Step 1: Create the rollback file**

```sql
-- Rollback: expense_details_foreign_currency
-- Reverses migration <NEW_TIMESTAMP>_expense_details_foreign_currency.sql.

-- Reverse order: drop generated column, drop CHECK, drop new columns,
-- retype currency_code back to TEXT, drop enums.

ALTER TABLE public.expense_details
  DROP COLUMN IF EXISTS foreign_total_amount;

ALTER TABLE public.expense_details
  DROP CONSTRAINT IF EXISTS expense_details_foreign_gst_nonneg_check;

ALTER TABLE public.expense_details
  DROP COLUMN IF EXISTS foreign_basic_amount,
  DROP COLUMN IF EXISTS foreign_gst_amount,
  DROP COLUMN IF EXISTS foreign_currency_code;

-- Retype currency_code back to TEXT.
ALTER TABLE public.expense_details
  ALTER COLUMN currency_code DROP DEFAULT;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code TYPE text
  USING currency_code::text;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code SET DEFAULT 'INR'::text;

DROP TYPE IF EXISTS public.foreign_currency_code;
DROP TYPE IF EXISTS public.local_currency_code;

-- NOTE: The RPC functions create_claim_with_detail and update_claim_by_finance
-- are NOT restored here. If a rollback is needed, manually re-run the previous
-- versions from:
--   supabase/migrations/20260518063735_simplify_amount_columns.sql  (create_claim_with_detail)
--   supabase/migrations/20260518113000_fix_finance_expense_amount_sync.sql  (update_claim_by_finance)
```

- [ ] **Step 2: Commit the rollback**

```bash
git add supabase/rollbacks/<NEW_TIMESTAMP>_expense_details_foreign_currency_rollback.sql
git commit -m "feat(db): rollback for expense_details foreign-currency migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Apply the migration via Supabase MCP

**Files:** none

- [ ] **Step 1: Apply via MCP**

Call `mcp__claude_ai_Supabase__apply_migration` with:

- `name`: `<NEW_TIMESTAMP>_expense_details_foreign_currency`
- `query`: the full contents of `supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql`

**Expected:** success (no errors). If the migration fails because of dirty data, the `DO $$` block at the top should report the row count — go back to Task 1 to clean up.

- [ ] **Step 2: Verify schema change took effect**

Run via Supabase MCP `execute_sql`:

```sql
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'expense_details'
  AND column_name IN (
    'currency_code',
    'foreign_basic_amount',
    'foreign_gst_amount',
    'foreign_total_amount',
    'foreign_currency_code'
  )
ORDER BY column_name;
```

**Expected:** 5 rows.

- `currency_code` has `udt_name = local_currency_code`, NOT NULL, default `'INR'::local_currency_code`.
- `foreign_basic_amount` is `numeric`, NOT NULL, default `0`.
- `foreign_gst_amount` is `numeric`, NOT NULL, default `0`.
- `foreign_total_amount` is `numeric`, generated (check `is_generated = 'ALWAYS'` separately if needed).
- `foreign_currency_code` has `udt_name = foreign_currency_code`, NOT NULL, default `'INR'::foreign_currency_code`.

- [ ] **Step 3: Verify backfill**

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE foreign_basic_amount = basic_amount) AS backfilled_basic,
       count(*) FILTER (WHERE foreign_gst_amount = cgst_amount + sgst_amount + igst_amount) AS backfilled_gst,
       count(*) FILTER (WHERE foreign_currency_code = 'INR') AS backfilled_currency
FROM public.expense_details;
```

**Expected:** `total = backfilled_basic = backfilled_gst = backfilled_currency`. If any row differs, the backfill was incomplete — investigate before continuing.

- [ ] **Step 4: Smoke-test the recreated RPCs**

Run via Supabase MCP `execute_sql`:

```sql
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN ('create_claim_with_detail', 'update_claim_by_finance')
ORDER BY proname, pronargs;
```

**Expected:** `create_claim_with_detail` (1 arg), `update_claim_by_finance` (2 args) AND `update_claim_by_finance` (4 args). All present.

---

## Task 5: Regenerate TypeScript database types

**Files:**

- Modify: `src/types/database.ts` (auto-regenerated)

- [ ] **Step 1: Generate fresh types via MCP**

Call `mcp__claude_ai_Supabase__generate_typescript_types`. Take the returned `types` string and overwrite `src/types/database.ts` with it (preserving any leading file-header comment from the existing file by re-prepending it after generation, if the existing file has one not produced by the generator).

- [ ] **Step 2: Confirm new fields appear in the generated types**

Read `src/types/database.ts` and `grep -n` for:

- `foreign_basic_amount`
- `foreign_gst_amount`
- `foreign_total_amount`
- `foreign_currency_code`
- `local_currency_code` (as an enum type)

Each should appear at least once in the `expense_details` row/insert/update types.

- [ ] **Step 3: Run typecheck — expect errors at write sites**

Run: `npm run typecheck`
**Expected:** errors in `SupabaseClaimRepository.ts` (and possibly tests) saying the INSERT/UPDATE objects are missing `foreign_basic_amount`, `foreign_gst_amount`, `foreign_currency_code`. This is exactly the signal we need before fixing the call sites in Tasks 7–9. **Do not fix the errors yet** — they are the test bed for the next tasks.

If the typecheck passes without errors, the generated types may be incomplete — re-run Step 1.

- [ ] **Step 4: Commit the regenerated types**

```bash
git add src/types/database.ts
git commit -m "chore(types): regenerate database.ts for expense_details foreign-currency columns

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extend domain contract types with `foreign*` fields

**Files:**

- Modify: `src/core/domain/claims/contracts.ts:101-126` (PreparedClaimSubmission.expense), `:141-166` (FinanceExpenseEditPayload), `:184-218` (OwnExpenseEditPayload)

- [ ] **Step 1: Add foreign fields to `PreparedClaimSubmission.expense`**

Open `src/core/domain/claims/contracts.ts`. In the `expense` block of `PreparedClaimSubmission` (currently lines 101–126), add three new fields after `currencyCode`:

```typescript
currencyCode: string;
foreignBasicAmount: number;
foreignGstAmount: number;
foreignCurrencyCode: "INR" | "USD" | "EUR" | "CHF";
vendorName: string | null;
```

(Keep all other fields unchanged.)

- [ ] **Step 2: Add foreign fields to `FinanceExpenseEditPayload`**

In the same file, in the `FinanceExpenseEditPayload` type (currently lines 141–166), add three new optional fields after `totalAmount`:

```typescript
  totalAmount: number;
  foreignBasicAmount?: number;
  foreignGstAmount?: number;
  foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF";
};
```

Optional, because finance may edit only the INR side and the RPC defaults the foreign side to the local side when omitted.

- [ ] **Step 3: Add foreign fields to `OwnExpenseEditPayload`**

In the same file, in the `OwnExpenseEditPayload` type (currently lines 184–218), add three new fields after `totalAmount`:

```typescript
totalAmount: number;
foreignBasicAmount: number;
foreignGstAmount: number;
foreignCurrencyCode: "INR" | "USD" | "EUR" | "CHF";
```

Required (not optional) because the own-edit UPDATE is a JS update, not an RPC, so it must always pass all values — the JS code applies the mirror-INR default explicitly.

- [ ] **Step 4: Typecheck — see new errors at construction sites**

Run: `npm run typecheck`
**Expected:** errors in `SubmitClaimService.ts`, `UpdateClaimByFinanceService.ts`, `UpdateOwnClaimService.ts`, and tests — places where these types are constructed without the new fields. Tasks 7–9 fix these.

- [ ] **Step 5: Commit the contract changes**

```bash
git add src/core/domain/claims/contracts.ts
git commit -m "feat(contracts): add foreign-currency fields to expense payload types

PreparedClaimSubmission.expense and OwnExpenseEditPayload get required
foreignBasicAmount/foreignGstAmount/foreignCurrencyCode fields.
FinanceExpenseEditPayload gets the same three fields as optional
(the RPC defaults foreign side to INR side when omitted).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Populate `foreign*` in `SubmitClaimService` prepared expense

**Files:**

- Modify: `src/core/domain/claims/SubmitClaimService.ts` — wherever the `PreparedClaimSubmission.expense` object is constructed
- Test: `tests/unit/claims/submit-claim.service.test.ts`

- [ ] **Step 1: Locate the prepared-expense construction**

Run:

```bash
grep -n "basicAmount\|cgstAmount\|currencyCode" src/core/domain/claims/SubmitClaimService.ts
```

Find the block that builds the `expense` portion of `PreparedClaimSubmission`. (It should map form input fields to the prepared shape — `basicAmount`, `cgstAmount`, `currencyCode`, etc.)

- [ ] **Step 2: Write the failing test**

Open `tests/unit/claims/submit-claim.service.test.ts`. Add a new test case in the existing describe block (or the relevant `describe('prepare')` block — locate by reading the file):

```typescript
it("populates foreign_* fields mirroring the INR side when no foreign currency is provided", async () => {
  // Reuse the existing test setup that produces a valid prepared submission.
  // Replace any current "prepares an expense claim" test's expected expense
  // shape with this assertion, or add a new test alongside.
  const prepared =
    await service.prepare(/* the same minimal valid input the
      existing 'prepare' tests use; copy from the nearest passing test in this file */);

  expect(prepared.preparedSubmission?.expense).toMatchObject({
    basicAmount: 1000, // <-- whatever the input fixture sets
    cgstAmount: 90,
    sgstAmount: 90,
    igstAmount: 0,
    totalAmount: 1180,
    currencyCode: "INR",
    foreignBasicAmount: 1000, // = basicAmount
    foreignGstAmount: 180, // = cgst + sgst + igst
    foreignCurrencyCode: "INR",
  });
});
```

(If the existing tests' fixture values differ from `1000 / 90 / 90 / 0 / 1180`, mirror whichever values they use. The point is: `foreignBasicAmount === basicAmount`, `foreignGstAmount === cgstAmount + sgstAmount + igstAmount`, `foreignCurrencyCode === "INR"`.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/unit/claims/submit-claim.service.test.ts -t "populates foreign_"`
**Expected:** FAIL with `Cannot read property 'foreignBasicAmount' of ...` or "expected ... to match object ... with foreignBasicAmount: 1000, got undefined".

- [ ] **Step 4: Update `SubmitClaimService` to populate the fields**

At the construction site found in Step 1, add three fields alongside the existing INR-side fields. Example (the surrounding context will vary; adapt names to whatever the file uses for source input):

```typescript
expense: {
  // ... existing fields ...
  basicAmount: input.expense.basicAmount,
  cgstAmount: input.expense.cgstAmount,
  sgstAmount: input.expense.sgstAmount,
  igstAmount: input.expense.igstAmount,
  totalAmount: input.expense.totalAmount,
  currencyCode: input.expense.currencyCode ?? "INR",
  foreignBasicAmount: input.expense.basicAmount,
  foreignGstAmount:
    input.expense.cgstAmount + input.expense.sgstAmount + input.expense.igstAmount,
  foreignCurrencyCode: "INR",
  // ... existing fields ...
},
```

**Rationale:** Phase A always populates the foreign side as a mirror of the INR side. Phase B will replace these three lines with values from a real currency-selector UI.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/unit/claims/submit-claim.service.test.ts -t "populates foreign_"`
**Expected:** PASS.

- [ ] **Step 6: Run the full unit test file**

Run: `npm test -- tests/unit/claims/submit-claim.service.test.ts`
**Expected:** all tests pass. If existing tests fail because their fixtures no longer match (they now lack `foreign*` fields), update the fixtures to include the three new fields with values mirroring the INR side (see Task 11 for the systematic fixture update — you may need to do a few here ad-hoc to get this file green).

- [ ] **Step 7: Commit**

```bash
git add src/core/domain/claims/SubmitClaimService.ts tests/unit/claims/submit-claim.service.test.ts
git commit -m "feat(claims): populate foreign_* in prepared expense (mirror INR by default)

Phase A: foreignBasicAmount/foreignGstAmount/foreignCurrencyCode are
auto-filled as a mirror of the INR-side values. Phase B (currency
selector UI) will replace this with real foreign-currency input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update `createExpenseDetailDraft` to write `foreign_*`

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts:2651-2680` (the INSERT block)
- Test: `tests/unit/claims/supabase-claim-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/unit/claims/supabase-claim-repository.test.ts`. Find the existing `describe('createExpenseDetailDraft')` block (or the closest equivalent test that covers this method). Add a test case:

```typescript
it("includes foreign_* columns in the INSERT payload", async () => {
  const insertSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "ed-1" }, error: null }),
    }),
  });
  const fromSpy = vi.fn().mockReturnValue({ insert: insertSpy });
  // Patch the service-role client used inside the repository — follow the
  // existing pattern in this test file (look at the closest passing test
  // for createExpenseDetailDraft to see how the mock is wired).

  const prepared = makePreparedSubmission({
    expense: {
      basicAmount: 1000,
      cgstAmount: 90,
      sgstAmount: 90,
      igstAmount: 0,
      totalAmount: 1180,
      currencyCode: "INR",
      foreignBasicAmount: 1000,
      foreignGstAmount: 180,
      foreignCurrencyCode: "INR",
      // ... other required fields from PreparedClaimSubmission.expense
    },
  });

  await repository.createExpenseDetailDraft(prepared);

  expect(insertSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      basic_amount: 1000,
      cgst_amount: 90,
      sgst_amount: 90,
      igst_amount: 0,
      total_amount: 1180,
      currency_code: "INR",
      foreign_basic_amount: 1000,
      foreign_gst_amount: 180,
      foreign_currency_code: "INR",
    }),
  );
});
```

(If `makePreparedSubmission` doesn't exist as a helper, build a literal `PreparedClaimSubmission` object inline — copy the shape from an existing passing test in the same file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/unit/claims/supabase-claim-repository.test.ts -t "includes foreign_"`
**Expected:** FAIL — the assertion will report that the `insert` call did not include `foreign_basic_amount`/`foreign_gst_amount`/`foreign_currency_code`.

- [ ] **Step 3: Update the INSERT call**

Open `src/modules/claims/repositories/SupabaseClaimRepository.ts`. Locate the `createExpenseDetailDraft` method (≈line 2642). Find the `.insert({ ... })` call inside it (≈line 2652). Add three lines after `currency_code: prepared.expense.currencyCode,`:

```typescript
        currency_code: prepared.expense.currencyCode,
        foreign_basic_amount: prepared.expense.foreignBasicAmount,
        foreign_gst_amount: prepared.expense.foreignGstAmount,
        foreign_currency_code: prepared.expense.foreignCurrencyCode,
        vendor_name: prepared.expense.vendorName,
```

(Keep all other fields unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/claims/supabase-claim-repository.test.ts -t "includes foreign_"`
**Expected:** PASS.

- [ ] **Step 5: Run the full unit test file**

Run: `npm test -- tests/unit/claims/supabase-claim-repository.test.ts`
**Expected:** all tests pass. Pre-existing tests that mock the prepared submission may fail if their fixtures lack the new `foreign*` fields — extend each fixture with the three fields (value = mirror of INR side). Make this a quick, mechanical sweep within this file only.

- [ ] **Step 6: Commit**

```bash
git add src/modules/claims/repositories/SupabaseClaimRepository.ts tests/unit/claims/supabase-claim-repository.test.ts
git commit -m "feat(repo): write foreign_* columns in createExpenseDetailDraft INSERT

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Update `updateClaimDetailsBySubmitter` to write `foreign_*`

**Files:**

- Modify: `src/core/domain/claims/UpdateOwnClaimService.ts` — wherever it normalizes the OwnExpenseEditPayload
- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts:2115-2140` (the UPDATE block)
- Test: `tests/unit/claims/supabase-claim-repository.test.ts` (or whichever file currently covers `updateClaimDetailsBySubmitter`)

- [ ] **Step 1: Update `UpdateOwnClaimService.normalizeExpenseAmounts` to populate foreign\_\***

Open `src/core/domain/claims/UpdateOwnClaimService.ts`. Find the `normalizeExpenseAmounts` method (≈line 53). It currently returns a payload with INR-side amounts only. Extend it to add the three foreign fields, mirroring the INR side:

```typescript
private normalizeExpenseAmounts(payload: OwnClaimEditPayload): OwnClaimEditPayload {
  if (payload.detailType !== "expense") {
    return payload;
  }
  // ... existing normalization (rounding, totals, etc.) — leave intact ...

  return {
    ...normalized,
    foreignBasicAmount: normalized.basicAmount,
    foreignGstAmount:
      normalized.cgstAmount + normalized.sgstAmount + normalized.igstAmount,
    foreignCurrencyCode: "INR",
  };
}
```

(Adapt the structure to whatever the existing method returns — keep all current rounding/totals logic; only add the three foreign fields to the returned object.)

- [ ] **Step 2: Write the failing test for the UPDATE call**

Open the test file. Add:

```typescript
it("includes foreign_* columns in the expense UPDATE payload", async () => {
  const updateSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "ed-1" }, error: null }),
          }),
        }),
      }),
    }),
  });
  // Wire updateSpy into the mocked client per the existing pattern in this file.

  const payload: OwnClaimEditPayload = {
    detailType: "expense",
    detailId: "ed-1",
    billNo: "B1",
    expenseCategoryId: "cat-1",
    locationId: "loc-1",
    transactionDate: "2026-05-18",
    isGstApplicable: true,
    gstNumber: "G1",
    vendorName: "V",
    basicAmount: 1000,
    cgstAmount: 90,
    sgstAmount: 90,
    igstAmount: 0,
    totalAmount: 1180,
    purpose: "P",
    productId: null,
    peopleInvolved: null,
    remarks: null,
    receiptFilePath: null,
    bankStatementFilePath: null,
    foreignBasicAmount: 1000,
    foreignGstAmount: 180,
    foreignCurrencyCode: "INR",
  };

  await repository.updateClaimDetailsBySubmitter("CLAIM-1", "user-1", payload);

  expect(updateSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      basic_amount: 1000,
      cgst_amount: 90,
      sgst_amount: 90,
      igst_amount: 0,
      total_amount: 1180,
      foreign_basic_amount: 1000,
      foreign_gst_amount: 180,
      foreign_currency_code: "INR",
    }),
  );
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- tests/unit/claims/supabase-claim-repository.test.ts -t "includes foreign_.* in the expense UPDATE"`
**Expected:** FAIL — the UPDATE call doesn't include `foreign_*`.

- [ ] **Step 4: Update the UPDATE block in the repository**

Open `SupabaseClaimRepository.ts` at the `updateClaimDetailsBySubmitter` method (≈line 2092). Find the `.update({ ... })` call inside `if (payload.detailType === "expense") {` (≈line 2117). Add three lines after `total_amount: payload.totalAmount,`:

```typescript
          total_amount: payload.totalAmount,
          foreign_basic_amount: payload.foreignBasicAmount,
          foreign_gst_amount: payload.foreignGstAmount,
          foreign_currency_code: payload.foreignCurrencyCode,
          vendor_name: payload.vendorName,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/unit/claims/supabase-claim-repository.test.ts -t "includes foreign_.* in the expense UPDATE"`
**Expected:** PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/domain/claims/UpdateOwnClaimService.ts src/modules/claims/repositories/SupabaseClaimRepository.ts tests/unit/claims/supabase-claim-repository.test.ts
git commit -m "feat(claims): write foreign_* in own-edit UPDATE; default mirrors INR

UpdateOwnClaimService.normalizeExpenseAmounts auto-fills foreign side
as a mirror of the INR-side amounts. Repository UPDATE block writes
the three foreign_* columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Update `UpdateClaimByFinanceService` to forward `foreign_*` to the RPC

**Files:**

- Modify: `src/core/domain/claims/UpdateClaimByFinanceService.ts`
- Test: `tests/unit/claims/` (add or extend a test for this service if one exists; otherwise skip and rely on Task 12's typecheck and an E2E smoke test)

The finance-edit path goes through the RPC, so the JS side just needs to forward the three foreign fields (if present in the input payload) in the JSON payload it passes to `update_claim_by_finance`. Since the RPC has its own default-to-INR-side fallback (built in Task 2 Step 3), if the JS layer omits them, the RPC will fill them in.

For Phase A, the JS layer also defaults foreign side = INR side, so the RPC default is just a safety net.

- [ ] **Step 1: Update the service to set foreign\_\* defaults**

Open `src/core/domain/claims/UpdateClaimByFinanceService.ts`. Locate where it constructs the payload passed to the repository (search for `FinanceClaimEditPayload` or the `update` method body). Add three fields to the expense branch — mirroring INR:

```typescript
if (payload.detailType === "expense") {
  // ... existing normalization ...
  return {
    ...normalized,
    foreignBasicAmount: normalized.basicAmount,
    foreignGstAmount: normalized.cgstAmount + normalized.sgstAmount + normalized.igstAmount,
    foreignCurrencyCode: "INR",
  };
}
```

(Adapt to whatever structure the file uses. Goal: every finance-edit expense payload sent to the RPC has the three foreign fields populated.)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
**Expected:** zero errors anywhere in `src/`.

If errors remain, they will be at test fixtures that construct `FinanceExpenseEditPayload` — Task 11 cleans those up.

- [ ] **Step 3: Commit**

```bash
git add src/core/domain/claims/UpdateClaimByFinanceService.ts
git commit -m "feat(claims): forward foreign_* fields in finance-edit payload

Mirrors INR side automatically. The update_claim_by_finance RPC has
the same default as a safety net.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Update remaining unit test fixtures

**Files:**

- Modify: any unit test file that constructs `PreparedClaimSubmission`, `OwnExpenseEditPayload`, or `expense_details` rows directly. Candidates (confirm by typecheck failures):
  - `tests/unit/claims/actions.test.ts`
  - `tests/unit/admin/supabase-admin-repository.test.ts`
  - any other failing test files

For each fixture/factory, add the three new fields with values mirroring the INR side.

- [ ] **Step 1: Find every file with typecheck/test failures referencing `foreign*`**

Run: `npm run typecheck 2>&1 | grep -E "foreign(Basic|Gst|Currency)" | head -30`
List the files. For each file, find the literal that constructs `expense` or `expense_details` and add:

```typescript
foreignBasicAmount: <basicAmount value>,
foreignGstAmount: <cgst + sgst + igst>,
foreignCurrencyCode: "INR",
```

(For database row fixtures — the snake_case version: `foreign_basic_amount`, `foreign_gst_amount`, `foreign_total_amount` (= basic+gst), `foreign_currency_code: "INR"`.)

- [ ] **Step 2: Re-run typecheck**

Run: `npm run typecheck`
**Expected:** zero errors.

- [ ] **Step 3: Run all unit tests**

Run: `npm test`
**Expected:** all tests pass.

If a test fails because it asserts an exact insert/update shape and now sees `foreign_*` keys in the payload, update the assertion to use `expect.objectContaining({...})` or to include the new keys in the expected shape (with mirror-INR values).

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: add foreign_* fields to expense fixtures across unit tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Update E2E test fixtures (if any reference expense_details fields directly)

**Files:** files under `tests/e2e/` that hard-code `basic_amount` / `total_amount` / `currency_code` assertions on `expense_details` rows.

The E2E tests run against the real local dev server which talks to the remote Supabase. Because the RPC writes `foreign_*` automatically (Task 2), E2E tests that simply submit a claim and read back will work without changes. Only tests that **assert the exact column set** of an `expense_details` row need updates.

- [ ] **Step 1: Find candidate E2E files**

Run:

```bash
grep -rln "expense_details\|basic_amount\|total_amount" tests/e2e/ | head
```

For each file, open and check whether it directly queries Supabase (e.g., via the admin client) and asserts column values. If yes and the assertion lists columns by name, extend the expected shape with `foreign_*` (mirror-INR values).

If a file only interacts through the UI (no direct DB asserts), skip it.

- [ ] **Step 2: Run the relevant E2E specs**

For each updated E2E file: `npx playwright test tests/e2e/<file>.spec.ts --headed=false`
**Expected:** pass. (E2E suite as a whole can be skipped if it's slow — pick the spec most likely to exercise the claim-submission write path, e.g., `submit-claim.spec.ts`.)

- [ ] **Step 3: Commit (if any E2E files changed)**

```bash
git add tests/e2e/
git commit -m "test(e2e): include foreign_* fields in expense_details assertions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: End-to-end verification — smoke test the write paths

**Files:** none

- [ ] **Step 1: Insert a test claim through the create RPC and verify foreign\_\* populates**

Via Supabase MCP `execute_sql`, INSERT a test claim using `create_claim_with_detail` with a payload that omits the `foreign_*` keys. Confirm the resulting `expense_details` row has `foreign_basic_amount = basic_amount`, etc. (mirror-INR default).

```sql
SELECT public.create_claim_with_detail('{
  "claim_id": "CLAIM-TEST-20260518-FX01",
  "detail_type": "expense",
  "submission_type": "self",
  "submitted_by": "<a real user uuid>",
  "on_behalf_of_id": "<same uuid>",
  "department_id": "<a real dept uuid>",
  "payment_mode_id": "<a real reimbursement uuid>",
  "assigned_l1_approver_id": "<a real approver uuid>",
  "expense": {
    "bill_no": "FX-TEST-1",
    "expense_category_id": "<a real category uuid>",
    "location_id": "<a real location uuid>",
    "transaction_date": "2026-05-18",
    "basic_amount": 1000,
    "cgst_amount": 90,
    "sgst_amount": 90,
    "igst_amount": 0,
    "is_gst_applicable": true,
    "gst_number": "G",
    "currency_code": "INR"
  }
}'::jsonb);

SELECT basic_amount, cgst_amount, sgst_amount, igst_amount, total_amount, currency_code,
       foreign_basic_amount, foreign_gst_amount, foreign_total_amount, foreign_currency_code
FROM public.expense_details
WHERE claim_id = 'CLAIM-TEST-20260518-FX01';
```

**Expected:** one row, with `foreign_basic_amount = 1000`, `foreign_gst_amount = 180`, `foreign_total_amount = 1180`, `foreign_currency_code = 'INR'`. (Use real UUIDs from your dev DB — query them first if needed.)

- [ ] **Step 2: Clean up the test row**

```sql
UPDATE public.expense_details SET is_active = false WHERE claim_id = 'CLAIM-TEST-20260518-FX01';
UPDATE public.claims SET is_active = false WHERE id = 'CLAIM-TEST-20260518-FX01';
```

- [ ] **Step 3: Final repository check**

Read your application logs / dashboards (or just run a SELECT) to confirm no new rows have `foreign_basic_amount = 0` from real user activity (which would mean a write path was missed). If any exist after a few hours of normal usage, run:

```sql
SELECT id, claim_id, basic_amount, foreign_basic_amount, created_at
FROM public.expense_details
WHERE foreign_basic_amount = 0 AND created_at > now() - interval '1 day';
```

and trace any results back to the un-updated write path.

---

## Task 14: Update the spec status and final commit

**Files:**

- Modify: `docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md` — change `Status: Draft — awaiting user review` to `Status: Implemented (Phase A) on <today's date>`.

- [ ] **Step 1: Update the spec status line**

Edit the spec header to:

```markdown
**Status:** Implemented (Phase A) on <YYYY-MM-DD>. Phase B (currency selector UI) planned separately.
```

- [ ] **Step 2: Commit the spec update**

```bash
git add docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md
git commit -m "docs(spec): mark expense_details foreign-currency Phase A as implemented

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Edge cases this plan defends against

| Edge case                                                                                         | Where handled                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `currency_code` data not all `'INR'`                                                     | Task 1 pre-flight; Task 2 Step 1 DO-block aborts migration with row count                                                                                  |
| ALTER TYPE cast fails due to default conflict                                                     | Task 2 Step 1 drops default before retype, restores after                                                                                                  |
| New `foreign_*` columns violate NOT NULL on existing rows                                         | Defaults of `0` / `'INR'` satisfy NOT NULL during ADD; backfill replaces 0s                                                                                |
| CHECK constraint `>0` would block ADD on zero-default                                             | Deferred to follow-up migration after writers populate the column (per spec §6)                                                                            |
| `total_amount` thought to be GENERATED — it isn't anymore                                         | Spec corrected; only `foreign_total_amount` (new) is GENERATED                                                                                             |
| Concurrent writes during migration                                                                | Migration runs in single transaction; PostgreSQL acquires AccessExclusiveLock briefly during ALTER TABLE. Existing dashboard SELECTs queue but don't fail. |
| `uq_expense_details_active_bill` index references `total_amount`                                  | We don't touch that column — index unaffected                                                                                                              |
| RPC `create_claim_with_detail` does the actual INSERT, not the JS code                            | Task 2 Step 2 recreates the RPC to populate foreign\_\*                                                                                                    |
| RPC `update_claim_by_finance` does the actual UPDATE for finance edits                            | Task 2 Step 3 recreates the RPC similarly                                                                                                                  |
| JS path `createExpenseDetailDraft` also does direct INSERT                                        | Task 8 updates it                                                                                                                                          |
| JS path `updateClaimDetailsBySubmitter` does direct UPDATE for own-edit                           | Task 9 updates it                                                                                                                                          |
| Admin repo's only `expense_details` write is `is_active = false` (soft delete)                    | No update needed — doesn't touch amount columns                                                                                                            |
| Views (`vw_admin_claims_dashboard`, `vw_enterprise_claims_dashboard`) reference `ed.total_amount` | Reads unaffected; views work without changes                                                                                                               |
| RLS policies on `expense_details`                                                                 | They reference `claim_id` and `is_active`, not the amount columns — unaffected                                                                             |
| TypeScript types out of sync after migration                                                      | Task 5 regenerates `database.ts`, Task 5 Step 3 expects typecheck errors as a signal                                                                       |
| Tests' fixtures lack the new fields                                                               | Tasks 7, 8, 9, 11 add them; Task 12 covers E2E                                                                                                             |
| Forgetting to commit between tasks                                                                | Each task ends with an explicit `git commit` step                                                                                                          |
| Rollback needs to restore RPCs                                                                    | Task 3 notes that RPCs require manual restoration from the prior migrations (because they were modified, not added)                                        |

---

## Self-review notes (engineer pre-check)

Before declaring this plan complete, the engineer should confirm:

- [ ] Every task's "Step N" produced a commit (run `git log --oneline -20` to verify).
- [ ] `npm run typecheck` returns zero errors.
- [ ] `npm test` is fully green.
- [ ] The Supabase MCP smoke-test in Task 13 returned `foreign_basic_amount = basic_amount` etc. with no manual data fixup.
- [ ] No rows exist where `foreign_basic_amount = 0 AND basic_amount > 0` (would indicate a missed write path).
