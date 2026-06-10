# HOD "Review Selected Claims" Modal — Design

Date: 2026-06-10
Status: Approved
Scope: HOD approvals view (`approvalScope === "l1"`) only

## Problem

In the approvals table (`FinanceApprovalsBulkTable`), HOD users currently act on
selected claims via standalone "Bulk Approve" / "Bulk Reject" buttons in the table
header. We want HODs to review the selected set — its category mix and the per‑submitter
totals — before approving or rejecting in bulk.

## Confirmed decisions

1. **Scope:** HOD (`l1`) only. The Finance (`l2`) view is untouched — it keeps its
   existing Bulk Approve / Bulk Reject / Mark Paid buttons and the existing standalone
   reject dialog. (Note: the current code also renders Bulk Approve/Reject for the
   finance scope; we intentionally do not change that.)
2. **List = grouped by submitter.** Selected claims are grouped by submitter
   (name + email); each group shows the **summed** amount (e.g. one submitter with
   ₹10 + ₹20 → ₹30). Rows are sorted by that summed total, descending. A submitter with
   one claim is a group of one. The underlying bulk action still operates on the
   individual claim IDs.
3. **Pie chart = summed amount per expense category.** Category = `categoryName` (the
   expense category, e.g. "Travel Domestic", "Food"; advance claims group as "Advance").
   Slice value is the **sum of `totalAmount`**, not a count.
4. **Cross-page viz:** No new server fetch. The pie chart and list always reflect the
   on-page selected rows. When "select all across pages" is active, a notice shows
   "Charting this page's N claims · M total selected" and a toggle flips the **action
   target** (and the displayed count) between "This page (N)" and "All M".
5. **Reject inputs inline:** "Reject All" reveals a reason textarea (min 5 chars) +
   "allow resubmission" checkbox inside the same modal, then confirms.
6. **No migration / no new server action.** Reuses `bulkApproveL1` / `bulkRejectL1`.

## Architecture

### Data threading

`totalAmount` (numeric) and `categoryName` (expense category) both exist on the
pending-approval record. `totalAmount` is dropped in the mapping in
`claims-approvals-section.tsx`; `categoryName` is already passed but was untyped. Add both
`totalAmount: number` and `categoryName: string` to `FinanceApprovalRow`. Do **not** parse
the `formattedTotalAmount` currency string. `categoryName` is derived from the enriched
`category_name` column (source: `master_expense_categories`) in `SupabaseClaimRepository`.

### New units

- `src/modules/claims/utils/review-selected-claims.ts` — pure helpers (testable core):
  - `groupByCategory(rows): CategoryDatum[]` — `{ category, total }` summing `totalAmount`
    per `categoryName` (expense category). Stable order by total desc.
  - `groupBySubmitterWithTotals(rows): SubmitterGroup[]` — `{ submitter, submitterEmail,
total, claimCount }`, sorted by `total` descending (ties broken by submitter name).
  - `formatAmount(value)` — reuse `formatCurrency` from `@/lib/format`.
- `src/modules/claims/ui/review-selected-claims-modal.tsx` — the modal (client component),
  fed `rows` (on-page selected), `selectedCount`, `totalSelectableCount`, `isGlobalSelect`,
  toggle/approve/reject callbacks, and submitting flags.

### Wiring

In `FinanceApprovalsBulkTable`, for `approvalScope === "l1"` only: replace the two header
buttons with a single **"Review Selected Claims"** button (disabled until ≥1 selected)
that opens `ReviewSelectedClaimsModal`. Approve/Reject callbacks reuse the existing
`submitBulkApprove` / bulk-reject logic. Finance branch and the existing reject dialog
remain as-is.

## Modal layout (top → bottom)

1. Header: "Review Selected Claims".
2. Pie chart: summed amount by `categoryName` / expense category (Recharts, matching `analytics-charts.tsx`).
3. Sorted list: `Name · Email · Σ Amount · (n claims)`, highest total first.
4. Selection context + toggle (only when `totalSelectableCount > on-page count`).
5. Footer: "Approve All" (green) / "Reject All" (red); Reject reveals inline reason +
   resubmission checkbox.

On success: close modal, clear selection, `router.refresh()`, success toast (existing
`toast.promise`).

## Testing

### Jest / RTL

- `tests/unit/claims/review-selected-claims.test.ts`:
  - `groupByCategory` sums amounts per category.
  - `groupBySubmitterWithTotals` sums per submitter (10+20→30) and sorts desc.
- `src/modules/claims/ui/review-selected-claims-modal.test.tsx`:
  - Renders the correct number of grouped submitter rows (Recharts mocked).

### Playwright E2E (`tests/e2e/hod-review-selected-claims.spec.ts`)

HOD journey: submit two claims (same submitter) → act as the assigned HOD → select both →
open modal → assert visible → assert pie present → assert the two claims collapse into one
submitter row whose amount is the **sum** → toggle scope (if cross-page) → Approve All →
assert modal closes (primary) + DB advances to finance stage (primary) + success toast (soft).

Decision (revised from the original mock-first plan): the spec runs the **real**
`bulkApproveL1` server action rather than a `page.route` mock. Next.js server actions return
a React Flight stream that cannot be reliably hand-mocked across versions, and the real
action gives a genuine toast + DB transition to assert. This is the seeded-integration style
used by `bulk-actions-lifecycle.spec.ts`. The two claims share a submitter, so they exercise
the summed-total grouping rule; ordering between multiple submitter groups is covered by the
`groupBySubmitterWithTotals` unit tests, not the E2E.

This E2E requires the live stack (dev server + seeded Supabase + `global.setup.ts` auth
states + browsers) and was **not executed** in the implementation environment.

## Out of scope

Finance view changes, removal of the standalone bulk-reject dialog, cross-page data fetch,
new server actions, DB migrations.
