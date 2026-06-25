# Claims Table Views — Architectural Audit & Refactor Plan

> **Status:** READ-ONLY audit (Phase 4). No code changed. Awaiting approval before implementation.
> **Scope:** The claims **listing/table** feature family rendered by the tabbed "Claims Command Center" — **My Submissions**, **Approvals History**, **Admin Overview (Active)**, **Deleted Claims (Admin)**, and **Department Overview**. These are, by design, "one table with different content."
> **Out of scope (per directive):** Performance/render/memoization/bundle concerns. Findings below are framed as **structural integrity, duplication, correctness, and data-flow** issues — not optimizations.

---

## 0. Thesis (one line)

**Shared atoms, duplicated assembly.** The leaf components (`ClaimStatusBadge`, `MyClaimsPaginationControls`, `TableEmptyState`, `RouterLink`) are already DRY — but the _table composition_ (the `<table>`/`<thead>`/row shell) is copy-pasted across **four** implementations, each with its **own row contract**, its **own data service**, and **divergent formatting/filter logic**. All read-only views ultimately read **one** Postgres view; Admin is the lone exception.

---

## 1. What Was Reviewed

**Pages / entry point:**

- [src/app/(dashboard)/dashboard/my-claims/page.tsx](../src/app/%28dashboard%29/dashboard/my-claims/page.tsx) — **931 lines**; the tabbed Command Center. Resolves a `ViewMode` (`submissions | approvals | admin | admin-deleted | department`) and dispatches to a section (L631–691). **Contains an inline `<table>`** for My Submissions (`TableHeader` L347, `ClaimsCommandCenterTable` L379–540).

**Table components (the duplication):**

- [src/modules/claims/ui/finance-approvals-bulk-table.tsx](../src/modules/claims/ui/finance-approvals-bulk-table.tsx) — **828 lines**; Approvals (bulk select + AI CHECK + row actions).
- [src/modules/admin/ui/admin-claims-table.tsx](../src/modules/admin/ui/admin-claims-table.tsx) — **182 lines**; Admin (active/deleted, soft-delete action).
- [src/modules/claims/ui/department-claims-table.tsx](../src/modules/claims/ui/department-claims-table.tsx) — **111 lines**; Department (read-only).

**Section wrappers (data-flow + filter bar):**

- [src/modules/claims/ui/claims-approvals-section.tsx](../src/modules/claims/ui/claims-approvals-section.tsx), [department-claims-section.tsx](../src/modules/claims/ui/department-claims-section.tsx), [src/modules/admin/ui/admin-claims-section.tsx](../src/modules/admin/ui/admin-claims-section.tsx).

**Services / contracts:**

- `GetMyClaimsPaginatedService`, `GetPendingApprovalsService`, `GetDepartmentViewClaimsService`, `GetAdminClaimsService`.
- [src/core/domain/claims/contracts.ts](../src/core/domain/claims/contracts.ts) — the divergent row record types.

**Repositories / DB (verified live via MCP):**

- `SupabaseClaimRepository` + `SupabaseDepartmentViewerRepository` read `vw_enterprise_claims_dashboard`. `SupabaseAdminRepository` reads `claims` directly with its own joins.
- View `vw_enterprise_claims_dashboard` — full column list + definition (`WHERE is_active = true`) confirmed.

---

## 2. The Strong Foundation (Do NOT Touch)

1. **`vw_enterprise_claims_dashboard` is an excellent single source of truth.** Verified: it already exposes every column the list tables need — `claim_id`, `employee_name/id`, `on_behalf_*`, `department_name`, `type_of_claim`, `amount` (coalesced expense/advance), `status`, `submitted_on`, `hod_action_date`, `finance_action_date`, `submitter/hod/finance_email`, `is_active`, `is_vendor_payment`, evidence paths, `category_name`, `purpose`. The HOD/Finance action-date COALESCE logic and the `amount` coalescing live in **one place**. This is the right design — lean into it.

2. **Layering is clean.** Each view has a domain service (`Get*Service`) injected with a repository + logger, returning a typed record + cursor result. The services are pure and testable.

