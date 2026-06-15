# Employee Drill-Down Analytics — Design Spec

**Date:** 2026-06-15
**Status:** Approved for implementation
**Related:** `docs/analytics-employee-drilldown-architecture.md` (feasibility recon)

## 1. Goal

Add an **Employee Master–Detail drill-down** to the Analytics Command Center, and expose the **Expense Category filter to plain HOD (approver1) scope**. Existing macro-analytics (KPIs, charts, raw summaries) remain fully intact.

## 2. Locked Decisions

| #   | Decision            | Choice                                                                                 |
| --- | ------------------- | -------------------------------------------------------------------------------------- |
| 1   | Build scope         | **Full feature end-to-end** (DB + repo/service + UI + filter + tests)                  |
| 2   | HOD filter widening | **Expense Category only** (department/product stay hidden for plain HOD)               |
| 3   | On-behalf grouping  | **By beneficiary** (`employee_id` / `employee_name`)                                   |
| 4   | Detail fetch        | Lazy, via server action keyed by `employeeId`                                          |
| 5   | Status default      | `Submitted - Awaiting HOD approval`, tri-state sentinel, scoped to the drill-down only |

## 3. Data Source

Row-level view `vw_enterprise_claims_dashboard` (NOT the rollup cache `claims_analytics_daily_stats`, which has no employee dimension). Columns used: `employee_id`, `employee_name`, `amount`, `status`, `detail_type` (`expense`/`advance`), `category_name`, `expense_category_id`, `department_id`, `assigned_l2_approver_id`, `submitted_on`, `submission_type`.

For On-Behalf rows the view's `employee_id` is already the beneficiary, so `GROUP BY employee_id, employee_name` yields beneficiary grouping with no special-casing. (Self rows: beneficiary == submitter.)

## 4. Database — new migration + matching rollback

**Migration:** `supabase/migrations/20260615000000_employee_drilldown_analytics.sql`
**Rollback:** `supabase/rollbacks/20260615000000_employee_drilldown_analytics_rollback.sql` (`DROP FUNCTION` for both, IF EXISTS, with full arg signatures).

