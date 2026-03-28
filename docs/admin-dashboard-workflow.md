# Admin Dashboard — Feature Workflow

> All facts in this document were verified directly via **Supabase MCP**, **Filesystem MCP**, and **Next.js MCP**. No assumptions were made.

---

## 1. Access Control

### Gate: `isAdmin()` server helper

**File:** `src/modules/admin/server/is-admin.ts`

- Wrapped in `React.cache()` — deduplicated per request.
- Creates a Supabase SSR client using cookies (never a service-role key on the client).
- Queries `admins` table: `SELECT id FROM admins WHERE user_id = auth.uid() LIMIT 1` (count, head-only).
- Returns `false` on any auth error, missing session, or DB error.
- The admin settings page calls `isAdmin()` first and returns `notFound()` if the result is `false`.

```
RLS on admins table (verified via Supabase MCP):
  SELECT  → user_id = auth.uid()   (can only read own row)
  INSERT  → via service-role (provisioning)
  DELETE  → user_id = auth.uid()
```

### Route

```
GET /dashboard/admin/settings?tab=<key>
```

Protected entirely by server-side `isAdmin()` check — no global middleware.

---

## 2. Admin Settings Page Architecture

**File:** `src/app/(dashboard)/dashboard/admin/settings/page.tsx`  
**Type:** React Server Component (RSC) — no `"use client"` at page level.

### Sidebar Groups (tab keys)

| Group       | Tab Key         | Component Rendered           |
| ----------- | --------------- | ---------------------------- |
| Master Data | `categories`    | `MasterDataTable`            |
| Master Data | `products`      | `MasterDataTable`            |
| Master Data | `locations`     | `MasterDataTable`            |
| Master Data | `payment-modes` | `MasterDataTable`            |
| Routing     | `departments`   | `DepartmentsManagement`      |
| Routing     | `finance`       | `FinanceApproversManagement` |
| Access      | `users`         | `UsersManagement`            |
| Access      | `admins`        | `AdminsManagement`           |

Active tab is read from `?tab=<key>` search param (default: `categories`).  
Navigation links are `<Link href="?tab=...">` — full server-side re-render per tab switch.

### Data Fetching Strategy

Parallel `Promise.all()` — only the relevant service call for the active tab fires; all others short-circuit to `Promise.resolve(null)`.

```
[masterData?, departments?, finance?, users?, admins?] = await Promise.all([...])
```

Service layer uses service-role Supabase client (bypasses RLS for admin reads).

---

## 3. Domain Services & Repositories

```
UI → Server Action / RSC → Domain Service → SupabaseAdminRepository → Supabase DB
```

All services are in `src/core/domain/admin/`:

| Service                       | Responsibility                                                               |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `GetAdminClaimsService`       | Filtered, cursor-paginated read of all claims                                |
| `ManageMasterDataService`     | CRUD for expense categories, products, locations, payment modes              |
| `ManageActorsService`         | Read/update department HOD+Founder actors; read/add/toggle finance approvers |
| `ManageAdminsService`         | List all users (paginated); list/add/remove admin records                    |
| `AdminSoftDeleteClaimService` | Soft-delete a claim (`is_active = false`)                                    |

**Repository:** `src/modules/admin/repositories/SupabaseAdminRepository.ts`  
Uses `getServiceRoleSupabaseClient()` — bypasses RLS for admin operations.

---

## 4. Master Data Management

**DB tables (verified via Supabase MCP):**

| Tab Key         | Table                       | Row Count |
| --------------- | --------------------------- | --------- |
| `categories`    | `master_expense_categories` | 22        |
| `products`      | `master_products`           | 16        |
| `locations`     | `master_locations`          | 61        |
| `payment-modes` | `master_payment_modes`      | 6         |

**UI:** `src/modules/admin/ui/settings/master-data-table.tsx`  
**Actions:** `ManageMasterDataService.getItems()`, `.createItem()`, `.updateItem()`

Rules:

- Soft delete only (`is_active = false`). Hard deletes are **forbidden**.
- Retired items: `is_active = false` — new users cannot select them, but historical claims linked to the item's ID remain intact.
- Each item: `id` (UUID), `name` (text), `is_active` (boolean).

---

## 5. Departments & Actors

**DB table:** `master_departments` (52 rows, RLS enabled)

```sql
-- RLS policies (verified via Supabase MCP)
SELECT  → authenticated (all logged-in users can read)
INSERT  → admin check (EXISTS SELECT 1 FROM admins WHERE user_id = auth.uid())
UPDATE  → admin check
```

**Columns relevant to routing:**

- `hod_user_id` — FK to `users`, set when HOD has logged in.
- `founder_user_id` — FK to `users`, set when Founder has logged in.
- `hod_provisional_email` — set when HOD entered by email before first login.
- `founder_provisional_email` — set when Founder entered by email before first login.

