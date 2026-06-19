# Dual Duplicate Detection (invoice + amount/date together)

**Date:** 2026-06-19
**Scope:** The AI / finance-stage graded duplicate path only (`find_claim_duplicates`).
The intake hard-block (`existsExpenseByCompositeKey`) and the soft bidirectional
flag (`sync_duplicate_flags`) are explicitly **out of scope** and untouched.

## Problem

Today `find_claim_duplicates` is _invoice-first_: the amount+date arm is gated by
`WHERE norm.inv IS NULL`, so it only runs when the invoice number is absent. The
result is stored as a single `duplicate_status` enum (`invoice_match` **xor**
`amount_date_match`) plus a single `duplicate_claim_ids[]` on
`claim_verification_runs`, and the claim panel renders one box.

We want both checks to run **independently every time** and to surface both result
sets together — a claim may be an invoice duplicate of one claim, an amount+date
duplicate of another, or both.

## Decisions (locked)

- **Match scope:** Run both arms independently. A claim can match on invoice,
  amount+date, or both, against potentially different peer claims.
- **Approve guard:** The finance "Approve" confirmation dialog fires when **either**
  arm reports a match (today it only fires on `invoice_match`).
- **List badge:** When both arms match, show **two** chips ("Dup: invoice" and
  "Dup: amt+date") side by side.
- **Data model:** Approach A — two parallel typed column-pairs (see below). Rejected
  alternatives: a single `jsonb` column (loses typed CHECK constraints, diverges
  from repo convention) and a combined enum (loses which IDs matched which way,
  conflicts with the two-badge / two-list decisions).

## Architecture

The change is layered. The SQL match logic is a one-line gate removal; the real work
is widening the _result shape_ from one match kind to two independent kinds across
the schema, the RPC, the TS types, and three UI surfaces.

### 1. SQL helper — `find_claim_duplicates`

Both arms always run:

- **Invoice arm:** unchanged — still requires `norm.inv IS NOT NULL` (an invoice
  match is only meaningful when an invoice number is present).
- **Amount+date arm:** change the guard from `WHERE norm.inv IS NULL` to
  `WHERE p_transaction_date IS NOT NULL AND p_total_amount IS NOT NULL`. It now runs
  regardless of invoice presence.

Return signature is unchanged (`claim_id, submitted_by, match_kind` with
`'invoice_match'` / `'amount_date_match'`); we simply stop suppressing one arm. Both
arm indexes (`idx_expense_details_norm_invoice`,
`idx_expense_details_dedup_amount_date`) already exist — no new index.

### 2. Schema — `claim_verification_runs`

Add four columns:

```sql
ADD COLUMN invoice_duplicate_status        text   NOT NULL DEFAULT 'unavailable',
ADD COLUMN invoice_duplicate_claim_ids     text[] NOT NULL DEFAULT '{}',
ADD COLUMN amount_date_duplicate_status    text   NOT NULL DEFAULT 'unavailable',
ADD COLUMN amount_date_duplicate_claim_ids text[] NOT NULL DEFAULT '{}'
```

- Two CHECK constraints: each status ∈ `{none, match, unavailable}`.
- Legacy `duplicate_status` / `duplicate_claim_ids` are **kept** (not dropped) to
  avoid a `CREATE OR REPLACE VIEW` cascade. New code stops writing them; they remain
  at their defaults going forward.
- `claim_latest_verification` view: **append** the four new columns at the end (the
  documented append-only constraint — SQLSTATE 42P16 on reorder). The dependent view
  that LEFT-JOINs this one is unaffected.

### 3. RPC — `complete_verification_run`

`DROP FUNCTION` the existing 8-arg signature and recreate it, replacing the single
`p_duplicate_status text, p_duplicate_claim_ids text[]` pair with the four new
params (`p_invoice_duplicate_status`, `p_invoice_duplicate_claim_ids`,
`p_amount_date_duplicate_status`, `p_amount_date_duplicate_claim_ids`). Update the
`UPDATE ... SET`, the audit-log `format(...)` line, and the grants. Same DROP+CREATE
pattern the original dedup migration used.

### 4. TS — worker + repository

- **`detectDuplicate`** (`SupabaseVerificationRepository.ts`): call the helper once,
  then split rows into **both** result sets (no invoice-wins precedence). Returns
  `{ invoice: { status, claimIds }, amountDate: { status, claimIds } }`.
  - Invoice arm: `unavailable` if `extractedInv === null && submittedInv !== null`
    (AI read failure); else `match` if invoice rows exist; else `none`.
  - Amount+date arm: `match` if amount+date rows exist; else `none`. (`unavailable`
    is a defensive fallback — date/amount are always present for expense claims.)
- **`verification-worker.ts`**: pass both arms through to `completeVerificationRun`.
  The early-exit "unavailable" path (line ~115) sets both arms to `unavailable`.
- **Types** (`SupabaseVerificationRepository.ts`): the summary's scalar
  `duplicateStatus: DuplicateStatus` is replaced by `invoiceDuplicate` and
  `amountDateDuplicate`, each `{ status: DuplicateStatus; claimIds: string[] }`.
  `DuplicateStatus` narrows to `none | match | unavailable`.
- **`getClaimVerificationSummary`** and **`getClaimVerificationSummaries`** (list
  map): select the four new columns and expose both arms.

### 5. UI — three surfaces

- **Detail panel** (`verification-panel.tsx`): the single-box ternary becomes two
  independent blocks — rose "Possible duplicate — same invoice number as:" (shown
  when `invoiceDuplicate.status === 'match'`) and amber "Possible duplicate — same
  amount & date as:" (shown when `amountDateDuplicate.status === 'match'`), each
  listing its own claim IDs.
- **Finance approve guard** (`page.tsx` ~767): set `financeApproveConfirmMessage`
  when **either** `invoiceDuplicate.status === 'match'` OR
  `amountDateDuplicate.status === 'match'`; the message names whichever claim IDs
  matched (both groups when both).
- **List / bulk badge** (`finance-approvals-bulk-table.tsx`): render up to two chips
  independently — "Dup: invoice" (rose) when the invoice arm matches and
  "Dup: amt+date" (amber) when the amount+date arm matches. The summaries map feeding
  the table carries both arms.

## Testing

- **Unit:** extend the `dedup.test.ts`-style coverage for the split logic in
  `detectDuplicate`:
  - a claim matching invoice on peer A and amount+date on a _different_ peer B
    surfaces **both** arms with the correct claim IDs;
  - invoice read-failure (`extractedInv === null && submittedInv !== null`) yields
    invoice `unavailable` but still computes the amount+date arm;
  - neither match → both `none`.
- **E2E** (`fraud-duplicate-detection.spec.ts`): add a case asserting both the panel
  boxes and both list badges appear together when a claim matches on both arms.
- **Migration:** forward + rollback SQL; verify the view appends cleanly, the CHECK
  constraints reject bad values, and the legacy columns remain present.

## Out of scope

- Intake hard-block (`existsExpenseByCompositeKey`) — unchanged.
- Soft bidirectional flag (`sync_duplicate_flags` / `suspected_duplicate_ids`) —
  unchanged.
- Backfilling historical runs' new columns (they stay `unavailable` / `{}` until the
  next verification run; acceptable since the badges/boxes simply don't render for
  `unavailable`).
