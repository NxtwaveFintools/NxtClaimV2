# Master Refactoring Blueprint — NxtClaim V2

> Generated: 2026-06-24 · Phase 3 deliverable.
> This is the architectural contract that Phase 4 (feature-by-feature execution) follows.
> It **codifies the existing architecture** (which is good) and targets its specific
> inconsistencies — it is **not** a rewrite or a generic folder reshuffle.

---

## 0. How to read this

- **Strengths are called out**, not just problems — the goal is to preserve what works.
- Every redundancy/perf claim is **evidence-backed** (file + line where possible).
- Phase 4 executes this **one domain at a time** (order in §8). Nothing here is applied yet.

---

## 1. Architecture overview (current state)

The app uses a deliberate, layered, DDD-flavoured architecture. **Keep this.**

```
Routing          src/app/**            (Next.js App Router; thin orchestration + Suspense)
Feature impl     src/modules/<feature> (ui / actions / repositories / server / validators / utils)
Domain core      src/core/domain/<feature>  (pure services + contracts; no React, no Next)
Cross-cutting    src/core/{config,constants,infra,http}
Design system    src/components/{ui,layout}
Shared leaf      src/hooks, src/lib, src/types
```

### Strengths to preserve (codify, don't "fix")

- **Dependency-injected services.** `core/domain/**/*Service.ts` take `{ repository, logger }`
  via constructor and return a **Result type** `{ data, errorMessage }`. Highly testable.
- **Contracts/impl split.** `core/domain/<f>/contracts.ts` defines interfaces;
  `modules/<f>/repositories/Supabase*Repository.ts` implements them. Clean inversion.
- **Server-action Result type.** Actions return `{ ok, message }`; UI calls them inside
  `useTransition` then `router.refresh()`. Consistent across the admin panels.
- **Server-first rendering.** Only 48/~150 components are `"use client"`, and only **10**
  use `useEffect`. Pages stream via nested `<Suspense>`, parallelize with `Promise.all`,
  cache per-request reads (`getCachedCurrentUser`, `getCachedPendingApprovalsViewerContext`),
  and code-split heavy client islands with `next/dynamic` (e.g. `ClaimsFilterBar`).
- **Strict TypeScript** (`tsconfig: strict: true`).

---

## 2. Global folder structure (the contract to enforce)

### 2.1 Layer rules (dependency direction is one-way)

```
app  ──►  modules  ──►  core
  │           │           ▲
  └───────────┴────► components/ui, hooks, lib, types  (leaf; never import modules/app)
```

| Layer                                 | Allowed to import                                    | MUST NOT import                                                             |
| ------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `app/**`                              | modules, components, core, hooks, lib, types         | —                                                                           |
| `modules/<f>/**`                      | own feature, **core**, components, hooks, lib, types | other `modules/*` (avoid cross-feature; compose at the route layer instead) |
| `core/**`                             | core, lib, types                                     | **react, next, modules, components** (must stay framework-agnostic)         |
| `components/**`, `hooks/**`, `lib/**` | components/ui, lib, types                            | **modules, app**                                                            |

### 2.2 Canonical feature shape (apply to every `modules/<feature>`)

```
modules/<feature>/
  ui/            React components (client + server)
  actions/       'use server' actions (or actions.ts for a single file)
  repositories/  Supabase implementations of core contracts
  server/        server-only helpers & guards (is-admin, get-current-user, ...)
  validators/    zod schemas
  utils/         pure, framework-agnostic feature helpers
core/domain/<feature>/
  *Service.ts    business logic (DI: { repository, logger })
  contracts.ts   domain types + repository interfaces
```

### 2.3 Rules to enforce in Phase 4

1. **Thin routes.** `app/**/page.tsx` should orchestrate (auth gate, parallel fetch,
   Suspense boundaries) and compose module components — **not** contain business logic,
   filter parsing, or large table markup.
   - 🔴 **Violation (top priority):** `app/(dashboard)/dashboard/my-claims/page.tsx` is
     **931 lines** containing ~15 search-param normalizer functions, the full claims
     `<table>` (`ClaimsCommandCenterTable`, `TableHeader`, `DateWithActor`), and 4 inline
     skeletons. → Extract:
     - normalizers/`buildClaimFilters` → `modules/claims/utils/claim-search-params.ts`
     - table + header + cells → `modules/claims/ui/claims-command-center-table.tsx`
     - skeletons → shared skeleton primitives (§5.1).