**UI:** `src/modules/admin/ui/settings/departments-management.tsx`  
**Server Action:** `updateDepartmentActorsByEmailAction` in `src/modules/admin/actions.ts`

### Update flow

1. Admin enters HOD email + Founder email for a department row.
2. Server action calls `ManageActorsService.updateDepartmentActorsByEmail()`.
3. Service checks `users` table for a matching email (case-insensitive).
   - **Match found:** writes `hod_user_id` / `founder_user_id`, clears provisional field.
   - **No match:** writes `hod_provisional_email` / `founder_provisional_email`, leaves `_user_id` null — badge shown as "Pending first login".
4. On next login by that email, the `handle_new_user` DB trigger promotes provisional email → real user link.

---

## 6. Finance Approvers

**DB table:** `master_finance_approvers` (3 rows, RLS enabled)

```sql
-- RLS policies (verified via Supabase MCP)
SELECT  → authenticated (all logged-in users)
INSERT  → admin only
UPDATE  → admin only
DELETE  → admin only
```

**Columns:** `id`, `user_id` (nullable), `is_primary`, `is_active`, `provisional_email`

**UI:** `src/modules/admin/ui/settings/finance-approvers-management.tsx`  
**Server Actions:** `addFinanceApproverByEmailAction`, `updateFinanceApproverAction`

### Rules

- Only one `is_primary = true` allowed — setting a new primary clears the old one.
- Deactivating (`is_active = false`) prevents new claims from routing to this approver.
- Provisional email flow: same as departments — entry before first login is tracked via `provisional_email`.
- Claims route to `assigned_l2_approver_id` which is locked at submission time from the active primary finance approver.

---

## 7. Users & Roles

**DB table:** `users` (50 rows, RLS enabled)

**UI:** `src/modules/admin/ui/settings/users-management.tsx`  
**Server Action:** `updateUserRoleAction`

### Available Roles (from `src/core/constants/auth.ts`)

- `employee`
- `hod`
- `founder`
- `finance`

Pagination: cursor-based, page size = 20. Offset pagination is **forbidden** per project rules.

---

## 8. Admin Management

**DB table:** `admins` (1 row currently, RLS enabled)

**UI:** `src/modules/admin/ui/settings/admins-management.tsx`  
**Server Actions:** `addAdminAction`, `removeAdminAction`

### Add Admin

1. Admin enters an email address.
2. `ManageAdminsService.addAdmin({ email })` is called.
3. If user exists in `users` table: inserts `admins` row with `user_id`.
4. If user doesn't exist yet: inserts `admins` row with `provisional_email` (null `user_id`). On first login the `handle_new_user` trigger promotes the record.

### Remove Admin

1. Two-step confirmation UI (prevent accidental removal).
2. `ManageAdminsService.removeAdmin({ adminId })` — hard deletes the `admins` row.
3. Removed user loses admin access immediately (next `isAdmin()` check returns `false`).

---

## 9. Admin Claims View

**Route:** `/dashboard/claims` (admin context)  
**Files:**

- `src/modules/admin/ui/admin-claims-section.tsx` — RSC wrapper, fetches data server-side.
- `src/modules/admin/ui/admin-claims-table.tsx` — client component (table with inline soft-delete).

### Filters (all DB-level, no in-memory filtering)

| Filter     | URL Param                   | Column                       |
| ---------- | --------------------------- | ---------------------------- |
| Status     | `?status=<comma-separated>` | `claims.status`              |
| Department | `?department_id=<uuid>`     | `claims.department_id`       |
| Search     | `?search_query=<text>`      | `claims.id` / submitter name |

Pagination: cursor-based, page size = 10.

### Columns Displayed

`CLAIM ID` · `EMPLOYEE ID` · `EMPLOYEE NAME` · `DEPARTMENT` · `TYPE` · `AMOUNT` · `STATUS` · `ACTIVE` · `SUBMITTED ON` · `ACTIONS`

### RLS on `claims` table (Supabase MCP verified)

```sql
-- Admin can read ALL claims (bypasses submitter/approver check)
claims_select_admin: EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
claims_update_admin: EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
```

---

## 10. Soft Delete (Admin)

**Component:** `src/modules/admin/ui/admin-soft-delete-panel.tsx`  
**Service:** `src/core/domain/admin/AdminSoftDeleteClaimService.ts`  
**Action:** `softDeleteClaimAction` in `src/modules/admin/actions.ts`

### Flow

