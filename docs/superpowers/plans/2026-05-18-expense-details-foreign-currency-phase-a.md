# Expense Details — Foreign Currency Support (Phase A: DB-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `foreign_*` schema to `expense_details` (two enums, four new columns) and backfill historical rows so the foreign side mirrors the INR side. **Schema-only — no application code or RPC changes.** New claims created after this migration will land with `foreign_basic_amount = 0`, `foreign_gst_amount = 0`, `foreign_currency_code = 'INR'`, `foreign_total_amount = 0` (defaults) until a future phase updates the writers.

**Architecture:** Single forward-migration file (schema + one-time backfill) and a matching rollback file. No source code is touched. No RPC functions are recreated. Application reads of `foreign_*` columns work immediately for historical rows; new rows get column defaults until writers are updated.

**Tech Stack:** Postgres 15 (Supabase remote). Migration applied via Supabase MCP `apply_migration`. Verification via Supabase MCP `execute_sql`.

**Reference spec:** `docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md`

---

## File Structure

**SQL — created (2 files):**

- `supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql` — forward migration
- `supabase/rollbacks/<NEW_TIMESTAMP>_expense_details_foreign_currency_rollback.sql` — reverse migration

**No other files are touched.**

---

## Task 1: Pre-flight data validation

**Files:** none (read-only check)

- [ ] **Step 1: Verify `currency_code` data via Supabase MCP**

Call `mcp__claude_ai_Supabase__execute_sql` with:

```sql
SELECT currency_code, count(*) AS row_count
FROM public.expense_details
GROUP BY currency_code
ORDER BY row_count DESC;
```

**Expected:** A single row, `currency_code = 'INR'`, `row_count` equal to the total number of `expense_details` rows.

**If any other value appears (e.g., `'inr'` lowercase, `'usd'`, `''` empty, NULL):** STOP. The migration's enum cast (`USING currency_code::public.local_currency_code`) will fail. Clean up the bad rows first with a focused UPDATE, e.g.:

```sql
UPDATE public.expense_details SET currency_code = 'INR' WHERE currency_code <> 'INR';
```

Then re-run the SELECT above and confirm it now returns a single `'INR'` row before continuing.

- [ ] **Step 2: Confirm no advisor warnings touching `expense_details`**

Call `mcp__claude_ai_Supabase__get_advisors` with `type: "performance"` and then `type: "security"`. Read both outputs.

**Expected:** No advisor flags issues on `expense_details` columns we're modifying. If one does (e.g., a missing index warning), note it and decide whether to address it before or after this migration — but do not silently ignore.

---

## Task 2: Write the forward migration SQL

**Files:**

- Create: `supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql`

Generate `<NEW_TIMESTAMP>` as the current UTC timestamp formatted `YYYYMMDDHHmmss` (e.g., `20260518120000`). It must be strictly greater than the latest existing migration filename in `supabase/migrations/` (currently `20260518113000_fix_finance_expense_amount_sync.sql`). Run `ls supabase/migrations/ | tail -1` first to confirm.

- [ ] **Step 1: Create the migration file with exactly this content**