2. **One home for feature utils.** `core/domain/claims/utils.ts` is orphaned (Phase 1)
   while `modules/claims/utils/*` is the live location. Consolidate; delete the orphan.
3. **`core/` stays pure.** No `react`/`next` imports under `core/` (lint rule candidate).
4. **Domain constants live in `core/constants`** (already true: `statuses.ts`,
   `payment-modes.ts`, …). Keep.

---

## 3. Feature isolation strategy (domains)

Group the codebase into these strict domains. Phase 4 runs them in this isolation.

| Domain                                    | `modules/`                                              | `core/domain/`                                     | Routes / API                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Auth**                                  | `auth`                                                  | `auth`                                             | `app/auth/*`, `app/api/auth/*`, `core/infra/auth`, supabase auth utils                                               |
| **Claims**                                | `claims`                                                | `claims`                                           | `(dashboard)/claims/*`, `(dashboard)/dashboard/claims/*`, `(dashboard)/dashboard/my-claims`, `app/api/export/claims` |
| **Approvals** _(sub-domain of Claims)_    | `claims` (L1/L2 forms, approvals sections, hod summary) | `claims` (`ProcessL1/L2…`, `GetPendingApprovals…`) | within Claims routes (`?view=approvals`, `hod-pending`)                                                              |
| **Verification** _(sub-domain of Claims)_ | `claims/verification`                                   | —                                                  | `app/api/internal/verify-worker`, `verification_worker_*` tables                                                     |
| **Dashboard & Analytics**                 | `dashboard`                                             | `dashboard`                                        | `(dashboard)/dashboard` (home), `(dashboard)/dashboard/analytics`, `app/api/dashboard/entry`                         |
| **Admin**                                 | `admin`                                                 | `admin`                                            | `(dashboard)/dashboard/admin/settings`                                                                               |
| **Departments** _(supporting)_            | `departments`                                           | `departments`                                      | consumed by Claims/Admin                                                                                             |
| **Policies** _(supporting)_               | `policies`                                              | `policies`                                         | `PolicyGate`, `company-policy-button`                                                                                |

### Coupling notes (to respect during isolation)

- The Claims "Command Center" (`my-claims/page.tsx`) **composes** Admin, Department, and
  Approvals sections by `?view=`. That cross-domain composition is acceptable **at the
  route layer**, but module-to-module imports between `admin`/`claims`/`departments`
  should flow through the route, not directly between feature internals.
- **Auth** is foundational; everything depends on `modules/auth/server/get-current-user`
  and `modules/admin/server/is-admin`. Treat these guards as a stable internal API.

---

## 4. Route architecture inconsistency (high-priority structural fix)

There are **two competing conventions** for the dashboard surface:

- The **`(dashboard)` route group** owns a shared `layout.tsx` that fetches
  `getPolicyGateState()` and wraps children in `<PolicyGate>` + a Suspense fallback.
- But the **dashboard home** (`app/dashboard/page.tsx`, `/dashboard`) and
  `app/dashboard/claims/page.tsx` live **outside** the group. Consequences:
  - `app/dashboard/page.tsx` **re-implements** `getPolicyGateState()` + `<PolicyGate>` that
    the group layout already provides → duplicated gating.
  - `<AppShellHeader>` is rendered **per page** (inline in `dashboard/page.tsx`; via
    `AppShellHeaderLoader` in `my-claims/page.tsx`) instead of **once** in the group layout.
  - Three different dashboard loading shells exist (`dashboard/loading.tsx`,
    `(dashboard)/layout.tsx` fallback, inline `DashboardSkeleton`).

**Target:**

1. Move `/dashboard` (home) and `/dashboard/claims` into the `(dashboard)` group.
2. Hoist `<AppShellHeader>` + `<PolicyGate>` into `(dashboard)/layout.tsx` so every
   dashboard route inherits one shell and one gate.
