# HOD Pending Claims Summary Modal — Design Spec

**Date:** 2026-06-18  
**Status:** Approved for implementation  
**Target page:** `/dashboard/my-claims` (approvals view, L1/HOD scope only)

---

## 1. Problem Statement

When an HOD arrives at their Claims approvals queue, they have no immediate visibility into the financial scope of what they are about to approve. They must scan the paginated table to build a mental picture. This feature surfaces a pre-computed summary modal on arrival — Top 10 employees by pending claim amount and Top 10 expense categories — so the HOD can prioritize approvals in seconds.

---

## 2. Scope

In scope:

- PostgreSQL RPC `get_hod_pending_summary` returning aggregated data in one query
- Server Action `getHodPendingSummaryAction` with HOD-role gate
- `HodSummaryController` Client Component (modal + trigger button)
- Integration into `MyClaimsDashboardResolvedContent` on the my-claims page
- Auto-open on default HOD pending status; manual re-open button at all times

Out of scope:

- Finance observability of the same summary (Finance already has a separate HOD-pending page)
- Admin or Department Viewer roles
- Mobile-specific layout breakpoints beyond responsive flex-wrap
- Persistent "don't show again" preference (can be added later via a cookie/localStorage flag)

---

## 3. Architecture Overview

```
MyClaimsDashboardResolvedContent (Server Component)
│
├── [Promise.all] getCachedCurrentUser + getCachedPendingApprovalsViewerContext
│                + getHodPendingSummaryAction(currentStatus)  ← added here, parallel
│
├── Header card (Server)
│   ├── Tab nav (My Submissions / Approvals History / ...)
│   └── HodSummaryController (Client Component) ← new, conditional on L1+approvals
│       ├── "View Summary Dashboard" trigger button
│       └── HodPendingSummaryModal (Radix Dialog portal)
│
└── MyClaimsDashboardPageContent (Server, Suspense-wrapped)
    └── ClaimsApprovalsSection (Server) ← unchanged
```

Data flow:

1. Server Component pre-fetches summary via RPC (runs in parallel, ~50–100ms).
2. Passes `initialData`, `initiallyOpen`, `currentStatus` props to `HodSummaryController`.
3. Client Component auto-opens on mount if `initiallyOpen === true`.
4. If user navigates to a different status filter and clicks the button, Client Component calls the Server Action for fresh data and shows a loading state inside the modal.

---

## 4. Database Layer — RPC `get_hod_pending_summary`

**File:** `supabase/migrations/20260618XXXXXX_hod_pending_summary_rpc.sql`

### Signature

```sql
CREATE OR REPLACE FUNCTION public.get_hod_pending_summary(
  p_hod_user_id    UUID,
  p_target_status  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
```

### Parameters

| Parameter         | Type                | Description                                                                                                        |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `p_hod_user_id`   | `UUID`              | The authenticated HOD's user ID. Maps to `claims.assigned_l1_approver_id`.                                         |
| `p_target_status` | `TEXT DEFAULT NULL` | The DB status string to filter on (e.g., `'Submitted - Awaiting HOD approval'`). `NULL` = all statuses, no filter. |

### CTE Chain (9 CTEs)

```
base_claims
    ├── expense_base      → expense_employees_ranked  → expense_emp_top / others / total
    ├── advance_base      → advance_employees_ranked  → advance_emp_top / others / total
    └── expense_cats_base → expense_cats_ranked       → cat_top / cat_others / cat_total
```

**`base_claims`:** Selects `claim_id`, `on_behalf_of_id`, `detail_type` from `claims` where:

- `assigned_l1_approver_id = p_hod_user_id`
- `is_active = true`
- `(p_target_status IS NULL OR status::text = p_target_status)`

**Beneficiary grouping:** `COALESCE(c.on_behalf_of_id, c.submitted_by)` is the beneficiary key. The schema guarantees `on_behalf_of_id IS NOT NULL` (equal to `submitted_by` for Self claims; the actual beneficiary for On Behalf claims), so this COALESCE is a defensive fallback.

**`expense_base`:** JOINs `expense_details` on `claim_id` where `detail_type = 'expense'` and `expense_details.is_active = true`. Groups by `on_behalf_of_id`, sums `expense_details.total_amount` (computed column: `basic + cgst + sgst + igst`), counts claims.