```sql
-- Migration: expense_details_foreign_currency
-- Adds foreign-currency support to expense_details.
-- DB-only scope: no RPC changes, no application code changes.
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
-- Step 2: Create enums.
-- ─────────────────────────────────────────────────────────────
CREATE TYPE public.local_currency_code   AS ENUM ('INR');
CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');

-- ─────────────────────────────────────────────────────────────
-- Step 3: Tighten existing currency_code TEXT → local_currency_code enum.
--   ALTER TYPE with USING requires the default to be dropped first
--   (because the existing 'INR'::text default isn't directly castable),
--   then restored as the new type.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ALTER COLUMN currency_code DROP DEFAULT;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code TYPE public.local_currency_code
  USING currency_code::public.local_currency_code;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code SET DEFAULT 'INR'::public.local_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 4: Add new foreign_* columns with defaults so existing rows
--         satisfy NOT NULL during ADD COLUMN. Defaults persist
--         after the migration — new INSERTs that omit these columns
--         will get 0 / 0 / 'INR' (intentional for this phase).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD COLUMN foreign_basic_amount   NUMERIC(14,2)                NOT NULL DEFAULT 0,
  ADD COLUMN foreign_gst_amount     NUMERIC(14,2)                NOT NULL DEFAULT 0,
  ADD COLUMN foreign_currency_code  public.foreign_currency_code NOT NULL DEFAULT 'INR'::public.foreign_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 5: One-time backfill — historical rows get foreign side mirroring INR.
--         This UPDATE runs ONCE during migration. After it, the two sides
--         are independent at the DB level (no trigger, no constraint).
-- ─────────────────────────────────────────────────────────────
UPDATE public.expense_details
SET foreign_basic_amount  = basic_amount,
    foreign_gst_amount    = cgst_amount + sgst_amount + igst_amount,
    foreign_currency_code = 'INR'::public.foreign_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 6: CHECK constraint on foreign_gst_amount (>= 0).
--         No CHECK on foreign_basic_amount in this phase — would conflict
--         with the DEFAULT 0 that new INSERTs rely on.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD CONSTRAINT expense_details_foreign_gst_nonneg_check
  CHECK (foreign_gst_amount >= 0);

-- ─────────────────────────────────────────────────────────────
-- Step 7: Add foreign_total_amount as a GENERATED STORED column.
--         Postgres maintains this automatically — callers must NOT
--         write to it.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD COLUMN foreign_total_amount NUMERIC(14,2)
    GENERATED ALWAYS AS (foreign_basic_amount + foreign_gst_amount) STORED;
```

- [ ] **Step 2: Sanity-check the file**

Read the file end-to-end. Confirm:

- 7 numbered comment blocks are present.
- One `DO $$ ... END $$;` block (pre-flight).
- Two `CREATE TYPE` statements.
- Five `ALTER TABLE public.expense_details` statements (drop default, retype, set default; add 3 columns; add CHECK; add generated total).
- One `UPDATE public.expense_details` (backfill).
- No placeholders, TODOs, or `-- ...` ellipses left behind.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql
git commit -m "$(cat <<'EOF'
feat(db): add foreign-currency columns to expense_details (schema-only)

Creates local_currency_code and foreign_currency_code enums. Tightens
existing currency_code from TEXT to local_currency_code. Adds four
foreign_* columns (basic, gst, total generated, currency_code) with
defaults of 0 / 0 / 'INR'. One-time backfill mirrors INR side onto
foreign side for historical rows.

DB-only scope: no RPC recreations, no application code changes. New
INSERTs that omit foreign_* columns will get the default values; a
follow-up phase will update writers to populate them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write the rollback SQL

**Files:**

- Create: `supabase/rollbacks/<NEW_TIMESTAMP>_expense_details_foreign_currency_rollback.sql`

Use the same `<NEW_TIMESTAMP>` as Task 2.

- [ ] **Step 1: Create the rollback file with exactly this content**

```sql
-- Rollback: expense_details_foreign_currency
-- Reverses migration <NEW_TIMESTAMP>_expense_details_foreign_currency.sql.
-- Drops foreign_* columns, retypes currency_code back to TEXT, drops enums.

-- Reverse order: generated column first, then CHECK, then the three plain columns.
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
```

- [ ] **Step 2: Commit the rollback**

```bash
git add supabase/rollbacks/<NEW_TIMESTAMP>_expense_details_foreign_currency_rollback.sql
git commit -m "$(cat <<'EOF'
feat(db): rollback for expense_details foreign-currency migration

Drops the four foreign_* columns, the CHECK constraint, and retypes
currency_code back to TEXT. Drops the two enums.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Apply the migration and verify

**Files:** none (operates on remote DB via Supabase MCP)

- [ ] **Step 1: Apply the migration**

Call `mcp__claude_ai_Supabase__apply_migration` with:

- `name`: `<NEW_TIMESTAMP>_expense_details_foreign_currency`
- `query`: the full contents of `supabase/migrations/<NEW_TIMESTAMP>_expense_details_foreign_currency.sql`

**Expected:** success, no errors.

**If the pre-flight DO-block raises:** the assertion includes the bad row count in the error message. Go back to Task 1 Step 1 to clean up, then retry.

- [ ] **Step 2: Verify the schema change took effect**

Call `mcp__claude_ai_Supabase__execute_sql` with:

```sql
SELECT column_name, data_type, udt_name, is_nullable, column_default, is_generated
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

