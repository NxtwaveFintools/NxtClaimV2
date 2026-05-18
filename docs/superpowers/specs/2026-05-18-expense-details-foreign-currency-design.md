# Expense Details — Foreign Currency Support

**Date:** 2026-05-18
**Status:** Approved — ready to implement (DB-only scope)
**Scope:** Database schema change to `expense_details` to capture original-currency amounts alongside existing INR amounts. Additive only — no column renames. **This phase is DB-only:** schema + one-time backfill of existing rows. No application code changes, no RPC recreations. New claims created after this migration will have `foreign_*` columns at their default values (`0`, `0`, `'INR'`) until a future phase updates the write paths.

---

## 1. Problem

Today, `expense_details` records each expense in INR only. A USD or EUR purchase loses its original-currency representation:

- Receipt reviewers cannot see "$500 USD" on the claim — only the converted INR amount.
- The original transaction-currency amount is lost after entry.
- There is no structured way to record that an expense was incurred in a non-INR currency.

We need to store both representations on the same row: the INR amount finance reimburses, and the original-currency amount the employee actually paid.

## 2. Goals & non-goals

**Goals**

- Add the schema (enums + columns) needed to capture original-currency amounts on `expense_details`.
- Backfill existing rows so the `foreign_*` side mirrors the INR side (one-time, for historical consistency).
- Constrain currency to a small allow-list at the type level (Postgres enum).
- Preserve all existing INR-side semantics and aggregations — nothing about the existing INR columns changes.
- Deploy safely without coupling to any code change.

**Non-goals (this phase)**

- **No application code changes.** No updates to `SupabaseClaimRepository`, no contract changes, no service-layer changes, no test changes. Those land in a later phase that the user will plan separately.
- **No RPC recreations.** `create_claim_with_detail` and `update_claim_by_finance` keep their current bodies; new rows they INSERT get the database column defaults (`foreign_basic_amount = 0`, `foreign_gst_amount = 0`, `foreign_currency_code = 'INR'`, `foreign_total_amount = 0` via GENERATED).
- **No `database.ts` regeneration.** Defer to the next phase when code starts reading the new columns.
- **No UI / currency selector.** Future phase.

**Permanent non-goals**