3. Remove per-page `AppShellHeader`/`PolicyGate`/`getPolicyGateState` duplication.
4. Reconcile to **one** dashboard loading skeleton (built from §5.1 primitives).

---

## 5. Identified redundancies

### 5.1 Skeleton / shimmer duplication → shared primitives 🔴 highest volume

**Evidence:** `shimmer-sweep` appears **117 times across 12 files**; only
`components/ui/table-skeleton.tsx` is shared. Hand-rolled shells include
`DashboardSkeleton`, `DashboardLoadingShell`, `DashboardGroupLayoutFallback`,
`MyClaimsShellSkeleton`, `MyClaimsFullPageSkeleton`, `FilterBarSkeleton`,
`MyClaimsHeaderCardSkeleton`, plus `claims/[id]/loading.tsx`, `analytics/page.tsx`,
`my-claims/loading.tsx`, `claims/new/loading.tsx`.

**Target — `components/ui/skeleton/`:**

- `<Skeleton>` — base shimmer block (`className` for size/shape).
- `<SkeletonText lines={n} />`, `<SkeletonCard>`, `<SkeletonNav items={n} />`,
  `<SkeletonTable rows cols />` (fold in existing `table-skeleton`), `<PageHeaderSkeleton>`.
- Recompose all 11 hand-rolled shells from these. Collapses ~117 inline divs.

### 5.2 Admin "management panel" pattern → shell component + hook 🔴 highest logic dup

**Evidence:** `admins-management.tsx` and `finance-approvers-management.tsx` are nearly
structurally identical (and 6 more `*-management.tsx` + `master-data-table.tsx` follow suit):
`"use client"` → `useRouter` + `useTransition` + `useState(input)` + `useState(error)` →
`handleAdd` (`trim → validate → action → ok ? refresh : setError`) → identical card chrome
(`rounded-[26px]` header / `divide-y` list / footer add-by-email form / `Pending login` pill).

**Target:**

- `<ManagementPanel title description footer>` — the shared card chrome + empty state.
- `useEntityManagement(actions)` hook — encapsulates `useTransition` + add/remove/toggle +
  `router.refresh()` + pending/error state (removes the copy-pasted handlers).
- `<EmailAddForm onAdd>` — the shared "add by email" footer.
- `<PendingLoginBadge>` — the amber "Pending login / Pending first login" pill (duplicated
  verbatim in at least the two panels read).

### 5.3 Data-table chrome → `<DataTable>` primitives

**Evidence:** `my-claims/page.tsx` hand-builds the table shell (scroll container, uppercase
`<thead>`, sticky right action column via `STICKY_ACTION_COLUMN_CLASSES`, row hover,
`DateWithActor`, `FinanceTeamQueueBadge`). `admin-claims-table.tsx`,
`department-claims-table.tsx`, and `finance-approvals-bulk-table.tsx` repeat the same shell.

**Target:** `components/ui/data-table/` — `<TableShell>`, `<Th>`, `<Td>`,
`<StickyActionsCell>`, and promote `<DateWithActor>` to `modules/claims/ui/`.

### 5.4 CTA links re-styling the Button by hand

**Evidence:** repeated `<Link className="inline-flex h-9 … rounded-xl bg-indigo-600 …">`
CTAs and per-file class constants (`VIEW_LINK_CLASSES`, `CLAIM_ID_LINK_CLASSES`) instead of
the existing `Button`. **Target:** `buttonVariants()` + `<Button asChild>` (or `<LinkButton>`)
so links and buttons share one source of truth.

### 5.5 Existing shared hooks (good — extend, don't duplicate)