3. **The leaf/atom components are already shared and correct** — keep them as the building blocks of the consolidation:
   - `ClaimStatusBadge` + `CLAIM_STATUS_COLUMN_WIDTH_CLASSES` (consistent status rendering).
   - `MyClaimsPaginationControls` (cursor pagination, reused by Submissions, Approvals, Admin).
   - `TableEmptyState`, `RouterLink`, `formatDate`/`formatCurrency`.

4. **Cursor-based pagination is consistent** across Submissions/Approvals/Admin (opaque cursor tokens, `prevCursor`/`__first__` sentinel). Preserve this contract.

5. **RLS is enforced on the read path** for the view-backed tables (the same submitter/approver/admin/department-viewer policies audited in the Create-Claim plan apply to the underlying tables). The Command Center's `resolveView` also gates tabs by role (`isAdmin`, `isDepartmentViewer`, `canViewApprovals`, L99–122) — defense in depth.

---

## 3. End-to-End Lifecycle & Data-Flow Map

### 3.1 Single tabbed page

`MyClaimsDashboardPage` → `ClaimsDataComponent` (auth) → `MyClaimsDashboardResolvedContent` resolves role flags **in parallel** (`isAdmin`, `isDepartmentViewer`, viewer context, HOD summary; L705) → `resolveView` picks the `ViewMode` → `MyClaimsDashboardPageContent` dispatches (L631):

| Tab                 | Renders                                                     | Service                          | Repository → Source                                     |
| ------------------- | ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| My Submissions      | **inline `<table>`** in page.tsx (L379)                     | `GetMyClaimsPaginatedService`    | `SupabaseClaimRepository` → **view**                    |
| Approvals History   | `ClaimsApprovalsSection` → `FinanceApprovalsBulkTable`      | `GetPendingApprovalsService`     | `SupabaseClaimRepository` → **view**                    |
| Department Overview | `DepartmentClaimsSection` → `DepartmentClaimsTable`         | `GetDepartmentViewClaimsService` | `SupabaseDepartmentViewerRepository` → **view**         |
| Admin Overview      | `AdminClaimsSection` → `AdminClaimsTable` (`mode="active"`) | `GetAdminClaimsService`          | `SupabaseAdminRepository` → **`claims` (direct joins)** |
| Deleted Claims      | same `AdminClaimsSection` (`mode="deleted"`)                | `GetAdminClaimsService`          | `SupabaseAdminRepository` → **`claims` (direct joins)** |

### 3.2 The filter bar is loaded by a triplicated server component

The exact same "fetch 5 lookup datasets in parallel, map `{id,name}`, render `<ClaimsFilterBar>`" block is copy-pasted **three times**:

- `FilterBarWithData` ([page.tsx:561](../src/app/%28dashboard%29/dashboard/my-claims/page.tsx))
- `ApprovalsFilterBarWithData` ([claims-approvals-section.tsx:70](../src/modules/claims/ui/claims-approvals-section.tsx))
- `AdminFilterBarWithData` ([admin-claims-section.tsx:129](../src/modules/admin/ui/admin-claims-section.tsx))

Each fetches `getActivePaymentModes / getActiveDepartments / getActiveLocations / getActiveProducts / getActiveExpenseCategories`. This is a **maintainability/DRY** finding (one source of truth for the filter-bar loader), not a performance note.

### 3.3 Per-submission boundaries

