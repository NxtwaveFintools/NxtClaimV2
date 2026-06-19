# Analytics Command Center — Employee Drill-Down Architecture & Feasibility

**Status:** Architectural feasibility study (READ-ONLY reconnaissance — no code changed)
**Date:** 2026-06-15
**Author:** Recon pass over `NxtClaimV2`
**Scope:** Add an Employee Master–Detail drill-down + per-employee expense-category filtering to the Analytics Command Center, and surface additional HOD-facing analytics. Existing macro-analytics remain fully intact.

---

## 1. Executive Summary / Verdict

**✅ Highly feasible, low schema risk.** Every dimension the feature needs — employee identity, expense-vs-advance separation, expense category, amounts, status, and TAT timestamps — **already exists** in the row-level view `vw_enterprise_claims_dashboard`. No new tables or migrations are strictly required. The feature can be delivered with **two new read-only RPCs + one appended UI section + one filter-gating change for HOD scope**.

**Two things the recon uncovered that change the plan:**

1. The macro-analytics rollup cache (`claims_analytics_daily_stats`) has **no employee dimension** — the drill-down must read the row-level view directly. This is actually a _benefit_: it keeps the new path physically separate from existing analytics, automatically satisfying the "don't break existing UI" rule.
2. **A plain HOD (approver1 only) does NOT currently get the expense-category / department / product filters at all.** Those filters are gated behind `canUseScopeFilters = isAdmin || isApprover2 || isFinance`. So the requested "filter employees by expense category" requires **exposing the existing global category filter to the HOD (approver1) scope** — scoped to their own department(s).

---

## 2. Current-State Map (what exists today)

### 2.1 Page composition

`src/app/(dashboard)/dashboard/analytics/page.tsx` (server component, `force-dynamic`):

- Reads URL search params → `resolveAnalyticsQueryParams()` → `getCachedAnalyticsResult()` (React `cache`).
- Renders four independent `<Suspense>` fetchers, all keyed on the same param set:
  - `AnalyticsFiltersFetcher` → `AnalyticsFilters` (client)
  - `AnalyticsErrorBannerFetcher`
  - `AnalyticsKpiFetcher` → `AnalyticsKpiCards` (client)
  - `AnalyticsChartsFetcher` → `AnalyticsCharts` (client) + raw summary cards
- **No `status` URL param is read today.** Status is a _breakdown dimension_, not a filter.

### 2.2 Data flow

```
page.tsx
  → GetAnalyticsService.execute({ userId, filter })
    → SupabaseDashboardRepository
       ├─ getAnalyticsViewerContext()   // admin / hod(approver1) / approver2 / finance
       ├─ getAnalyticsFilterOptions()   // departments, categories, products, finance approvers
       └─ getAnalyticsPayload()         // RPC get_dashboard_analytics_payload over rollup cache
```

### 2.3 Scope resolution (`resolve-analytics-scope.ts`)

Priority: `admin` → `finance` → `hod` (approver1) → `null` (unauthorized).

### 2.4 What each role sees TODAY

| Surface                                       | `admin` | `finance`            | `hod` (approver1 only)     |
| --------------------------------------------- | ------- | -------------------- | -------------------------- |
| KPI: Total / Approved / Pending / Rejected    | ✅      | ✅                   | ✅                         |
| KPI: Pending At HOD                           | ✅      | ✅                   | ❌ (filtered out)          |
| KPI: Overall Finance Team TAT                 | ✅      | ❌                   | ❌                         |
| Chart: Payment Mode pie                       | ✅      | ✅                   | ✅                         |
| Chart: Claims By Status bar                   | ✅      | ✅                   | ✅                         |
| Chart: Days-to-Approve by Dept                | ✅      | ❌                   | ❌                         |
| Chart: Days-to-Approve by Finance Approver    | ✅      | ❌                   | ❌                         |
| Raw: Status Summary                           | ✅      | ✅                   | ✅                         |
| Raw: Efficiency / Finance Efficiency          | ✅      | ❌                   | ❌                         |
| **Global filters: Dept / Category / Product** | ✅      | ✅                   | ❌ **(only if approver2)** |
| Global filter: Finance Approver               | ✅      | ❌ (admin/approver2) | ❌                         |

> **Key gap for this feature:** the HOD whose dashboard this drill-down most benefits is exactly the role that currently has _no_ category filter.

---

## 3. Database & RPC Recon

### 3.1 `vw_enterprise_claims_dashboard` — the right source (row-level)

Relevant columns confirmed present:

| Need                   | Column(s)                                                   | Notes                                                         |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Employee (beneficiary) | `employee_id`, `employee_name`                              | Drives the Master list grouping                               |
| Submitter              | `submitted_by` (uuid), `submitter_label`, `submitter_email` | For "On Behalf" claims                                        |
| **Expense vs Advance** | `detail_type` → `'expense'` / `'advance'`                   | Clean 2-value split, already populated                        |
| Category               | `category_name`, `expense_category_id`                      | `category_name='Advance'` aligns with `detail_type='advance'` |
| Amount / Status        | `amount` (numeric), `status` (enum `claim_status`)          | —                                                             |
| TAT timestamps         | `submitted_on`, `hod_action_date`, `finance_action_date`    | Enables processing-time metrics                               |
| Scope keys             | `department_id`, `assigned_l2_approver_id`                  | Reuse existing scope predicates                               |
| Risk flags             | `submission_type` (`Self`/`On Behalf`), `is_vendor_payment` | Value-add metrics                                             |

### 3.2 Data shape (live snapshot, for sizing)

| Metric                                                  | Value         |
| ------------------------------------------------------- | ------------- |
| Total detail rows                                       | 4,015         |
| `detail_type = expense` / `advance`                     | 3,945 / 70    |
| `submission_type` Self / On Behalf                      | 3,015 / 1,000 |
| Distinct employees                                      | **469**       |
| Distinct expense categories                             | **24**        |
| Distinct departments                                    | **39**        |
| Rows awaiting HOD (`Submitted - Awaiting HOD approval`) | 457           |
| Employees awaiting HOD                                  | **107**       |

**Status enum values** (`claim_status`), default target is the first:

1. `Submitted - Awaiting HOD approval` ← **default for the drill-down**
2. `HOD approved - Awaiting finance approval`
3. `Finance Approved - Payment under process`
4. `Payment Done - Closed`
5. `Rejected - Resubmission Not Allowed`
6. `Rejected - Resubmission Allowed`

> Sizing implication: a per-employee master list is small (≤469 globally, ~107 in the default status, far fewer per-department for a HOD). Server-side aggregation is cheap; the list can be fetched whole and searched/sorted client-side for HODs.

### 3.3 Why the rollup cache can't serve this

`claims_analytics_daily_stats` is bucketed by `status / department / payment_mode / expense_category / product / assigned_l2_approver`. **No employee dimension.** Adding `employee_id` to the bucket key would multiply cardinality (~469×) and bloat the trigger-maintained rollup. ➡️ **Read the row-level view directly via new RPCs; leave the cache untouched.**

### 3.4 Theoretical RPC #1 — Master list

```text
get_employee_claim_master(
  p_scope text,
  p_hod_department_ids uuid[],
  p_finance_approver_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_status claim_status,          -- NULL = all statuses (cleared)
  p_department_id uuid,
  p_expense_category_id uuid,     -- per-employee category filter cascades here
  p_product_id uuid,
  p_employee_search text          -- NULL = no search; ILIKE on employee_name / employee_id
) RETURNS TABLE (
  employee_id    text,
  employee_name  text,
  total_amount   numeric,
  claim_count    int,
  expense_amount numeric,
  advance_amount numeric
)
```

- `GROUP BY employee_id, employee_name`, `ORDER BY total_amount DESC` → the required **High → Low**.
- **Reuse the exact scope predicates** already in `SupabaseDashboardRepository`:
  - `hod` → `department_id = ANY(p_hod_department_ids)`
  - `finance` → `status = ANY(pipeline)` OR `assigned_l2_approver_id = ANY(ids)`
  - `admin` → no scope restriction
- `expense_amount` / `advance_amount` via `SUM(amount) FILTER (WHERE detail_type = 'expense' | 'advance')`.

### 3.5 Theoretical RPC #2 — Detail panel (lazy, on selection)

```text
get_employee_claim_detail(p_employee_id text, <same filters as master>)
RETURNS jsonb     -- mirrors get_dashboard_analytics_payload's jsonb pattern
{
  totalAmount, expenseAmount, advanceAmount, claimCount,
  categoryBreakdown: [
    { expenseCategoryId, categoryName, count, amount }, ...   -- e.g. Food: 5, Accommodation: 2
  ]
}
```

Keeps the initial master payload lean; fetched only when a row is selected.

### 3.6 Decision to confirm — on-behalf grouping key

