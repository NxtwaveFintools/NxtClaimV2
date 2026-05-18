# Expense Details — Foreign Currency Support

**Date:** 2026-05-18
**Status:** Draft — awaiting user review
**Scope:** Database schema change to `expense_details` to capture original-currency amounts alongside existing INR amounts. Additive only — no column renames.

---

## 1. Problem

Today, `expense_details` records each expense in INR only. A USD or EUR purchase loses its original-currency representation:

- Receipt reviewers cannot see "$500 USD" on the claim — only the converted INR amount.
- The original transaction-currency amount is lost after entry.
- There is no structured way to record that an expense was incurred in a non-INR currency.

We need to store both representations on the same row: the INR amount finance reimburses, and the original-currency amount the employee actually paid.

## 2. Goals & non-goals

**Goals**

- Capture original-currency amounts (basic, tax, total) for every expense, in addition to the existing INR amounts.
- Make reads uniform: any consumer reading the original-currency side gets a valid amount + currency without NULL handling.
- Constrain currency to a small allow-list at the type level (Postgres enum).
- Preserve all existing INR-side semantics and aggregations.

**Non-goals**

- No exchange rate capture. The employee supplies both numbers (INR-paid from card statement, original amount from bill); no FX API integration.
- No INR-equivalent recomputation at read time. The INR amount is frozen at entry.
- No rename of existing columns (`basic_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `total_amount`, `currency_code`). Additive only.
- No new `expense_details_foreign` table — extending the existing table is simpler and avoids joins.
- No constraint linking `foreign_currency_code` to the Indian GST columns. The two concerns are independent: GST rules apply per normal logic regardless of the original currency.

## 3. Design

### 3.1 Enums

Two single-purpose enums in the `public` schema:

```sql
CREATE TYPE public.local_currency_code   AS ENUM ('INR');
CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');
```

- `local_currency_code` has a single value (`'INR'`). This locks the existing `currency_code` column to INR at the type level — no CHECK constraint needed, the type system enforces it.
- `foreign_currency_code` includes `'INR'` so that domestic expenses can keep `foreign_currency_code = 'INR'` and the `foreign_*` columns stay meaningfully populated (no NULLs).
- Adding new currencies later is `ALTER TYPE … ADD VALUE` — no table rewrite.

### 3.2 Existing column changes

Only one existing column is altered:

| Column          | Before                              | After                                                                           |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `currency_code` | `TEXT NOT NULL DEFAULT 'INR'::text` | `public.local_currency_code NOT NULL DEFAULT 'INR'::public.local_currency_code` |

All other existing amount columns (`basic_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `total_amount`) are unchanged.

**Pre-flight check:** before running this ALTER, verify `SELECT DISTINCT currency_code FROM expense_details;` returns only `'INR'`. If any other values exist, the cast will fail and the migration must be paused to clean them up.

### 3.3 New columns

Four new columns on `expense_details`:

| Column                  | Type                           | Constraints                                                                          | Notes                                                                                                                                                          |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `foreign_basic_amount`  | `NUMERIC(14,2)`                | `NOT NULL`; `CHECK (> 0)` deferred to a follow-up migration (see §6 deployment note) | Original-currency basic amount. Wider precision than INR side (`12,2`) to accommodate currencies with large nominal values.                                    |
| `foreign_gst_amount`    | `NUMERIC(14,2)`                | `NOT NULL DEFAULT 0`, `CHECK (foreign_gst_amount >= 0)`                              | Original-currency tax (VAT/GST/sales tax — whatever the foreign jurisdiction calls it). Single column — no CGST/SGST/IGST split, since that's Indian-specific. |
| `foreign_total_amount`  | `NUMERIC`                      | `GENERATED ALWAYS AS (foreign_basic_amount + foreign_gst_amount) STORED`             | Auto-computed total. Mirrors the INR-side `total_amount` pattern.                                                                                              |
| `foreign_currency_code` | `public.foreign_currency_code` | `NOT NULL DEFAULT 'INR'::public.foreign_currency_code`                               | Which currency the foreign side is in. `'INR'` for domestic expenses; `'USD'`/`'EUR'`/`'CHF'` for foreign.                                                     |

### 3.4 Backfill