- **Client → Server:** navigation only — these are server components; filters/cursor live in the URL. Tab switches are `<Link>` navigations that rebuild the query (`buildViewHref`, L253).
- **Server:** role resolution → per-view service `.execute({ userId, cursor, limit, filters })` → repository read (view or `claims`) → typed record list + cursor.
- **DB:** single view query (or admin's multi-join). No writes on the list path except the Admin **soft-delete** action (`softDeleteClaimAction`, triggered from `AdminClaimsTable`, L95).

---

## 4. Validation / Correctness Gap Analysis

The duplication has produced **user-visible inconsistencies** — the same claim or the same URL param behaves differently depending on which tab you are on.

| #       | Gap                                                               | Evidence                                                                                                                                                                                                                                                                                                                                       | Impact                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.1** | **The `?status=` URL param is parsed differently per tab.**       | `normalizeStatusFilter` in [page.tsx:176](../src/app/%28dashboard%29/dashboard/my-claims/page.tsx) maps **canonical → DB statuses** (`mapCanonicalStatusToDbStatuses`). The copy in [admin-claims-section.tsx:28](../src/modules/admin/ui/admin-claims-section.tsx) accepts **DB statuses only**.                                              | A canonical status value in the URL filters correctly on Submissions/Approvals but is **silently dropped** on the Admin tab. A genuine correctness bug born of copy-paste. |
| **4.2** | **Amount is formatted at different layers.**                      | Submissions/Finance use service-formatted `formattedTotalAmount` (pre-formatted string). Department ([department-claims-table.tsx:103](../src/modules/claims/ui/department-claims-table.tsx)) and Admin ([admin-claims-table.tsx:137](../src/modules/admin/ui/admin-claims-table.tsx)) format in-component via `formatCurrency(claim.amount)`. | The **same claim** can render with different currency formatting/rounding across tabs. No single formatting authority.                                                     |
| **4.3** | **`status` is typed inconsistently across contracts.**            | `MyClaimDTO.status: ClaimStatus` (canonical, [contracts.ts:415](../src/core/domain/claims/contracts.ts)) vs `MyClaimListRecord`/`PendingApprovalListRecord`/`AdminClaimRecord`.status: `DbClaimStatus`.                                                                                                                                        | Mapping drift between canonical and DB status enums at every boundary; easy to introduce off-by-one status bugs.                                                           |
| **4.4** | **Filter-param normalization helpers are duplicated with drift.** | `firstParamValue`, `normalizeDate`, `normalizeAmountFilter`, `normalizeStatusFilter` exist in **both** page.tsx and admin-claims-section.tsx (and partially in approvals).                                                                                                                                                                     | No shared filter parser → 4.1-class divergences are structurally invited, not prevented.                                                                                   |

---

## 5. Evidence-Backed Flaws & Deep-Rooted Causes

### 5.1 One logical table, four hand-rolled implementations

**Evidence:** The identical `<thead>` shell — `bg-zinc-50/80 text-[11px] uppercase tracking-[0.14em] …` with the same column sequence (CLAIM ID, SUBMITTER ID, SUBMITTER EMAIL, ON BEHALF ID, ON BEHALF EMAIL, DEPARTMENT, …, AMOUNT, STATUS, …) — is re-typed in **four** files:

|                     | My Submissions    | Department     | Admin                       | Finance Approvals           |
| ------------------- | ----------------- | -------------- | --------------------------- | --------------------------- |
| File                | page.tsx L347     | dept-table L30 | admin-table L52             | finance-table L600          |
| Type-of-claim label | `TYPE OF CLAIM`   | `TYPE`         | `TYPE`                      | `TYPE OF CLAIM`             |
| HOD-date label      | `HOD ACTION DATE` | —              | —                           | `HOD DATE`                  |
| Header padding      | `py-2.5`          | `py-2`         | `py-2`                      | `py-2.5`                    |
| Table min-width     | `min-w-395`       | `min-w-395`    | `min-w-470`                 | `min-w-430`                 |
| Extra columns       | sticky Actions    | none           | ACTIVE, DELETED BY, Actions | checkbox, AI CHECK, Actions |

The label/padding/width drift is the copy-paste fingerprint — these were forked, then edited independently.

**Root cause:** No shared `<ClaimsTable>` shell was ever introduced. Each new view (approvals → admin → department) was built by copying the previous `<table>` and swapping the row type, rather than parameterizing columns.

### 5.2 Six near-identical row contracts for one row

**Evidence:** `MyClaimRecord` (L392), `MyClaimDTO` (L407), `MyClaimListRecord` (L431), `PendingApprovalListRecord` (L482) in [contracts.ts](../src/core/domain/claims/contracts.ts), plus `DepartmentViewerClaimRecord` and `AdminClaimRecord` (admin contracts). Field-name drift across them: `id` ↔ `claimId`; `submittedAt` ↔ `submittedOn`; `totalAmount`/`expenseTotalAmount`+`advanceRequestedTotalAmount` ↔ `amount` ↔ `formattedTotalAmount`.

**Root cause:** Each service defined its own DTO instead of sharing one view-derived row contract. Because the **view already unifies these columns at the DB level**, the divergence is purely an application-layer artifact.

### 5.3 Admin is the outlier on two axes

**Evidence:** (a) Admin reads **`claims` directly** with bespoke joins (`SupabaseAdminRepository`, `from("claims")` L646+) while the other three read the **view**; (b) Admin's filter parser diverges (§4.1).

**Root cause:** The Admin view needs **soft-deleted rows** and `deleted_by` name/role — and the shared view **filters `WHERE is_active = true`** (verified in the view definition) and has **no `deleted_by` columns**. So Admin _could not_ use the view as-is and forked the entire read path. This is a legitimate constraint, but it caused the whole admin stack to drift instead of extending the view.

### 5.4 The filter-bar loader and param-normalizers are triplicated (§3.2, §4.4)

**Root cause:** Same as 5.1 — composition copied per section instead of extracted into a shared server component + shared parser.

---

## 6. Database & Data-Source Assessment

**Current state:** Strong at the DB layer. `vw_enterprise_claims_dashboard` is well-built and already serves 3 of 5 views with one query. The duplication is **above** the database, in the app/UI layer.

**Required architectural fixes:**

1. **One row contract sourced from the view.** Define a single `ClaimsListRow` type mirroring the view columns; have all read-only services return it (adapters where a service needs extras). Eliminates `id/claimId`, `submittedAt/submittedOn`, `amount/totalAmount/formattedTotalAmount` drift (§4.2/§4.3/§5.2).

2. **Decide and document the formatting boundary — format once.** Recommend formatting `amount`/dates in **one** place (service layer, returning display strings) so all tabs agree (fixes §4.2).

3. **Admin/Deleted requires a view extension, not just adoption.** Because the shared view filters `is_active = true` and lacks `deleted_by`, Admin cannot be repointed at it by "adding columns" alone. Two honest options:
   - **(a) New view** `vw_enterprise_claims_dashboard_admin` (or a parameter) **without** the `is_active` filter and **with** `deleted_by_name/role` joined — then Admin adopts the shared row contract + shell.
   - **(b) Keep Admin's direct query**, but extract the shared **presentation** shell and **filter parser** so the §4.1 status bug is fixed regardless of data source.
   - The presentation-layer consolidation (§7) is valid and low-risk **either way**; only the _data-source_ unification depends on this choice.

4. **One shared filter parser.** A single `parseClaimListFilters(searchParams)` used by every tab (fixes §4.1/§4.4); Admin passes `isActive` as an extra flag.

---

## 7. Component Consolidation Plan (UI)

> **Honest scoping (do not over-claim 4→1):** three views are genuinely "same table, different content"; the finance table is an **extension**, not a drop-in.

```
components/claims-table/
├── ClaimsTable.tsx            → shared shell: <table>/<thead>/<tbody>, column config, sticky/min-width props
├── claims-table-columns.ts    → column registry (id, label, width, cell renderer) — single source for labels/padding
├── ClaimsTableRow.tsx         → renders the shared cells from one `ClaimsListRow`
└── types.ts                   → `ClaimsListRow` (mirrors vw_enterprise_claims_dashboard)

Adoption:
• My Submissions      → ClaimsTable + columns[...base, actions(view/delete)]      (DROP inline table from page.tsx)
• Department Overview → ClaimsTable + columns[...base]                            (read-only)
• Admin Active        → ClaimsTable + columns[...base, active, deletedBy, soft-delete]
• Admin Deleted       → same as Admin Active (data source per §6.3)
• Finance Approvals   → EXTENDS ClaimsTable: + selection checkbox column, + AI CHECK column,
                        + per-row approve/reject + bulk action bar (keep its client-state logic;
                        reuse the shared column shell for the common cells)

Shared loaders/parsers:
• ClaimsFilterBarData.tsx       → the single 5-lookup server component (replaces 3 copies, §3.2)
• parseClaimListFilters.ts      → single filter parser (replaces duplicated normalizers, §4.4)
```

**Low-risk win to call out explicitly:** consolidating the **three read-only tables** (Submissions, Department, Admin) onto the shared shell + one row contract is the safe, high-value first step. The finance table's selection/AI/action behavior is extracted second, reusing the shell for common cells only.

**Principles:** column registry owns labels/widths/padding (kills the §5.1 drift); `ClaimStatusBadge`/`MyClaimsPaginationControls`/`TableEmptyState` remain the atoms; no behavior change for read-only tables — pure recomposition behind the existing services.

---

## 8. Impact & Edge-Case Analysis

1. **Cross-tab inconsistency is the headline user impact.** Same claim, different amount formatting (Department/Admin vs Submissions/Finance, §4.2); same `?status=` URL, different results (Admin vs others, §4.1). Consolidation makes these impossible by construction.
2. **Empty-state divergence.** Submissions/Approvals render a bespoke inline "No claims found" block; Department/Admin use `TableEmptyState`. Unifying on `TableEmptyState` is a free consistency win.
3. **Sticky action column exists only on My Submissions** (`STICKY_ACTION_COLUMN_CLASSES`, page.tsx L54). After consolidation it should be a column-config flag so any view can opt in.
4. **Admin soft-delete is the only write on the list path.** It calls `softDeleteClaimAction` then `router.refresh()` (admin-table L93). Preserve verbatim; ensure the shared shell still allows per-row client actions (the finance table proves this is feasible).
5. **Deleted-claims correctness depends on the view's `is_active` filter** (verified). Any attempt to serve deleted rows from the standard view would return **nothing** — a silent empty table. §6.3 must be resolved before touching Admin's data source.
6. **Status enum drift (§4.3)** is the highest-risk trap during consolidation: the shared `ClaimsListRow.status` must pick one enum (recommend `DbClaimStatus`, since the view emits the DB enum) and map to canonical only at the badge/filter boundary.

---

## 9. Remaining Risks (Brutally Honest)

- **The finance table is 828 lines of stateful behavior** (bulk selection, optimistic actions, AI verdict merging). Folding it into a shared shell naively risks regressions in selection/bulk logic. Treat it as **extend**, not **merge**; cover bulk approve/reject with tests before refactoring.
- **The Admin data-source decision (§6.3) is a real fork.** Building a second view is the cleanest long-term answer but touches DB migrations and RLS surface; keeping the direct query is safer but leaves Admin partially divergent. This is a deliberate trade-off to confirm with the team, not a default.
- **Consolidating row contracts can surface latent status/amount bugs** that currently "work" only because each tab massages data its own way. Expect to fix small correctness issues (§4.1–4.3) as part of unification — that is the point, but it widens the blast radius.
- **The §4.1 status-filter bug is live today** regardless of refactor; it should be triaged independently (point Admin's parser at the shared canonical→DB mapper) even if the larger consolidation is deferred.
- **Pure recomposition still risks markup/className drift** (the very thing being fixed). Snapshot/visual checks per tab before and after are warranted.

---

### Verification ledger (how claims above were confirmed)

- View columns + definition: `information_schema.columns` and `pg_get_viewdef('public.vw_enterprise_claims_dashboard')` via Supabase MCP — confirmed the trailing `WHERE c.is_active = true` filter and the absence of `deleted_by` columns.
- Data sources: `grep` of `.from("vw_enterprise_claims_dashboard")` vs `.from("claims")` across `SupabaseClaimRepository`, `SupabaseDepartmentViewerRepository`, `SupabaseAdminRepository`.
- Table/row duplication, labels, paddings, min-widths: direct reads of the four table files (file:line cited inline).
- Row contracts: `src/core/domain/claims/contracts.ts` (L392–504) and the admin/department contract imports.
- All file:line references are from the current working tree on branch `fixReHodDash`.