**`advance_base`:** JOINs `advance_details` on `claim_id` where `detail_type = 'advance'`. Groups by `on_behalf_of_id`, sums `advance_details.requested_amount` (NOT `total_amount` — advance_details uses `requested_amount`), counts claims.

**`expense_cats_base`:** JOINs `expense_details` on `claim_id` where `detail_type = 'expense'` and `expense_details.is_active = true`. Groups by `expense_category_id`, sums `total_amount`.

**Ranked CTEs** (`expense_employees_ranked`, `advance_employees_ranked`, `expense_cats_ranked`): LEFT JOIN to `users` for `full_name`, LEFT JOIN to `master_expense_categories` for `name`. Apply `ROW_NUMBER() OVER (ORDER BY total DESC)`.

Employee name resolution (same pattern as `get_employee_claim_master`):

```sql
COALESCE(
  NULLIF(TRIM(u.full_name), ''),
  NULLIF(TRIM(split_part(u.email, '@', 1)), ''),
  'Unknown'
)
```

**Top 10 + Others aggregation CTEs** (e.g., `expense_emp_top`, `expense_emp_others`, `expense_emp_total`):

- `top`: `jsonb_agg(... ORDER BY amount DESC) WHERE rn <= 10`
- `others`: `SUM(amount) + COUNT(*) WHERE rn > 10`
- `total`: `SUM(amount)` across all rows (grand total, independent of ranking)

> The grand total is computed across ALL rows, not just top 10, ensuring `top_rows_sum + others_total = grand_total` exactly.

### Return Shape

```jsonc
{
  "top_expense_employees": {
    "rows": [
      { "employee_id": "uuid", "employee_name": "Ravi Kumar", "amount": 12400.00, "claim_count": 3 },
      ...  // up to 10 rows
    ],
    "others_total": 5000.00,
    "others_count": 5,
    "grand_total": 50000.00
  },
  "top_advance_employees": {
    "rows": [...],          // empty array if zero advance claims
    "others_total": 0,
    "others_count": 0,
    "grand_total": 0
  },
  "top_expense_categories": {
    "rows": [
      { "category_id": "uuid", "category_name": "Travel", "amount": 15000.00 },
      ...
    ],
    "others_total": 3000.00,
    "others_count": 4,
    "grand_total": 45000.00
  }
}
```

### Security

```sql
REVOKE ALL   ON FUNCTION public.get_hod_pending_summary(UUID, TEXT) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.get_hod_pending_summary(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_hod_pending_summary(UUID, TEXT) TO service_role;
```

Matching the existing `get_employee_claim_master` security model exactly.

---

## 5. Backend Layer — Server Action

**File:** `src/modules/claims/actions/get-hod-summary.ts`

### TypeScript Types (exported)

```typescript
export type HodSummaryEmployeeRow = {
  employee_id: string;
  employee_name: string;
  amount: number;
  claim_count: number;
};

export type HodSummaryLeaderboard = {
  rows: HodSummaryEmployeeRow[];
  others_total: number;
  others_count: number;
  grand_total: number;
};

export type HodSummaryCategoryRow = {
  category_id: string;
  category_name: string;
  amount: number;
};

export type HodSummaryCategoryLeaderboard = {
  rows: HodSummaryCategoryRow[];
  others_total: number;
  others_count: number;
  grand_total: number;
};

export type HodPendingSummaryData = {
  top_expense_employees: HodSummaryLeaderboard;
  top_advance_employees: HodSummaryLeaderboard;
  top_expense_categories: HodSummaryCategoryLeaderboard;
};
```

### `getHodPendingSummaryAction(targetStatus: string | null)`

- Marked `"use server"`
- Calls `getCachedCurrentUser()` — returns `null` on auth failure (both calls are React.cache memoized, zero extra DB hits when called in the same request as the page)
- Calls `getCachedPendingApprovalsViewerContext(userId)` — guards `activeScope !== "l1"` with early `null` return (Finance users, employees, admins cannot trigger this)
- Calls `supabase.rpc("get_hod_pending_summary", { p_hod_user_id: userId, p_target_status: targetStatus })` via `getServiceRoleSupabaseClient()`
- Returns `HodPendingSummaryData | null` — `null` on RPC error (modal silently suppressed)
- No throws — all failures return `null` so auto-open gracefully degrades to "no modal"