All existing rows are INR-only. They get backfilled in a single `UPDATE`:

```sql
UPDATE public.expense_details
SET foreign_basic_amount  = basic_amount,
    foreign_gst_amount    = cgst_amount + sgst_amount + igst_amount,
    foreign_currency_code = 'INR';
```

`foreign_total_amount` does not need backfilling — it's a GENERATED STORED column, populated automatically when `foreign_basic_amount` and `foreign_gst_amount` are set.

The migration adds the columns with safe defaults first (so `NOT NULL` is satisfied during ADD), runs the backfill, then optionally drops the defaults on `foreign_basic_amount` if we want to force callers to specify it on every INSERT.

### 3.5 Final shape of `expense_details` (amount-related columns)

```
─────────────────────────────────────────────────────────────────────────────
INR side (existing — kept as canonical reimbursement amounts)
─────────────────────────────────────────────────────────────────────────────
basic_amount             NUMERIC(12,2)                    NOT NULL  CHECK (> 0)
cgst_amount              NUMERIC(12,2)                    NOT NULL DEFAULT 0
sgst_amount              NUMERIC(12,2)                    NOT NULL DEFAULT 0
igst_amount              NUMERIC(12,2)                    NOT NULL DEFAULT 0
total_amount             NUMERIC GENERATED ALWAYS AS
                           (basic_amount + cgst_amount + sgst_amount + igst_amount) STORED
currency_code            public.local_currency_code       NOT NULL DEFAULT 'INR'

─────────────────────────────────────────────────────────────────────────────
Foreign side (new — always populated; equals INR side for domestic expenses)
─────────────────────────────────────────────────────────────────────────────
foreign_basic_amount     NUMERIC(14,2)                    NOT NULL  CHECK (> 0)
foreign_gst_amount       NUMERIC(14,2)                    NOT NULL DEFAULT 0  CHECK (>= 0)
foreign_total_amount     NUMERIC GENERATED ALWAYS AS
                           (foreign_basic_amount + foreign_gst_amount) STORED
foreign_currency_code    public.foreign_currency_code     NOT NULL DEFAULT 'INR'
```

## 4. Semantic model

| Column group                                                         | Always populated    | Represents                                                                                                |
| -------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| `basic_amount`, `cgst/sgst/igst_amount`, `total_amount`              | Yes                 | INR-equivalent amount; what finance reimburses; what reports aggregate.                                   |
| `currency_code`                                                      | Yes, always `'INR'` | Locked by the `local_currency_code` enum.                                                                 |
| `foreign_basic_amount`, `foreign_gst_amount`, `foreign_total_amount` | Yes                 | The amount the user actually paid, in `foreign_currency_code`. For INR expenses these equal the INR side. |
| `foreign_currency_code`                                              | Yes                 | `'INR'` for domestic expenses; another enum value for foreign.                                            |

**Reads stay uniform.** A frontend showing "what did the user pay?" reads `foreign_basic_amount` / `foreign_total_amount` / `foreign_currency_code` directly — no NULL handling, no fallback, no branching. A report showing "what does finance reimburse?" reads `basic_amount` / `total_amount`.

**"Is this a foreign expense?"** is answered by `foreign_currency_code <> 'INR'` — not by NULL checks.

## 5. Example rows

**INR ₹2,360 expense (basic ₹2,000 + IGST ₹360):**

```
basic_amount          = 2000.00      cgst_amount          = 0.00
sgst_amount           = 0.00          igst_amount         = 360.00
total_amount          = 2360.00      currency_code        = 'INR'
foreign_basic_amount  = 2000.00      foreign_gst_amount   = 360.00
foreign_total_amount  = 2360.00      foreign_currency_code = 'INR'
```

**USD $525 expense (basic $500 + tax $25, ₹44,250 on card):**

```
basic_amount          = 42150.00     cgst_amount          = 0.00
sgst_amount           = 0.00          igst_amount         = 0.00
total_amount          = 42150.00     currency_code        = 'INR'
foreign_basic_amount  = 500.00       foreign_gst_amount   = 25.00
foreign_total_amount  = 525.00       foreign_currency_code = 'USD'
```