`src/hooks/` already has `use-debounced-value`, `use-persistent-state`,
`use-session-storage`, `use-claim-form-autofill`. New cross-cutting client logic (e.g.
§5.2's `useEntityManagement`) should land here or in the feature's `ui/` per scope.

---

## 6. Performance

**Honest assessment: data-fetching is already strong.** No naive waterfalls were found in
the pages reviewed — `my-claims/page.tsx` parallelizes with `Promise.all`, streams via
nested `<Suspense>`, caches per-request reads, and lazy-loads the filter bar via
`next/dynamic`. Treat the items below as **targeted**, not systemic.

| #   | Item                             | Evidence / action                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Analytics employee-drilldown** | `EmployeeDetailPanel` / `EmployeeMasterList` are client components using `useEffect` + server actions (`employee-drilldown/actions.ts`). **Verify** whether they fetch-on-mount in series; if so, move to RSC + `<Suspense>` or hoist the first page of data server-side. _(verify before changing)_ |
| P2  | **`next/image`**                 | Only **1** usage (`claims/[id]/page.tsx`), **0** `<img>`. Ensure that one has explicit `sizes`/dimensions. Otherwise N/A — do not invent image work.                                                                                                                                                 |
| P3  | **Heavy list tables**            | `claim_audit_logs` = 13.9k rows, `claims` = 4.6k. List views are cursor-paginated (good). Keep the claim **audit timeline** query bounded/paginated.                                                                                                                                                 |
| P4  | **Repository instantiation**     | `new SupabaseClaimRepository()` is created inside several server components. Cheap, but consider a per-request factory if it grows. Low priority.                                                                                                                                                    |
| P5  | **DB-side**                      | See `REFACTORING_PHASE2_SCHEMA_AUDIT.md` — unused indexes, RLS `initplan`, multiple-permissive-policy consolidation.                                                                                                                                                                                 |

---

## 7. Type safety & the data layer

- **Biggest gap:** `src/types/database.ts` (hand-maintained Supabase types) is **unused**
  because `browser-client.ts` / `server-client.ts` create the **untyped** `SupabaseClient`.
  → Re-integrate as `SupabaseClient<Database>` so repositories get column-level type safety
  end-to-end. This is **Phase 4 data-layer hardening** and supersedes the Phase 1
  "delete `database.ts`" option. (Decision still yours.)
- Audit repositories for `any`/manual casts that the typed client would eliminate.

---

## 8. Phase 4 execution order (domain-by-domain)

Run **one domain per session**, smallest-blast-radius first. Per the directive, each domain
gets: shared-component extraction, custom hooks, strict typing, Next.js perf, and
error-handling + ARIA improvements — verified before presenting.

1. **Design-system foundation** (enables everything else): build §5.1 skeleton primitives,
   §5.3 `<DataTable>`, §5.4 `buttonVariants/asChild`, §5.2 `<ManagementPanel>` +
   `useEntityManagement`. _No feature behavior changes._
2. **Admin** — adopt §5.2 across the 8 `*-management.tsx` panels (highest dup payoff).
3. **Claims** — fix §2.3 page bloat (`my-claims`), adopt `<DataTable>`, extract search-param
   utils; reconcile skeletons.
4. **Dashboard & Analytics** — resolve §4 route-group split; verify P1 drilldown.
5. **Approvals & Verification** (Claims sub-domains).
6. **Auth / Policies / Departments** (supporting; smallest).
7. **Data-layer typing** (§7) — re-integrate `database.ts`, harden repositories.

### Per-domain definition of done

- [ ] Repeated UI extracted to shared components (no new duplication).
- [ ] Data/state moved to services + hooks; routes stay thin.
- [ ] Strict types; no `any` in touched files; typed Supabase client where touched.
- [ ] Server/client boundary correct; Suspense + parallel fetch preserved.
- [ ] Error states + ARIA (labels, roles, focus) on interactive components.
- [ ] Verified via MCP / tests / typecheck before review.

---

## 9. Cross-references

- Dead files & deps → `docs/REFACTORING_PHASE1_PURGE.md`
- Supabase schema audit → `docs/REFACTORING_PHASE2_SCHEMA_AUDIT.md`

---

# Section 7: Micro-Architecture Deep Dive (Phase 3.5)

> Forensic pass on library duplication, the data-fetching layer, and dead routes/services.
> Every finding is evidence-backed (file:line). Nothing applied — feeds Phase 4.

## 7.1 Library duplication — design-system primitives vs raw HTML

**Framing correction:** there is **no Shadcn** in this project. `components/ui/*` is a
**custom design system**, partly built on Radix primitives (`accordion`, `dialog`, `tabs`,
`sheet`). So the real axis is **"design-system primitive vs raw Tailwind HTML,"** not
"Shadcn vs custom." The DS exists but is **inconsistently adopted**.

### 7.1.1 Form controls — primitives exist but are bypassed almost everywhere 🔴

The DS provides `FormInput`, `FormSelect`, `FormTextarea`, `CurrencyInput`, `DateInput`.
**Adopted in only 2 files** (`modules/claims/ui/new-claim-form-client.tsx`,
`modules/claims/ui/finance-edit-claim-form.tsx`). Meanwhile **raw `<input>/<select>/
<textarea>` appears 80× across 24 files**, including:

- **All 8 admin `*-management.tsx` panels** + `add-department-form` (raw `<input className="nxt-input …">`).
- **All 3 filter surfaces:** `claims-filter-bar.tsx` (11), `advanced-filters-sheet.tsx` (8),
  `analytics-filters.tsx` (7 — raw `<select>` dropdowns that should be `FormSelect`).
- Even the **login form** (`email-login-form.tsx`) hand-rolls raw `<input>` with bespoke
  Tailwind instead of `FormInput`.

**Enforce:** route every text/number/date/select field through the DS primitives. This also
fixes inconsistent styling (some raw inputs use the `nxt-input` class, others use ad-hoc
`rounded-xl border …`).

### 7.1.2 Buttons — partial adoption

`Button` is imported by ~12 files, but **raw `<button>` appears 49× across 23 files**. Some
are legitimate (icon toggles in `theme-toggle`, `sheet` close, password-reveal). But action
buttons in feature UI bypass `Button` — notably `finance-approvals-bulk-table.tsx` (8),
`claim-reject-with-reason-form.tsx` (4), `delete-claim-button.tsx` (3),
`admin-soft-delete-panel.tsx` (3), `verification-panel.tsx` (3). **Enforce:** convert action
buttons to `Button`/`buttonVariants`; keep raw only for genuinely bespoke controls.

## 7.2 Service / data-fetching duplication

### 7.2.1 Strength: queries are centralized

`.from("…")` appears **161× across exactly 10 files — all repositories + server guards**
(`SupabaseClaimRepository` 75, `SupabaseAdminRepository` 44, `SupabaseDashboardRepository` 19,
…). **Zero stray queries in UI components or routes.** The only client-side Supabase use is
`auth-session-sync.tsx` (`onAuthStateChange` — legitimately client-side). **Keep this.**

### 7.2.2 The master-data lookup block is duplicated 5× 🔴

This identical 5-call bundle is copy-pasted in five render paths:

```ts
claimRepository.getActivePaymentModes(),
claimRepository.getActiveDepartments(),
claimRepository.getActiveLocations(),
claimRepository.getActiveProducts(),
claimRepository.getActiveExpenseCategories(),
```

- `app/(dashboard)/dashboard/my-claims/page.tsx:573`
- `modules/admin/ui/admin-claims-section.tsx:133`
- `modules/claims/ui/claims-approvals-section.tsx:88`
- `modules/claims/ui/department-claims-section.tsx:117`
- `app/(dashboard)/dashboard/claims/[id]/page.tsx:320`
- (+ `modules/claims/actions.ts:574`)

**Target:** one `getClaimFilterOptions()` wrapped in `React.cache()` returning
`{ paymentModes, departments, locations, products, expenseCategories }`. Removes the
duplication **and** dedups queries per request (today two sections in one request = 10 queries).

### 7.2.3 Master-data ownership is split across domains

`SupabaseClaimRepository` owns master-data reads (`getActiveDepartments`, …, lines 2211-2300)
**and** the Departments domain has `SupabaseDepartmentRepository.getActiveDepartmentsWithApprovers()`

- `GetActiveDepartmentsService`. Departments/products/locations are reachable through two
  domains. **Target:** a dedicated **`MasterData`/`Lookups` repository + service** that Claims and
  Admin both consume; stop the Claims repo from reaching into `master_*` tables directly.

### 7.2.4 `getCurrentUser` vs `getCachedCurrentUser` inconsistency 🔴

- **Pages/server components** correctly use `getCachedCurrentUser()` (React.cache, per-request
  dedup) — ~10 files. Good.
- **Server actions** call the **uncached** `authRepository.getCurrentUser()` — **18× in
  `modules/claims/actions.ts` alone**, plus `admin/actions.ts`, `policies/actions.ts`,
  `actions/add-department.ts`, `actions/export-claims.ts`, `department-claims-section.tsx`.

**Target:** a single cached guard `requireCurrentUser()` (cache + redirect/`{ ok:false }`
handling) and replace the ~25 ad-hoc calls. Removes the most frequent data-access dup.

### 7.2.5 "God" repository

`SupabaseClaimRepository` = **75 queries, ~2,300 lines**, mixing claim CRUD, pagination,
approvals, and master-data lookups. **Target (Claims phase):** split into
`claim-read` / `claim-write` / `lookups` repositories behind the existing contracts.

## 7.3 Dead API routes & services (no in-code caller)

Traced via `ROUTES` accessor usage (`authApi`/`dashboardApi`/`exportApi`) + path literals.

| Object                                                                 | Evidence                                                                                                                                                                        | Verdict                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `app/api/auth/email-login/route.ts`                                    | `ROUTES.authApi.emailLogin` and `/api/auth/email-login` have **0 consumers**; `email-login-form` submits via client `signInWithPassword` (browser Supabase client)              | **Dead in-code** — verify no external/mobile client posts to it before removal |
| `app/api/auth/callback/route.ts`                                       | No caller; it merely redirects to `ROUTES.auth.callback` (`/auth/callback`), which is the **live** OAuth callback used in `modules/auth/actions.ts:29,40`                       | **Dead duplicate** — verify it isn't the Supabase-configured redirect URL      |
| `app/api/dashboard/entry/route.ts`                                     | `ROUTES.dashboardApi.entry` has **0 app consumers**; returns only `"Dashboard access verified"`; sole reference is `tests/unit/api/dashboard/entry.route.test.ts`               | **Dead/probe-only** — keep only if used as an external healthcheck             |
| `exportClaimsCsvAction` (`modules/claims/actions/export-claims.ts:97`) | Exported but **never invoked**; export runs through the `/api/export/claims` GET route (`claims-filter-bar.tsx:654`), which re-instantiates `ExportClaimsService` independently | **Dead server action** — the file duplicates the route's service wiring        |

⚠️ Auth routes can be invoked **externally** (Supabase Auth redirect config, a mobile client).
Confirm those before deleting `email-login` / `api/auth/callback`. `dashboard/entry` and
`exportClaimsCsvAction` are safe in-code dead code (remove `exportClaimsCsvAction` only after
confirming no barrel re-export invokes it).

> Note: `/api/export/claims` (route) is **live**; only the parallel **server-action** path is
> dead. This is a "two delivery mechanisms for one service" smell — standardize on the route.

## 7.4 Phase 4 impact (additions to §8 order)

- **Foundation phase:** add §7.2.2 `getClaimFilterOptions()` and §7.2.4 `requireCurrentUser()`
  — both are high-frequency, low-risk dedup wins that many features depend on.
- **Auth phase:** resolve §7.3 dead auth routes (after external-usage check).
- **Claims phase:** §7.2.5 repository decomposition + §7.1 form-primitive adoption in filters.
- **Admin phase:** §7.1.1 form primitives across the 8 panels (pairs with §5.2 `<ManagementPanel>`).

## 7.5 Dead exported symbols (symbol-level scan)

`scratchpad/dead-exports.cjs` checked **511 exported symbols**; **95** have no reference in any
other file. Most are **over-exports** (low-risk): exported types/constants/DS sub-exports used
only within their own file. The actionable subset is **dead _value_ exports in otherwise-live
files**, each **verified by direct grep** to appear only in its defining file:

| Symbol                            | Location                                      | Why it's dead                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loginWithGoogleAction`           | `modules/auth/actions.ts:39`                  | Google login runs via the **client** auth repository (`supabase-auth.repository`), not this action ⚠️ _auth-sensitive — confirm no dynamic trigger_                                                                                  |
| `getCurrentUserAction`            | `modules/auth/actions.ts:75`                  | Superseded by `getCachedCurrentUser()` server helper                                                                                                                                                                                 |
| `getActivePolicyStateAction`      | `modules/policies/actions.ts:96`              | No consumer                                                                                                                                                                                                                          |
| `createFinanceApproverAction`     | `modules/admin/actions.ts:382`                | Superseded by `addFinanceApproverByEmailAction` (the one the panel uses)                                                                                                                                                             |
| `updateDepartmentActorsAction`    | `modules/admin/actions.ts:314`                | No consumer                                                                                                                                                                                                                          |
| `GetMyClaimsService` (class)      | `core/domain/claims/GetMyClaimsService.ts:14` | Superseded by `GetMyClaimsPaginatedService`; file likely retained only for a shared type — collapse                                                                                                                                  |
| `usePersistentState`              | `hooks/use-persistent-state.ts:14`            | Not imported anywhere; overlaps `use-session-storage` / `use-claim-form-autofill`                                                                                                                                                    |
| `auth-error-utils.ts` (5 helpers) | `core/infra/supabase/auth-error-utils.ts`     | `getSupabaseAuthErrorCode/Status`, `isSupabase{Expired,InvalidGrant,InvalidRefreshToken}…` are only cross-called internally; **no external consumer** — likely a fully dead module _(confirm file isn't imported for anything else)_ |

Plus the **Phase-1 orphan files re-confirmed** here (validates the scan): `users-management`,
`claim-detail-skeleton`, `claim-full-details-grid`, `claim-semantic-download-button`,
`claims-table-skeleton`, `core/domain/claims/utils.ts` (`isBcSubmitted`), `types/database.ts`.

**Lower-priority bucket (~80):** over-exported types/constants/DS sub-exports —
`ButtonProps/ButtonVariant/ButtonSize`, `DialogClose/Portal/Trigger/Overlay`, `CardDescription`,
many `contracts.ts` types, `PAYMENT_MODE_{CORPORATE_CARD,FOREX,HAPPAY}`, several `statuses.ts`
constants, validator sub-schemas (`financeExpenseEditSchema`, `ownExpenseEditSchema`, …). These
are candidates to **drop the `export`** (make file-private) rather than delete — do opportunistically
per-domain in Phase 4, not as a sweep.

> Caveat: the scan is name-based. Each value export above was grep-verified, but confirm no
> barrel/dynamic re-export before deletion (especially the auth actions).

## 7.6 Repeated page auth-guard preamble

`redirect(ROUTES.login)` is hand-rolled in **6 server components/sections** —
`dashboard/page.tsx`, `my-claims/page.tsx`, `claims/[id]/page.tsx`, `analytics/page.tsx`,
`claims/hod-pending/page.tsx`, `department-claims-section.tsx` — each doing the same
"fetch user → bail if missing" block. This is the **page-side twin** of the action-side
`getCurrentUser` duplication (§7.2.4). **Target:** a `requirePageUser()` helper (cached fetch +
redirect) and/or enforce the gate once in `(dashboard)/layout.tsx` (ties to §4).

## 7.7 Logging consistency (minor)

The project has a structured `logger`, but there are **2 stray `console.*` calls** outside it:
`modules/claims/actions/get-hod-summary.ts` (live) and `claim-semantic-download-button.tsx`
(already a Phase-1 orphan). Replace the live one with `logger`. Low priority.

## 7.8 Verified strengths (do **not** "fix")

The deep-dive also confirmed strong patterns worth preserving and copying:

- **Type hygiene is excellent:** **zero** `any`, **zero** `@ts-ignore`/`@ts-expect-error`
  across `src/`. The only escape hatches are legit React-hook `eslint-disable` lines and
  `as unknown` before JSON validation. (The one real typing gap is the untyped Supabase
  client — §7 / Blueprint §7.)
- **`isAdmin()` is the gold-standard cache pattern** (`is-admin.ts`): `React.cache()` +
  `unstable_cache` (tag-based, 1h revalidate) + reads `app_metadata` before any DB hit. The
  new `getClaimFilterOptions()` (§7.2.2) and `requireCurrentUser()` (§7.2.4) should follow it.

```

```