1,000 of 4,015 rows are "On Behalf". Group by **beneficiary** (`employee_id`) or **submitter** (`submitted_by`)?
**Recommendation:** group by **beneficiary**, to stay consistent with commit `de9f632` ("group review modal by beneficiary for on-behalf claims"). Flag for confirmation before build.

---

## 4. Frontend State & Filter Recon

### 4.1 Default status — without breaking macro UI or "clear"

The page reads **no `status` param today**. Two constraints: default to _Submitted – Awaiting HOD_, **and** apply status **only to the new drill-down** (macro KPIs/charts must stay all-status).

**Tri-state sentinel pattern, scoped to the new fetcher only:**

- param **absent** → default `Submitted - Awaiting HOD approval`
- `status=all` → explicitly cleared (no status filter)
- `status=<value>` → that status

Resolve this in a **separate helper feeding only `EmployeeDrilldownFetcher`** — do **not** add `status` to the shared `resolveAnalyticsQueryParams()`, or existing charts would suddenly be filtered. "Reset" sets `status=all`. State stays URL-driven and fully clearable.

### 4.2 Per-employee expense-category filter (the requested behavior)

- The category filter (`category` URL param → `expense_category_id`) **already exists** in `analytics-filters.tsx`, but only renders when `canUseScopeFilters` is true.
- The new master/detail RPCs accept `p_expense_category_id`, so once the param is set the category **cascades into the drill-down for free** — selecting "Food" reduces the employee master list to those with Food claims and recomputes their totals.
- **Required change to satisfy the request for HOD:** expose the category (and optionally department) filter to the **HOD/approver1** scope, restricted to the HOD's own department(s). Concretely, widen `canUseScopeFilters` (or add a HOD-scoped variant) so approver1 HODs get the category dropdown. `getAnalyticsFilterOptions` already has an `approver2DepartmentIds`-style branch that can be generalized to approver1 department ids.

### 4.3 Debounced employee search

- Add a text input to `analytics-filters.tsx`. Hold raw input in `useState`, debounce ~350 ms (`useEffect` + `setTimeout`), then `router.push` an `employee=` param.
- **Perf hybrid:** for **HOD** (bounded, single-department list) client-side filtering of the already-fetched master list is instant; for **admin** (469 employees) prefer server-side search via the debounced param + `p_employee_search`.

---

## 5. Proposed Component Structure

Append **one new section** after `AnalyticsChartsFetcher`, in its own `<Suspense>` — additive, zero edits to existing fetchers:

```text
page.tsx
└─ <Suspense fallback={<EmployeeDrilldownSkeleton/>}>
   └─ EmployeeDrilldownFetcher (server)        // new service → master RPC
      └─ <EmployeeDrilldown> (client)          // owns selectedEmployeeId state
         ├─ EmployeeMasterList  (left)         // scrollable, sorted High→Low, search box
         └─ EmployeeDetailPanel (right)        // total · expense/advance split · category breakdown
```

- **Selection state** in `EmployeeDrilldown` client component (`useState(selectedEmployeeId)`).
- **Detail data**: lazy-fetch via a **server action** keyed by `employeeId` (keeps payload small); or pre-bundle if list is small.
- **Service/repo**: add `getEmployeeMaster()` / `getEmployeeDetail()` to the `DashboardAnalyticsRepository` contract + thin `GetAnalyticsService`-style methods, mirroring existing `getAnalyticsPayload` style and normalization helpers (`toNumber` / `toInteger`).

### 5.1 Design aesthetic (match existing premium dark theme)

Reuse established tokens verbatim:

- Cards: `Card`/`CardHeader`/`CardContent`, `border-white/30 bg-white/60 dark:bg-zinc-900/55`
- Section wrapper: `rounded-[30px] ... bg-gradient-to-br from-sky-100/55 ... dark:from-zinc-900/80`
- Glass filter surface: `border-white/20 bg-white/40 backdrop-blur-md dark:bg-zinc-900/40`
- Labels: `text-xs font-semibold uppercase tracking-[0.14em]`
- Selected-row accent: `border-sky-400/50 bg-sky-500`; skeletons: `shimmer-sweep`
- Layout: `grid xl:grid-cols-[320px_1fr]` for master/detail split; currency via existing `formatCurrency` / `CountUp` (`prefix="₹"`).

---

## 6. Additional Analytics Features (incl. HOD-facing)

### 6.1 Detail-panel metrics (all backed by existing columns)