**Expected:** Exactly 5 rows. Confirm each:

| `column_name`           | `udt_name`              | `is_nullable` | `column_default`               | `is_generated` |
| ----------------------- | ----------------------- | ------------- | ------------------------------ | -------------- |
| `currency_code`         | `local_currency_code`   | `NO`          | `'INR'::local_currency_code`   | `NEVER`        |
| `foreign_basic_amount`  | `numeric`               | `NO`          | `0`                            | `NEVER`        |
| `foreign_currency_code` | `foreign_currency_code` | `NO`          | `'INR'::foreign_currency_code` | `NEVER`        |
| `foreign_gst_amount`    | `numeric`               | `NO`          | `0`                            | `NEVER`        |
| `foreign_total_amount`  | `numeric`               | `NO`          | (empty / NULL)                 | `ALWAYS`       |

**If anything differs:** stop. Inspect the row(s) that disagree, check the migration file's syntax, and investigate before continuing.

- [ ] **Step 3: Verify the backfill ran on historical rows**

Call `mcp__claude_ai_Supabase__execute_sql` with:

```sql
SELECT
  count(*)                                                            AS total,
  count(*) FILTER (WHERE foreign_basic_amount = basic_amount)         AS matches_basic,
  count(*) FILTER (
    WHERE foreign_gst_amount = cgst_amount + sgst_amount + igst_amount
  )                                                                   AS matches_gst,
  count(*) FILTER (WHERE foreign_currency_code = 'INR')               AS matches_currency,
  count(*) FILTER (WHERE foreign_total_amount = total_amount)         AS matches_total
FROM public.expense_details;
```

