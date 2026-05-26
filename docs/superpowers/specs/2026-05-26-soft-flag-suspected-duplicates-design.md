---
title: Soft Flag Suspected Duplicate Detection
date: 2026-05-26
status: approved
---

## Overview

An additive duplicate-detection system that soft-flags expense claims sharing the same `bill_no` and `transaction_date` but with different amounts. The existing hard-block (exact bill_no + date + amount) remains completely intact. Finance users see a warning banner with links to suspect duplicates; no other role sees it.

## Architecture Decision

**Option B — Postgres RPC (chosen for atomicity).**  
Bidirectional array updates (claim A → B, claim B → A) must be atomic to prevent partial-update inconsistencies in a financial audit context. A single `sync_duplicate_flags` SQL function handles this in one transaction.

## Components

### 1. Database Migration (`supabase/migrations/20260526000000_soft_flag_suspected_duplicates.sql`)

- **New column:** `expense_details.suspected_duplicate_ids uuid[] NOT NULL DEFAULT '{}'`
- **RPC:** `public.sync_duplicate_flags(p_claim_id uuid, p_bill_no text, p_transaction_date date)`
  - Finds all active `expense_details` rows with matching `bill_no + transaction_date` but different `claim_id`
  - Atomically overwrites current claim's array with matched IDs
  - Appends current claim's ID into each matched claim's array (deduplicated)
- **Backfill:** `UPDATE expense_details` grouping by `(bill_no, transaction_date)` among active rows, populating each row's array with the other claim IDs in the same group

### 2. Repository Method (`SupabaseClaimRepository`)

```ts
async syncExpenseDuplicateFlags(input: {
  claimId: string;
  billNo: string;
  transactionDate: string;
}): Promise<{ errorMessage: string | null }>
```

Calls `supabase.rpc('sync_duplicate_flags', { p_claim_id, p_bill_no, p_transaction_date })`.

### 3. Submission Logic (`src/modules/claims/actions.ts`)

- In `submitClaimAction`: after the exact-match pre-check passes and the claim + expense_detail are created, call `repository.syncExpenseDuplicateFlags(...)`. Non-fatal — log warning on failure, never roll back the submission.
- In `updateClaimByFinanceAction`: after a successful save, if the Finance edit payload mutated `billNo` or `transactionDate`, call `repository.syncExpenseDuplicateFlags(...)` with the new values. Also non-fatal.

### 4. Finance-Only UI Banner (`src/app/(dashboard)/dashboard/claims/[id]/page.tsx`)

- **Condition:** `isFinanceActor && claim.expense?.suspectedDuplicateIds?.length > 0`
- **Appearance:** Orange/amber background, `AlertTriangle` icon, text: `"Suspected Duplicate: This bill number and date match [N] other claim(s)."`
- **Links:** One `<Link target="_blank">` per duplicate claim ID, pointing to `/dashboard/claims/{id}`
- **Position:** Below the rejection-reason banner, above the hero section

The `getClaimDetailById` repository method and its underlying DB view must expose `suspected_duplicate_ids` from `expense_details`.

### 5. E2E Tests (`tests/e2e/claims/fraud-duplicate-detection.spec.ts`)

| Test                         | Assertion                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Hard-block regression        | Exact duplicate (same amount) blocked; DB count unchanged                      |
| Soft-flag on amount-variant  | Claim succeeds; both claims' `suspected_duplicate_ids` contain each other's ID |
| Banner hidden from Submitter | No "Suspected Duplicate" text visible when logged in as submitter              |
| Banner visible to Finance    | Banner, count, and `target="_blank"` links present when logged in as Finance   |

## Constraints

- **Additive only** — no existing constraints, pre-checks, or migrations are modified.
- **Non-fatal sync** — `syncExpenseDuplicateFlags` failure never blocks submission or Finance edit.
- **Finance-only** — banner strictly gated on `isFinanceActor`.
- **No DB execution** — migration file is created locally only; user runs `npx supabase db push`.