1. **Historical Rejection Rate** — `count(status IN rejected) / count(*)` per employee, computed **all-time** (ignore date filter) as a behavioral signal. Uses `status` + `employee_id`.
2. **Average Processing Time (TAT)** — per-employee `avg(hod_action_date − submitted_on)` and `avg(finance_action_date − hod_action_date)`. Timestamps present; mirrors TAT math already in `aggregateLegacyRows`.
3. **On-Behalf / Vendor-Payment Exposure** — share of `submission_type='On Behalf'` and `is_vendor_payment=true`. Flags employees whose spend is mostly on others' behalf or vendor-routed (policy/audit lens).
4. **Largest single claim + most-frequent category** — near-free outlier hints from `MAX(amount)` and modal `category_name`.

### 6.2 HOD-scope macro upgrades (close the role gaps from §2.4)

These give the HOD parity the drill-down assumes:

1. **Restore the "Pending At HOD" KPI for HOD scope** — currently filtered out for `hod`; it is the single most relevant number for an approver1. (UI-only toggle in `analytics-kpi-cards.tsx`.)
2. **Expose Dept/Category filters to HOD scope** (see §4.2) — required for per-category employee filtering.
3. **Department-internal efficiency for HOD** — the "Days to Approve" bar chart is admin-only; a HOD-scoped variant (their own department's approval TAT, or per-employee submission→approval lag) is high value and uses the same `hod_approval_hours_sum` data already aggregated.
4. **Category mix for the HOD's department** — a small "spend by category" breakdown scoped to the HOD's department complements the employee drill-down.

---

## 7. Risk & Safeguards

| Concern                                  | Mitigation                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breaking existing macro-analytics        | New RPCs read the row-level view; rollup cache + existing fetchers untouched. New section is appended in its own `<Suspense>`.                            |
| Status default leaking into macro charts | `status` param resolved in a **separate** helper feeding only the drill-down; never added to `resolveAnalyticsQueryParams()`.                             |
| HOD exposed to other departments' data   | Master/Detail RPCs reuse the existing `hod` predicate (`department_id = ANY(approver1 ids)`); category filter options also restricted to HOD departments. |
| Payload size (admin, 469 employees)      | Master RPC returns flat aggregates (cheap); detail is lazy per selection; admin search is server-side.                                                    |
| On-behalf double counting                | Confirm grouping key (§3.6) before build.                                                                                                                 |

---

## 8. Open Decisions (need confirmation before build)

1. **On-behalf grouping** — beneficiary (recommended) vs submitter.
2. **HOD filter exposure** — confirm widening `canUseScopeFilters` to approver1 HODs (category + department, department-restricted).
3. **Restore "Pending At HOD" KPI for HOD scope** — yes/no.
4. **Detail fetch strategy** — lazy server action (recommended) vs pre-bundled.

---

## 9. Build Phasing (proposed, not yet executed)

1. **DB:** author `get_employee_claim_master` + `get_employee_claim_detail` (read-only `SECURITY INVOKER` functions over the view). Verify against live counts in §3.2.
2. **Repo/Service:** extend `DashboardAnalyticsRepository` contract + `SupabaseDashboardRepository` + a `GetEmployeeDrilldownService` (or extend `GetAnalyticsService`).
3. **Filters:** add debounced employee search + expose category filter to HOD scope; wire `status` tri-state for the drill-down only.
4. **UI:** `EmployeeDrilldownFetcher` → `EmployeeDrilldown` / `EmployeeMasterList` / `EmployeeDetailPanel`, matching the design tokens in §5.1; append below charts.
5. **HOD parity:** restore Pending-At-HOD KPI + department-scoped efficiency/category cards.
6. **Tests:** unit tests mirroring `tests/unit/dashboard/*` (service + repository), e2e mirroring `analytics-finance-raw-summary.spec.ts`.

---

### Appendix — Files inspected (read-only)

- `src/app/(dashboard)/dashboard/analytics/page.tsx`
- `src/core/domain/dashboard/contracts.ts`
- `src/core/domain/dashboard/GetAnalyticsService.ts`
- `src/core/domain/dashboard/resolve-analytics-scope.ts`
- `src/modules/dashboard/repositories/SupabaseDashboardRepository.ts`
- `src/modules/dashboard/ui/analytics-filters.tsx`
- `src/modules/dashboard/ui/analytics-kpi-cards.tsx`
- `src/modules/dashboard/ui/analytics-charts.tsx`
- DB: `vw_enterprise_claims_dashboard`, `claims_analytics_daily_stats`, `claim_status` enum, `get_dashboard_analytics_payload` (introspected via read-only SQL)