**Expected:** `total = matches_basic = matches_gst = matches_currency`. (The `matches_total` column may differ slightly if rounding to 2 decimals causes drift between the stored `total_amount` and the GENERATED `foreign_total_amount` — that's acceptable, since the foreign generated column recomputes from basic + gst exactly.)

If `matches_basic` or `matches_gst` or `matches_currency` is less than `total`, the backfill is incomplete. Investigate which rows failed and why.

- [ ] **Step 4: Confirm enums exist**

```sql
SELECT typname, array_agg(enumlabel ORDER BY enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typnamespace = 'public'::regnamespace
  AND t.typname IN ('local_currency_code', 'foreign_currency_code')
GROUP BY typname
ORDER BY typname;
```

**Expected:** 2 rows:

- `foreign_currency_code` → `{INR, USD, EUR, CHF}`
- `local_currency_code` → `{INR}`

- [ ] **Step 5: Smoke-test new INSERT default behavior**

Insert a minimal test row to confirm the new-row defaults work as expected.

```sql
-- Use a real claim_id from your DB if one exists; otherwise this will fail
-- on the FK constraint, which is also acceptable — the point is to confirm
-- that the new columns are not required.
-- Replace <claim_id>, <category_id>, <location_id> with real IDs.

BEGIN;

INSERT INTO public.expense_details (
  claim_id, bill_no, transaction_id, expense_category_id, location_id,
  is_gst_applicable, gst_number,
  transaction_date, basic_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
  vendor_name, receipt_file_path, bank_statement_file_path, people_involved, remarks, purpose
)
VALUES (
  '<claim_id>', 'TEST-FX-1', 'N/A', '<category_id>', '<location_id>',
  false, 'N/A',
  '2026-05-18', 100, 0, 0, 0, 100,
  'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'Smoke test row'
)
RETURNING
  basic_amount, total_amount, currency_code,
  foreign_basic_amount, foreign_gst_amount, foreign_total_amount, foreign_currency_code;

-- ROLLBACK so we don't leave the test row in the database.
ROLLBACK;
```

**Expected:** the RETURNING clause shows:

- `basic_amount = 100`, `total_amount = 100`, `currency_code = 'INR'`
- `foreign_basic_amount = 0`, `foreign_gst_amount = 0`, `foreign_total_amount = 0`, `foreign_currency_code = 'INR'`

The ROLLBACK ensures the test row is not persisted.

**If the INSERT fails with "null value in column foreign\_\* violates not-null constraint":** the defaults aren't working. Re-check the migration's `ADD COLUMN ... NOT NULL DEFAULT 0` syntax.

If the INSERT fails on an FK constraint (because we used a placeholder UUID), that's still a successful smoke test of the new column defaults — the FK error confirms the row would have been accepted otherwise.

- [ ] **Step 6: Document completion**

The migration is live. The spec's `Status:` line in `docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md` can be updated to:

```
**Status:** DB phase implemented on <YYYY-MM-DD>. Code phase pending separate plan.
```

Commit that one-line update:

```bash
git add docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md
git commit -m "$(cat <<'EOF'
docs(spec): mark expense_details foreign-currency DB phase as implemented

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Edge cases this plan defends against

| Edge case                                                          | Where handled                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `currency_code` data not all `'INR'`                      | Task 1 Step 1 pre-flight; Task 2 Step 1 `DO $$` block aborts migration with row count                                                                    |
| ALTER TYPE cast fails due to default conflict                      | Task 2 Step 1, Step 3 (the migration's ALTER) drops default before retype, restores after                                                                |
| `NOT NULL` on new columns rejects existing rows during ADD         | Defaults `0` / `'INR'` satisfy NOT NULL during ADD COLUMN                                                                                                |
| `CHECK (foreign_basic_amount > 0)` would conflict with `DEFAULT 0` | Constraint deliberately omitted in this phase                                                                                                            |
| Concurrent writes during migration                                 | ALTER TABLE acquires AccessExclusiveLock briefly; backfill UPDATE is a single statement; other writes queue but don't fail                               |
| `uq_expense_details_active_bill` index references `total_amount`   | Unaffected — we don't touch that column                                                                                                                  |
| Views (`vw_admin_claims_dashboard`, etc.) reference INR columns    | Unaffected — no rename, no INR column changes                                                                                                            |
| RLS policies reference `claim_id` and `is_active`                  | Unaffected — those columns unchanged                                                                                                                     |
| RPCs (`create_claim_with_detail`, `update_claim_by_finance`)       | Unchanged in this phase — their current INSERT/UPDATE statements don't reference `foreign_*`, so they continue to work; new rows get the column defaults |
| `database.ts` becomes mildly stale (missing new columns)           | Acceptable — no code reads them yet; regenerate when the code phase starts                                                                               |
| Smoke INSERT fails on FK constraint due to placeholder UUID        | Still confirms NOT NULL/defaults work (FK fires after defaults applied); ROLLBACK ensures no test row persists                                           |

---

## Engineer pre-completion checklist

- [ ] `git log --oneline -5` shows the migration commit, the rollback commit, and (optionally) the spec status-update commit.
- [ ] Task 4 Step 2 returned all 5 expected rows with correct types/defaults.
- [ ] Task 4 Step 3 showed `matches_basic = matches_gst = matches_currency = total`.
- [ ] Task 4 Step 4 showed both enums with exactly the expected value lists.
- [ ] Task 4 Step 5 returned `foreign_basic_amount = 0, foreign_gst_amount = 0, foreign_total_amount = 0, foreign_currency_code = 'INR'` for the smoke-test row, OR the INSERT failed on a non-default-related constraint (FK).
- [ ] Nothing outside `supabase/migrations/`, `supabase/rollbacks/`, and the spec was modified.