Both functions `SECURITY INVOKER` (match the view's existing security model) and `STABLE`.

### 4.1 `get_employee_claim_master`

```text
get_employee_claim_master(
  p_scope text,
  p_hod_department_ids uuid[],
  p_finance_approver_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_status claim_status,            -- NULL = all statuses
  p_expense_category_id uuid,       -- NULL = all categories
  p_employee_search text,           -- NULL/'' = no search; ILIKE on name + id
  p_finance_pipeline_statuses claim_status[]
) RETURNS TABLE (
  employee_id    text,
  employee_name  text,
  total_amount   numeric,
  claim_count    integer,
  expense_amount numeric,
  advance_amount numeric
)
```

- Filters: `submitted_on` within `[p_date_from, p_date_to]`; scope predicate by `p_scope`:
  - `hod` → `department_id = ANY(p_hod_department_ids)`
  - `finance` → `status = ANY(p_finance_pipeline_statuses) OR assigned_l2_approver_id = ANY(p_finance_approver_ids)`
  - `admin` → no scope restriction
- Optional `p_status`, `p_expense_category_id`, `p_employee_search` applied when non-null.
- `expense_amount` = `SUM(amount) FILTER (WHERE detail_type = 'expense')`; `advance_amount` = `... 'advance'`.
- `GROUP BY employee_id, employee_name`, `ORDER BY total_amount DESC`.

### 4.2 `get_employee_claim_detail`

```text
get_employee_claim_detail(
  p_employee_id text,
  <same scope/date/status/category/pipeline params as master>
) RETURNS jsonb
{
  "totalAmount": numeric, "expenseAmount": numeric, "advanceAmount": numeric,
  "claimCount": integer,
  "categoryBreakdown": [ { "expenseCategoryId": uuid|null, "categoryName": text, "count": int, "amount": numeric }, ... ]
}
```

- Same scope/date/status/category filters as master, plus `employee_id = p_employee_id`.
- `categoryBreakdown` ordered by `amount DESC`.

## 5. Repository / Service

### 5.1 Contract (`src/core/domain/dashboard/contracts.ts`)

Add types: `EmployeeMasterRow`, `EmployeeDetail`, `EmployeeCategoryBreakdownItem`, and `getEmployeeMaster()` / `getEmployeeDetail()` on `DashboardAnalyticsRepository`.

### 5.2 Repository (`SupabaseDashboardRepository`)

- `getEmployeeMaster(input)` → `client.rpc("get_employee_claim_master", {...})`, normalized via existing `toNumber`/`toInteger`.
- `getEmployeeDetail(input)` → `client.rpc("get_employee_claim_detail", {...})`, normalize jsonb.
- HOD-empty guard mirrors `getAnalyticsPayload` (return empty when `scope === 'hod'` and no department ids).

### 5.3 Service (`src/core/domain/dashboard/GetEmployeeDrilldownService.ts` — new, single purpose)

- Resolves viewer context + scope (reuse `getAnalyticsViewerContext`, `resolveDashboardAnalyticsScope`).
- Validates `expenseCategoryId` against allowed options for the scope (incl. new HOD branch).
- Resolves status tri-state: absent → default `Submitted - Awaiting HOD approval`; `all` → undefined; else the value (validated against `DB_CLAIM_STATUSES`).
- Returns `{ master: EmployeeMasterRow[], appliedStatus, appliedCategoryId }`.
- A server action `getEmployeeDetailAction(employeeId, filters)` calls `getEmployeeDetail` for lazy detail.

## 6. HOD Category Filter (category only)

- `getAnalyticsFilterOptions`: add an **approver1** branch returning expense categories (departments/products `[]` for plain HOD). Add a dedicated boolean flag `canUseCategoryFilter` to `DashboardAnalyticsAdvancedFilters` (true for admin/finance/approver2 **and** plain HOD); the filter bar renders the Expense Category dropdown whenever `canUseCategoryFilter` is true, while Department/Product/Finance-Approver dropdowns stay gated on the existing `canUseScopeFilters` / `canUseFinanceApproverFilter` flags. For plain HOD only `canUseCategoryFilter` is true.
- `GetAnalyticsService`: permit `expenseCategoryId` validation when the HOD category branch is active (keep department/product rejection unchanged for plain HOD).
- `analytics-filters.tsx`: render the Expense Category `<select>` when the category-only flag is set, independent of the full `canUseScopeFilters` block. No change to existing admin/finance/approver2 rendering.

## 7. UI

Appended after `AnalyticsChartsFetcher` in `page.tsx`, inside its own `<Suspense>`. No edits to existing fetchers.

```
EmployeeDrilldownFetcher (server)
  → EmployeeDrilldown (client)            // useState(selectedEmployeeId)
     ├─ EmployeeMasterList  (left)        // sorted High→Low, debounced search input
     └─ EmployeeDetailPanel (right)       // total · expense/advance · category breakdown
```

- Debounced employee search (~350ms) pushes `employee=` URL param; HOD list small enough to also filter client-side.
- Detail loaded lazily via `getEmployeeDetailAction` on row select; skeleton while pending.
- Status: tri-state `status` / `status=all` resolved in a **separate helper** feeding only this section; "Reset" sets `status=all`.
- Design tokens reused verbatim: glass cards (`border-white/30 bg-white/60 dark:bg-zinc-900/55`), sky/cyan accents, `shimmer-sweep` skeletons, `CountUp` + `formatCurrency`, `grid xl:grid-cols-[320px_1fr]`.

## 8. Testing

### 8.1 Jest (unit) — `tests/unit/dashboard/`

- `get-employee-drilldown.service.test.ts`: master sorting High→Low; expense/advance split; beneficiary grouping; status default vs `all` vs explicit; HOD category-scope validation (category allowed, department/product rejected); unauthorized scope.
- `supabase-dashboard-repository.employee.test.ts`: RPC argument mapping + normalization, HOD-empty guard, jsonb detail parsing — faked Supabase client mirroring existing repo tests.
- Filter-options test for the new HOD approver1 category branch.

### 8.2 Playwright (e2e) — `tests/e2e/`

- `analytics-employee-drilldown.spec.ts`: section renders with employees sorted High→Low; selecting an employee shows total + expense/advance + category breakdown; HOD category filter narrows the master list. Mirror auth/setup of `analytics-finance-raw-summary.spec.ts`.

## 9. Safeguards / Non-Goals

- **No** changes to `claims_analytics_daily_stats`, `get_dashboard_analytics_payload`, or existing KPI/chart/raw fetchers.
- **No** status param added to the shared `resolveAnalyticsQueryParams()`.
- HOD never sees other departments' employees (RPC predicate + category options both department-restricted).
- Non-goals: department/product filters for plain HOD; editing existing macro analytics; touching the rollup trigger pipeline.

## 10. Verification Criteria

1. New migration applies cleanly; rollback drops both functions and leaves schema as before.
2. `get_employee_claim_master` returns beneficiary-grouped rows sorted High→Low for each scope; category + status + search filters work.
3. Jest unit suite passes (service + repository + filter options).
4. Playwright e2e passes (render, selection detail, HOD category narrowing).
5. Existing analytics page renders unchanged for all roles (manual/e2e smoke).