1. Admin clicks "Soft Delete Claim" on the claim detail page.
2. Two-step confirmation modal in UI (prevents accidental delete).
3. Server action calls `AdminSoftDeleteClaimService.execute({ claimId, actorId })`.
4. Repository sets `claims.is_active = false` and writes a `claim_audit_logs` entry.
5. On success, browser is redirected to `/dashboard/my-claims?view=admin`.
6. Soft-deleted claims are hidden from submitter and approver views but remain in the DB for financial auditability.

**Hard deletes are strictly forbidden** — all financial records must be preserved.

---

## 11. Server Actions Security Model

**File:** `src/modules/admin/actions.ts`

All actions share the same guard:

```ts
async function requireAdmin(): Promise<{ userId: string } | { forbidden: true }> {
  const [adminCheck, userResult] = await Promise.all([isAdmin(), authRepository.getCurrentUser()]);
  if (!adminCheck || userResult.errorMessage || !userResult.user) {
    return { forbidden: true };
  }
  return { userId: userResult.user.id };
}
```

Every action:

1. Calls `requireAdmin()` first.
2. Returns `{ ok: false, message: "Forbidden" }` if check fails.
3. Validates input with **Zod** before any DB operation.
4. Returns `{ ok: boolean, message?: string }` — never raw errors or stack traces.
5. Calls `revalidatePath(ROUTES.admin.settings)` on success to bust RSC cache.

---

## 12. Claim Status State Machine

**DB enum `claim_status` (verified via Supabase MCP):**

```
Submitted - Awaiting HOD approval
        ↓ (L1 approves)
HOD approved - Awaiting finance approval
        ↓ (L2 approves)
Finance Approved - Payment under process
        ↓ (Finance marks paid)
Payment Done - Closed
        ↓ (any stage, L1 or L2)
Rejected
```

Bulk actions handled by `bulk_process_claims` DB function:

- **`L2_APPROVE`** → sets status `Finance Approved - Payment under process`
- **`L2_REJECT`** → sets status `Rejected`; if `allow_resubmission=true`, soft-deletes child `expense_details`/`advance_details`
- **`MARK_PAID`** → sets status `Payment Done - Closed`, upserts `wallets` table

Admin bypasses L1/L2 actor restriction via RLS `claims_update_admin` policy. All state transitions via domain services — never direct UI-to-DB writes.

---

## 13. Wallet Impact (on Mark Paid)

**DB table:** `wallets` (1 row per user, upserted via `bulk_process_claims`)

| Payment Mode              | Wallet Delta                                                    |
| ------------------------- | --------------------------------------------------------------- |
| `Reimbursement`           | `+total_reimbursements_received`                                |
| `Petty Cash Request`      | `+total_petty_cash_received`, `petty_cash_balance` recalculated |
| `Bulk Petty Cash Request` | `+total_petty_cash_received`, `petty_cash_balance` recalculated |
| `Petty Cash`              | `+total_petty_cash_spent`, `petty_cash_balance` recalculated    |
| All others                | No wallet delta                                                 |

---

## 14. File Map Quick Reference

| Concern                     | File                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| Admin gate                  | `src/modules/admin/server/is-admin.ts`                           |
| Admin settings page (RSC)   | `src/app/(dashboard)/dashboard/admin/settings/page.tsx`          |
| All server actions          | `src/modules/admin/actions.ts`                                   |
| Claims view section         | `src/modules/admin/ui/admin-claims-section.tsx`                  |
| Claims table                | `src/modules/admin/ui/admin-claims-table.tsx`                    |
| Soft delete panel           | `src/modules/admin/ui/admin-soft-delete-panel.tsx`               |
| Master data table UI        | `src/modules/admin/ui/settings/master-data-table.tsx`            |
| Departments UI              | `src/modules/admin/ui/settings/departments-management.tsx`       |
| Finance approvers UI        | `src/modules/admin/ui/settings/finance-approvers-management.tsx` |
| Users UI                    | `src/modules/admin/ui/settings/users-management.tsx`             |
| Admins UI                   | `src/modules/admin/ui/settings/admins-management.tsx`            |
| Repository                  | `src/modules/admin/repositories/SupabaseAdminRepository.ts`      |
| GetAdminClaimsService       | `src/core/domain/admin/GetAdminClaimsService.ts`                 |
| ManageMasterDataService     | `src/core/domain/admin/ManageMasterDataService.ts`               |
| ManageActorsService         | `src/core/domain/admin/ManageActorsService.ts`                   |
| ManageAdminsService         | `src/core/domain/admin/ManageAdminsService.ts`                   |
| AdminSoftDeleteClaimService | `src/core/domain/admin/AdminSoftDeleteClaimService.ts`           |
| Contracts / types           | `src/core/domain/admin/contracts.ts`                             |
| Status constants            | `src/core/constants/statuses.ts`                                 |
| Route constants             | `src/core/config/route-registry.ts` (`ROUTES.admin.settings`)    |