---

## 6. Frontend Layer — Component Design

**File:** `src/modules/claims/ui/hod-pending-summary-modal.tsx`

Two exports from this file:

- `HodSummaryController` — Client Component, mounted by the page, owns state
- `HodPendingSummaryModal` — pure presentational modal (no data fetching)

### `HodSummaryController` (Client Component)

**Props:**

```typescript
{
  initialData: HodPendingSummaryData | null;
  initiallyOpen: boolean;
  currentStatus: string | null;
}
```

**State:** `isOpen`, `data` (init from `initialData`), `isLoading`

**Behavior:**

- `useEffect([initiallyOpen])`: if `initiallyOpen === true`, calls `setIsOpen(true)` on mount
- **Trigger button click**: if `data !== null`, opens modal immediately (no re-fetch). If `data === null` (Server Action returned null on SSR), calls `getHodPendingSummaryAction(currentStatus)`, sets loading, then opens on resolution
- The `currentStatus` prop is read-only at mount — this component does not subscribe to URL changes. Status-driven re-fetch on button click is handled by the parent re-rendering with new `initialData` (SSR) on navigation

**Renders:**

1. `<button>` — trigger button, styled to match the page's secondary button pattern (`border border-zinc-200 bg-white/80 ...`). Icon: `LayoutDashboard` from lucide-react. Label: "View Summary"
2. `<HodPendingSummaryModal open={isOpen} onClose={() => setIsOpen(false)} data={data} isLoading={isLoading} currentStatus={currentStatus} />`

### `HodPendingSummaryModal` (Radix Dialog, Client Component)

**Props:** `open`, `onClose`, `data: HodPendingSummaryData | null`, `isLoading`, `currentStatus: string | null`

**Dialog structure:**

```
DialogContent  (max-w-5xl, custom width via className override)
├── DialogHeader
│   ├── DialogTitle — "Pending Claims Summary"
│   └── subtitle — resolves currentStatus to human label, e.g. "Submitted · Awaiting HOD Approval"
│
├── body  (grid grid-cols-1 lg:grid-cols-2 gap-6, with divider)
│   │
│   ├── LEFT PANEL
│   │   ├── LeaderboardSection title="Expense Claims" data={top_expense_employees}
│   │   └── (if top_advance_employees.grand_total > 0)
│   │       LeaderboardSection title="Advance Requests" data={top_advance_employees}
│   │
│   └── RIGHT PANEL
│       └── CategoryLeaderboardSection title="Expense Categories" data={top_expense_categories}
│
└── DialogFooter — small "Amounts are approximate pending final approval" disclaimer
```

**`LeaderboardSection`** (internal sub-component, not exported):

