# Enforce `expense_details.total_amount` via DB Trigger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `BEFORE INSERT OR UPDATE` trigger on `public.expense_details` so `total_amount` is always recomputed as `ROUND(COALESCE(basic_amount,0) + COALESCE(cgst_amount,0) + COALESCE(sgst_amount,0) + COALESCE(igst_amount,0), 2)` — regardless of what any caller writes to the column.

**Architecture:** A PL/pgSQL trigger function (`set_expense_total_amount`) is created and attached to `expense_details` as a `BEFORE INSERT OR UPDATE FOR EACH ROW` trigger. It overwrites `NEW.total_amount` before the row lands. No application code changes. A rollback migration is shipped alongside the up migration.

**Tech Stack:** PostgreSQL (via Supabase), SQL migration files in `supabase/migrations/`

---

## File Map

| Action | Path                                                                        |
| ------ | --------------------------------------------------------------------------- |
| Create | `supabase/migrations/20260518200000_enforce_expense_total_trigger.sql`      |
| Create | `supabase/migrations/20260518200000_enforce_expense_total_trigger_down.sql` |

---

### Task 1: Write the up migration

**Files:**

- Create: `supabase/migrations/20260518200000_enforce_expense_total_trigger.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260518200000_enforce_expense_total_trigger.sql` with this exact content:

```sql
-- Trigger function: recomputes total_amount from component amounts on every write.
-- Applies to expense_details only. advance_details is intentionally excluded
-- because its total_amount is user-provided with no component breakdown.
CREATE OR REPLACE FUNCTION public.set_expense_total_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total_amount := ROUND(
    COALESCE(NEW.basic_amount, 0)
    + COALESCE(NEW.cgst_amount, 0)
    + COALESCE(NEW.sgst_amount, 0)
    + COALESCE(NEW.igst_amount, 0),
    2
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expense_total_amount
BEFORE INSERT OR UPDATE ON public.expense_details
FOR EACH ROW EXECUTE FUNCTION public.set_expense_total_amount();
```

- [ ] **Step 2: Verify the file was written correctly**

Run:

```bash
cat supabase/migrations/20260518200000_enforce_expense_total_trigger.sql
```

Expected: full SQL content printed with no truncation, both the `CREATE OR REPLACE FUNCTION` and `CREATE TRIGGER` statements present.

- [ ] **Step 3: Commit the up migration**

```bash
git add supabase/migrations/20260518200000_enforce_expense_total_trigger.sql
git commit -m "feat: add BEFORE trigger to enforce expense_details.total_amount integrity"
```

---

### Task 2: Write the rollback migration

**Files:**

- Create: `supabase/migrations/20260518200000_enforce_expense_total_trigger_down.sql`

- [ ] **Step 1: Create the rollback file**

Create `supabase/migrations/20260518200000_enforce_expense_total_trigger_down.sql` with this exact content:

```sql
DROP TRIGGER IF EXISTS trg_expense_total_amount ON public.expense_details;
DROP FUNCTION IF EXISTS public.set_expense_total_amount();
```

- [ ] **Step 2: Verify the file was written correctly**

Run:

```bash
cat supabase/migrations/20260518200000_enforce_expense_total_trigger_down.sql
```

Expected: both `DROP` statements printed.

- [ ] **Step 3: Commit the rollback migration**

```bash
git add supabase/migrations/20260518200000_enforce_expense_total_trigger_down.sql
git commit -m "feat: add rollback migration for expense_details total_amount trigger"
```

---

### Task 3: Apply the migration

> **STOP — manual step required.** The migration must be applied by the user; it cannot be auto-applied by the agent.

- [ ] **Step 1: Apply via Supabase CLI**

```bash
npx supabase db push
```

If you are working against a remote project without the CLI configured locally, apply the SQL directly in the Supabase Dashboard → SQL Editor by pasting the contents of `supabase/migrations/20260518200000_enforce_expense_total_trigger.sql`.

Expected output (CLI):

```
Applying migration 20260518200000_enforce_expense_total_trigger.sql...
Done.
```

- [ ] **Step 2: Confirm the trigger exists**

In the Supabase Dashboard SQL Editor (or `psql`), run:

```sql
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'expense_details'
  AND trigger_name = 'trg_expense_total_amount';
```

Expected: one row returned:

```
trigger_name              | event_manipulation | action_timing
--------------------------+--------------------+--------------
trg_expense_total_amount  | INSERT             | BEFORE
trg_expense_total_amount  | UPDATE             | BEFORE
```

(PostgreSQL lists one row per event, so you will see two rows — one for INSERT and one for UPDATE.)

---

### Task 4: Verify DB integrity

- [ ] **Step 1: Check for existing rows with incorrect totals**

Run this in the Supabase SQL Editor:

```sql
SELECT
  id,
  basic_amount,
  cgst_amount,
  sgst_amount,
  igst_amount,
  total_amount,
  ROUND(
    COALESCE(basic_amount, 0)
    + COALESCE(cgst_amount, 0)
    + COALESCE(sgst_amount, 0)
    + COALESCE(igst_amount, 0),
    2
  ) AS expected_total
FROM public.expense_details
WHERE is_active = true
  AND total_amount IS DISTINCT FROM ROUND(
    COALESCE(basic_amount, 0)
    + COALESCE(cgst_amount, 0)
    + COALESCE(sgst_amount, 0)
    + COALESCE(igst_amount, 0),
    2
  );
```

Expected: zero rows. If any rows appear, they represent historical drift that predates the trigger. The trigger will not retroactively fix existing rows — that requires a separate backfill (not in scope for this plan).

- [ ] **Step 2: Smoke-test the trigger with a direct write**

Pick any active `expense_details` row id from the dashboard. Run:

```sql
-- Attempt to write a clearly wrong total_amount
UPDATE public.expense_details
SET total_amount = 99999
WHERE id = '<your-row-id>'
  AND is_active = true;

-- Immediately verify it was silently corrected
SELECT
  id,
  basic_amount,
  cgst_amount,
  sgst_amount,
  igst_amount,
  total_amount
FROM public.expense_details
WHERE id = '<your-row-id>';
```

Expected: `total_amount` equals `basic_amount + cgst_amount + sgst_amount + igst_amount`, not `99999`.

- [ ] **Step 3: Run existing Playwright tests to confirm no regressions**

```bash
npx playwright test --reporter=line
```

Expected: all tests pass. No UI changes were made in this plan, so no test failures are expected.