- No exchange rate capture. The employee supplies both numbers (INR-paid from card statement, original amount from bill); no FX API integration.
- No INR-equivalent recomputation at read time. The INR amount is frozen at entry.
- No rename of existing columns (`basic_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `total_amount`, `currency_code`). Additive only.
- No new `expense_details_foreign` table — extending the existing table is simpler and avoids joins.
- No constraint linking `foreign_currency_code` to the Indian GST columns. The two concerns are independent: GST rules apply per normal logic regardless of the original currency.
- No database trigger or CHECK constraint forcing `foreign_basic_amount = basic_amount`. The two columns are independent at the DB level. The backfill mirrors them once for historical rows; after that, drift is acceptable (Phase B will introduce real divergence for non-INR claims).

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

### 3.4 Backfill (one-time, for historical rows only)

All existing rows are INR-only. They get backfilled in a single `UPDATE`:

```sql
UPDATE public.expense_details
SET foreign_basic_amount  = basic_amount,
    foreign_gst_amount    = cgst_amount + sgst_amount + igst_amount,
    foreign_currency_code = 'INR';
```

`foreign_total_amount` does not need backfilling — it's a GENERATED STORED column, populated automatically when `foreign_basic_amount` and `foreign_gst_amount` are set.

**This UPDATE runs once, during migration.** After that, the two sides are independent at the database level — no trigger, no constraint, no auto-sync.

The migration adds the columns with safe defaults (`0` / `'INR'`) so `NOT NULL` is satisfied during ADD COLUMN even before the backfill UPDATE runs. The defaults persist after the migration too: any new INSERT that doesn't specify `foreign_*` columns will land with `foreign_basic_amount = 0`, `foreign_gst_amount = 0`, `foreign_currency_code = 'INR'` (and `foreign_total_amount = 0` via the GENERATED computation). That is intentional for this phase — application code will be updated to populate real values in a follow-up.

### 3.5 Final shape of `expense_details` (amount-related columns)

```
─────────────────────────────────────────────────────────────────────────────
INR side (existing — kept as canonical reimbursement amounts)
─────────────────────────────────────────────────────────────────────────────
basic_amount             NUMERIC(12,2)                    NOT NULL  CHECK (> 0)
cgst_amount              NUMERIC(12,2)                    NOT NULL DEFAULT 0
sgst_amount              NUMERIC(12,2)                    NOT NULL DEFAULT 0
igst_amount              NUMERIC(12,2)                    NOT NULL DEFAULT 0
total_amount             NUMERIC(14,2)                    NOT NULL
                           ← regular column; written explicitly by callers /
                             the create_claim_with_detail RPC. Was GENERATED in
                             the original schema but dropped and recreated as
                             a plain column in migration 20260512100000 (audit
                             refactor) to allow finance approve-amount edits.
currency_code            public.local_currency_code       NOT NULL DEFAULT 'INR'

─────────────────────────────────────────────────────────────────────────────
Foreign side (NEW)
  - Historical rows: backfilled once to mirror the INR side.
  - New rows after this migration: default to 0/0/0/'INR' until app code is updated.
─────────────────────────────────────────────────────────────────────────────
foreign_basic_amount     NUMERIC(14,2)                    NOT NULL DEFAULT 0
foreign_gst_amount       NUMERIC(14,2)                    NOT NULL DEFAULT 0  CHECK (>= 0)
foreign_total_amount     NUMERIC(14,2)                    GENERATED ALWAYS AS
                           (foreign_basic_amount + foreign_gst_amount) STORED
foreign_currency_code    public.foreign_currency_code     NOT NULL DEFAULT 'INR'
```

## 4. Semantic model

| Column group                                                         | Always populated    | Represents                                                                                                                              |
| -------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `basic_amount`, `cgst/sgst/igst_amount`, `total_amount`              | Yes                 | INR-equivalent amount; what finance reimburses; what reports aggregate.                                                                 |
| `currency_code`                                                      | Yes, always `'INR'` | Locked by the `local_currency_code` enum.                                                                                               |
| `foreign_basic_amount`, `foreign_gst_amount`, `foreign_total_amount` | Yes (never NULL)    | Historical rows: equal to INR side. New rows post-migration: `0` until app code is updated. Future foreign claims: real foreign amount. |
| `foreign_currency_code`                                              | Yes                 | `'INR'` for historical and most current rows; another enum value once foreign-currency entry ships.                                     |

**Independence note:** `basic_amount` and `foreign_basic_amount` are independent columns. The backfill UPDATE makes them equal for existing rows, but there is no trigger or constraint keeping them in sync afterward. Direct SQL UPDATEs to one will not affect the other.

**"Is this a foreign expense?"** Once foreign-currency entry ships, answer by `foreign_currency_code <> 'INR'`. Until then, all rows have `foreign_currency_code = 'INR'`.

## 5. Example rows

**Historical INR row (backfilled by this migration) — ₹2,360 expense (basic ₹2,000 + IGST ₹360):**

```
basic_amount          = 2000.00      cgst_amount          = 0.00
sgst_amount           = 0.00          igst_amount         = 360.00
total_amount          = 2360.00      currency_code        = 'INR'
foreign_basic_amount  = 2000.00      foreign_gst_amount   = 360.00     ← backfilled = INR side
foreign_total_amount  = 2360.00      foreign_currency_code = 'INR'
```

**New row created after this migration (app code not yet updated):**

```
basic_amount          = 2000.00      cgst_amount          = 0.00
sgst_amount           = 0.00          igst_amount         = 360.00
total_amount          = 2360.00      currency_code        = 'INR'
foreign_basic_amount  = 0.00         foreign_gst_amount   = 0.00       ← column defaults
foreign_total_amount  = 0.00         foreign_currency_code = 'INR'
```

**Future USD $525 expense (after Phase B ships):**

```
basic_amount          = 42150.00     cgst_amount          = 0.00
sgst_amount           = 0.00          igst_amount         = 0.00
total_amount          = 42150.00     currency_code        = 'INR'
foreign_basic_amount  = 500.00       foreign_gst_amount   = 25.00
foreign_total_amount  = 525.00       foreign_currency_code = 'USD'
```

(Indian GST on foreign expenses is independent — it can be filled in if reverse-charge applies, or left at 0 otherwise. No CHECK constraint links the two sides.)

## 6. Migration outline

A single new migration file under `supabase/migrations/`, schema-only — no RPC recreations, no function changes:

1. **Pre-flight assertion** — refuse to migrate if any existing row has `currency_code` other than `'INR'`.
2. `CREATE TYPE public.local_currency_code AS ENUM ('INR');`
3. `CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');`
4. `ALTER TABLE expense_details ALTER COLUMN currency_code TYPE local_currency_code USING currency_code::local_currency_code` (with DROP/SET DEFAULT around the cast).
5. `ALTER TABLE expense_details ADD COLUMN foreign_basic_amount NUMERIC(14,2) NOT NULL DEFAULT 0`.
6. Same for `foreign_gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0`.
7. Same for `foreign_currency_code public.foreign_currency_code NOT NULL DEFAULT 'INR'`.
8. **One-time backfill:** `UPDATE expense_details SET foreign_basic_amount = basic_amount, foreign_gst_amount = cgst_amount + sgst_amount + igst_amount, foreign_currency_code = 'INR';`
9. Add CHECK constraint: `foreign_gst_amount >= 0`.
10. `ALTER TABLE expense_details ADD COLUMN foreign_total_amount NUMERIC(14,2) GENERATED ALWAYS AS (foreign_basic_amount + foreign_gst_amount) STORED;`

**What this migration does NOT touch:**

- The two RPCs (`create_claim_with_detail`, `update_claim_by_finance`) — they keep their current bodies. Rows they INSERT will get the column defaults (`0`/`'INR'`).
- Any view (`vw_admin_claims_dashboard`, etc.) — they read columns that aren't renamed.
- Any application code, contract, or type file.

**Deployment is safe in isolation.** Because the new columns have defaults, every existing INSERT path keeps working without modification. New rows simply get `0`/`'INR'` in the foreign columns until a follow-up phase updates the writers.

A corresponding rollback file under `supabase/rollbacks/` reverses each step in reverse order.

## 7. Downstream impact (this phase)

**Code that changes in this phase: NONE.**

- No repository changes.
- No contract / type changes.
- No service-layer changes.
- No `database.ts` regeneration (defer until consumers actually read the new columns).
- No view changes (they read columns that aren't renamed).
- No test changes.

**What WILL be deferred to a future phase** (planned separately by the user):

- Update writers (`SubmitClaimService` prepare, `createExpenseDetailDraft` INSERT, `updateClaimDetailsBySubmitter` UPDATE, the two RPCs) to populate `foreign_*` with real values rather than relying on defaults.
- Regenerate `database.ts`.
- Update fixtures + tests.
- UI design for the currency selector and the "amount paid in INR" field.

**Blast radius of THIS phase: 1 migration file + 1 rollback file. No source code touched.**

## 8. Risks & mitigations

| Risk                                                                                                                | Mitigation                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing `currency_code` has values other than `'INR'` (lowercase, whitespace, etc.) causing the enum cast to fail. | Run `SELECT DISTINCT currency_code FROM expense_details;` pre-flight; clean any anomalies before migrating.                                      |
| Adding a NOT NULL column to a large `expense_details` table locks writes.                                           | Default `0` during ADD satisfies NOT NULL instantly; UPDATE backfill runs in one transaction. Expected to be quick at current table size.        |
| Confusion that `foreign_currency_code` can be `'INR'`.                                                              | Document the always-filled model in code comments on the columns and in repository code. Reads stay uniform — this is the trade-off we accepted. |
| Future need for additional currencies.                                                                              | `ALTER TYPE foreign_currency_code ADD VALUE 'XYZ'` — no table rewrite, no migration of existing rows.                                            |

## 9. Items deferred to a future phase (user will plan separately)

- Update the two RPC functions to write `foreign_*` from the JSON payload.
- Update the JS write paths (`createExpenseDetailDraft`, `updateClaimDetailsBySubmitter`) to write `foreign_*`.
- Update domain contracts (`PreparedClaimSubmission.expense`, `FinanceExpenseEditPayload`, `OwnExpenseEditPayload`) with `foreign*` fields.
- Regenerate `src/types/database.ts`.
- Update unit and E2E test fixtures.
- UI for currency selector + INR-paid input.
- Decide whether the post-app-update follow-up migration tightens the `foreign_basic_amount` default (drop `DEFAULT 0`, add `CHECK (> 0)`) — possibly unnecessary if writers always populate it.