- Header: title + `grand_total` formatted as ₹ amount
- Rows: numbered rank (#1–#10), employee name, amount (right-aligned), `claim_count` sub-label
- "Others" row: renders only when `others_count > 0`, shows `+{others_count} more · ₹{others_total}`; styled distinctly (muted, dashed top border)
- Empty state: "No pending claims" when `rows.length === 0 && grand_total === 0`

**`CategoryLeaderboardSection`** (internal sub-component):

- Same structure as `LeaderboardSection` but no `claim_count` sub-label
- Rows: rank, category name, amount
- "Others" row: same as above

**Loading state:** when `isLoading === true`, renders a skeleton overlay (3 shimmer rows in each panel) instead of data rows.

**Currency formatting:** `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })`. Amounts < ₹1,00,000 rendered as-is (e.g., `₹12,400`). Amounts ≥ ₹1,00,000 abbreviated as `₹1.2L` using a local `formatInrCompact` helper for space efficiency in narrow leaderboard columns. Full amount shown in a tooltip on hover.

**Dark mode:** All elements use Tailwind dark: variants matching the existing `nxt-page-bg` / `dark:bg-zinc-900/92` / `dark:border-zinc-800` aesthetic.

---

## 7. Page Integration — `my-claims/page.tsx`

**Modified function:** `MyClaimsDashboardResolvedContent`

### Conditional pre-fetch

In the existing `Promise.all`:

```typescript
const [isAdminUser, isDeptViewer, viewerContextResult, hodSummaryData] = await Promise.all([
  isAdmin(),
  isDepartmentViewer(),
  getCachedPendingApprovalsViewerContext(userId),
  // Added: only fetch for L1 approvals view to avoid wasted calls
  shouldFetchHodSummary ? getHodPendingSummaryAction(rawStatusParam) : Promise.resolve(null),
]);
```

`shouldFetchHodSummary` is determined before the `Promise.all` by checking URL params:

```typescript
const requestedView = firstParamValue(searchParams?.view);
const rawStatusParam = firstParamValue(searchParams?.status) ?? null;
const isLikelyApprovals = !requestedView || requestedView === "approvals";
const shouldFetchHodSummary = isLikelyApprovals;
```

This resolves to `true` only for the approvals view, so employees/admins on the submissions view don't pay the RPC cost. The RPC returns `null` immediately for non-L1 users due to the Server Action guard anyway, but avoiding the call entirely is cleaner.

### Auto-open condition

```typescript
const isDefaultHodPendingStatus = rawStatusParam === DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS;

const shouldAutoOpen =
  activeView === "approvals" &&
  viewerContextResult.activeScope === "l1" &&
  isDefaultHodPendingStatus &&
  hodSummaryData !== null;
```

### Render integration

Inside the header card's `<div className="flex items-center gap-2">` (alongside the "New Claim" button):

```tsx
{
  activeView === "approvals" && viewerContextResult.activeScope === "l1" ? (
    <HodSummaryController
      initialData={hodSummaryData}
      initiallyOpen={shouldAutoOpen}
      currentStatus={rawStatusParam}
    />
  ) : null;
}
```

The `HodSummaryController` renders the trigger button inline in the header and the Radix Dialog portal globally — no layout disruption to `ClaimsApprovalsSection`.

---

## 8. Business Rules

| Rule                            | Implementation                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| HOD-only access                 | Server Action gates on `activeScope === "l1"`; non-L1 users get `null` data and no modal                         |
| Beneficiary accuracy            | Groups by `COALESCE(on_behalf_of_id, submitted_by)` — On Behalf claims credit the beneficiary, not the submitter |
| Advance vs. Expense separation  | Expense uses `expense_details.total_amount`; Advance uses `advance_details.requested_amount`; never mixed        |
| Advance panel hidden when empty | `top_advance_employees.grand_total === 0` → entire Advance section is unmounted                                  |
| Grand total accuracy            | Others = grand_total − sum(top 10); computed independently from a full-table sum CTE, not as a derived remainder |
| Dynamic status                  | RPC accepts `p_target_status NULL` (all claims) or any `DbClaimStatus` string                                    |
| Auto-open trigger               | Only fires on `status = DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS` (the default HOD pending view)                |
| Graceful degradation            | RPC error → `null` data → modal suppressed; page renders normally without modal                                  |

---

## 9. File Change Summary

| File                                                             | Change                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `supabase/migrations/20260618XXXXXX_hod_pending_summary_rpc.sql` | New migration: RPC function + GRANT/REVOKE                       |
| `src/modules/claims/actions/get-hod-summary.ts`                  | New: Server Action + exported types                              |
| `src/modules/claims/ui/hod-pending-summary-modal.tsx`            | New: `HodSummaryController` + `HodPendingSummaryModal`           |
| `src/app/(dashboard)/dashboard/my-claims/page.tsx`               | Modified: add `HodSummaryController` render + parallel pre-fetch |

---

## 10. Performance Expectations

- **RPC latency target:** < 100ms (pure aggregate, no row fetching, indexed on `assigned_l1_approver_id` + `status`)
- **SSR impact:** Zero sequential latency — runs in parallel with `isAdmin()`, `isDepartmentViewer()`, `getCachedPendingApprovalsViewerContext()` in the existing `Promise.all`
- **Client re-fetch (manual, different status):** ~200–400ms round-trip; covered by modal loading skeleton
- **Bundle size:** No new dependencies — uses existing Radix Dialog, lucide-react, Tailwind

---

## 11. Index Recommendation

The RPC filters on `assigned_l1_approver_id` and `status`. Verify the following index exists (likely already present given the approvals query at line ~1379 in `SupabaseClaimRepository.ts`):

```sql
-- Likely already exists; create if missing:
CREATE INDEX IF NOT EXISTS idx_claims_l1_approver_status
  ON public.claims (assigned_l1_approver_id, status)
  WHERE is_active = true;
```

If this index is absent, add it to the migration file.