(Indian GST on foreign expenses is independent — it can be filled in if reverse-charge applies, or left at 0 otherwise. No CHECK constraint links the two sides.)

## 6. Migration outline

A single new migration file under `supabase/migrations/`:

1. `CREATE TYPE public.local_currency_code AS ENUM ('INR');`
2. `CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');`
3. `ALTER TABLE expense_details ALTER COLUMN currency_code TYPE local_currency_code USING currency_code::local_currency_code` (with DROP/SET DEFAULT around the cast).
4. `ALTER TABLE expense_details ADD COLUMN foreign_basic_amount NUMERIC(14,2) NOT NULL DEFAULT 0` (temporary default to satisfy NOT NULL during ADD).
5. Same for `foreign_gst_amount`, `foreign_currency_code` (with their respective defaults).
6. Backfill: `UPDATE expense_details SET foreign_basic_amount = basic_amount, foreign_gst_amount = cgst_amount + sgst_amount + igst_amount, foreign_currency_code = 'INR';`
7. Add CHECK constraint: `foreign_gst_amount >= 0`. (Skipping `foreign_basic_amount > 0` for now — see deployment note below.)
8. `ALTER TABLE expense_details ADD COLUMN foreign_total_amount NUMERIC GENERATED ALWAYS AS (foreign_basic_amount + foreign_gst_amount) STORED;`

**Deployment note:** The migration intentionally keeps `DEFAULT 0` on `foreign_basic_amount` and omits the `> 0` CHECK for now. This means a deployed migration is safe even if application code hasn't been updated yet — new INSERTs will land with `foreign_basic_amount = 0` rather than failing. A **follow-up migration** (in a later PR, once all INSERT paths populate `foreign_basic_amount` explicitly) will:

- Drop the `DEFAULT 0`.
- Add the `CHECK (foreign_basic_amount > 0)` constraint (validating that all rows satisfy it by then).

This two-step rollout avoids coupling the schema change to the application code change.

A corresponding rollback file under `supabase/rollbacks/` reverses each step in reverse order.

## 7. Downstream impact

**Application code that needs updating** (full list confirmed by implementation plan):

- Repositories that INSERT or UPDATE `expense_details` must populate `foreign_basic_amount`, `foreign_gst_amount`, and `foreign_currency_code`. For now, INR-only forms write the same values as the INR side.
- The expense entry UI gains a currency selector. When non-INR is selected, the form collects original-currency amounts and the INR-equivalent card-charge amount separately.
- `database.ts` regenerated by Supabase CLI; downstream TypeScript consumers pick up new fields. Existing reads of INR columns continue to work.

**Code that does NOT change:**

- Reports and aggregations that read `basic_amount` / `total_amount`.
- Indexes and views referencing existing columns (no renames).
- Historical migrations and rollback files.

**Estimated blast radius:** ~3–5 application files (insert/update paths + the expense entry form). Read paths can adopt `foreign_*` lazily.

## 8. Risks & mitigations

| Risk                                                                                                                | Mitigation                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing `currency_code` has values other than `'INR'` (lowercase, whitespace, etc.) causing the enum cast to fail. | Run `SELECT DISTINCT currency_code FROM expense_details;` pre-flight; clean any anomalies before migrating.                                      |
| Adding a NOT NULL column to a large `expense_details` table locks writes.                                           | Default `0` during ADD satisfies NOT NULL instantly; UPDATE backfill runs in one transaction. Expected to be quick at current table size.        |
| Confusion that `foreign_currency_code` can be `'INR'`.                                                              | Document the always-filled model in code comments on the columns and in repository code. Reads stay uniform — this is the trade-off we accepted. |
| Future need for additional currencies.                                                                              | `ALTER TYPE foreign_currency_code ADD VALUE 'XYZ'` — no table rewrite, no migration of existing rows.                                            |

## 9. Open items deferred to implementation plan

- Exact migration filename / timestamp.
- Whether to update existing INSERT/UPDATE paths in this PR or a follow-up PR. The schema migration alone is safe to deploy (default `0` covers code that hasn't been updated yet); a follow-up migration tightens the constraint once all writers populate the field.
- UI design for the currency selector and the "amount paid in INR" field. Minimal viable shape: dropdown for currency + conditional second amount field when non-INR is selected.
