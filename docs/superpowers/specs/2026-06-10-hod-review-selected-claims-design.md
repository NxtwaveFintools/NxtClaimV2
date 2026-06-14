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
2. **List = two sections (Expense / Advance), grouped by submitter.** The list is split
   into an "Expense claims" section and an "Advance claims" section (by `detailType`).
   Within each section, claims are grouped by submitter (name + email) and amounts are
   **summed** (e.g. one submitter with ₹10 + ₹20 → ₹30), then rows are sorted by that
   summed total, descending. An empty section is hidden. The underlying bulk action still
   operates on the individual claim IDs.
3. **No chart — dense list instead.** The pie chart and Recharts were removed from the
   modal per final UI feedback. Instead, each **Expense** submitter row lists the distinct
   expense categories across that submitter's claims as a comma-separated string under the
   email (e.g. "Accommodation Domestic, Offline Marketing"). Advance rows do **not** show
   categories. (Recharts remains a project dependency, still used by `analytics-charts.tsx`.)
4. **No cross-page toggle in the modal.** The modal does not show a page/all scope toggle
   or notice (removed per UI feedback). The header badge shows the active selected count
   (`selectedCount`), which still reflects the table's global-select state. No server fetch.
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
  - `groupBySubmitterWithTotals(rows): SubmitterGroup[]` — `{ submitter, submitterEmail,
total, claimCount, categories }`, grouped by submitter, amounts summed, distinct
    `categoryName`s joined into `categories` (comma-separated, sorted). Sorted by `total`
    descending (ties by name).
  - `groupSubmittersByDetailType(rows): { expense, advance }` — splits rows by `detailType`
    then groups each side with `groupBySubmitterWithTotals`. Drives the two list sections.
- `src/modules/claims/ui/review-selected-claims-modal.tsx` — the modal (client component),
  fed `rows` (on-page selected), `selectedCount`, approve/reject callbacks, and submitting
  flags. Renders the two submitter-grouped sections (Expense rows show the categories line)
  - footer actions. No chart / no Recharts import.

### Wiring

In `FinanceApprovalsBulkTable`, for `approvalScope === "l1"` only: replace the two header
buttons with a single **"Review Selected Claims"** button (disabled until ≥1 selected)
that opens `ReviewSelectedClaimsModal`. Approve/Reject callbacks reuse the existing
`submitBulkApprove` / bulk-reject logic. Finance branch and the existing reject dialog
remain as-is.

## Modal layout (top → bottom)

1. Header: "Review Selected Claims" + `{selectedCount} selected` badge.
2. Scope clarifier line (only when `selectedCount > rows shown`): "Showing this page's N ·
   Approve / Reject applies to all M claims." Not a toggle.
3. "Expense claims" section: per submitter `Name · Email · (n claims)` + a categories line
   (distinct expense categories) + `Σ Amount`, highest total first.
4. "Advance claims" section: same shape **without** the categories line, hidden when empty.
5. Footer: "Approve All" (green) / "Reject All" (red); Reject reveals inline reason +
   resubmission checkbox.

On success: close modal, clear selection, `router.refresh()`, success toast (existing
`toast.promise`).

## Testing

### Jest / RTL

- `tests/unit/claims/review-selected-claims.test.ts`:
  - `groupBySubmitterWithTotals` sums per submitter (10+20→30), lists distinct categories,
    de-dupes, and sorts desc.
  - `groupSubmittersByDetailType` splits expense/advance, each grouped + sorted with categories.
- `src/modules/claims/ui/review-selected-claims-modal.test.tsx`:
  - Expense rows sum per submitter, sort desc, and show the categories line; advance section
    is separate, shows no categories, and is hidden when empty; scope clarifier appears only
    when more claims are selected than shown.

### Playwright E2E (`tests/e2e/hod-review-selected-claims.spec.ts`)

HOD journey: submit two expense claims (same submitter) → act as the assigned HOD → select
both → open modal → assert visible → assert the two expense claims sum into one
expense-section row (with a categories line) and no advance section appears → assert the scope-toggle box is
absent → Approve All → assert modal closes (primary) + DB advances to finance stage
(primary) + success toast (soft).

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
