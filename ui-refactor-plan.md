# UI Refactor Plan (Phase 2)

## Scope

- Frontend-only consolidation for reusable, dense enterprise UI.
- In scope: `src/components`, `src/modules`, `src/app`.
- Shared target directory: `src/components/ui`.
- Out of scope: domain logic, API contracts, state machine transitions, repository and DB behavior.

## Duplicate Inventory

### Tables and Data Grids

- Repeated table shell/header/body patterns:
  - `src/modules/admin/ui/admin-claims-table.tsx`
  - `src/modules/claims/ui/department-claims-table.tsx`
  - `src/modules/claims/ui/finance-approvals-bulk-table.tsx`
- Repeated inline table empty state blocks.
- Skeleton duplication:
  - Shared: `src/components/ui/table-skeleton.tsx`
  - Duplicate: `src/modules/claims/ui/claims-table-skeleton.tsx`

### Pagination

- Duplicated helper functions and button styles:
  - `src/modules/claims/ui/my-claims-pagination-controls.tsx`
  - `src/modules/claims/ui/my-claims-offset-pagination-controls.tsx`

### Forms and Inputs

- Date helper fragmentation:
  - `toDateInputValue` in `src/modules/claims/ui/finance-edit-claim-form.tsx`
  - `formatDateForInput` in `src/modules/dashboard/ui/analytics-filters.tsx`
  - `parseIsoDateOnly` in `src/modules/claims/ui/claims-filter-bar.tsx`
- Repeated currency/number input patterns in claims flows.
- Repeated text/select/textarea class patterns across admin and claims screens.

### Indicators

- Shared claim status badge exists:
  - `src/modules/claims/ui/claim-status-badge.tsx`
- Additional badge-like inline pills/chips remain duplicated.

### Action Elements

- Repeated hardcoded button class strings across dashboard/admin/claims/auth.
- Repeated inline alert classes (error and warning variants).

## Shared Primitive API Blueprint

### Button

```tsx
<Button
  variant="primary | secondary | danger | success | ghost"
  size="xs | sm | md | lg"
  loading={boolean}
  loadingText="Saving..."
  className="..."
/>
```

### Badge (Base)

```tsx
<Badge tone="neutral | info | warning | success | danger" size="sm | md" />
```

### Status Strategy (Approved)

- Keep `ClaimStatusBadge` as feature-level status mapper.
- Compose it on top of base `Badge` primitive.
- Do not change claim status semantics or labels.

### Alert

```tsx
<Alert tone="error | warning | success | info" title="..." description="..." />
```

### Form Inputs (forwardRef)

```tsx
<FormInput />
<FormSelect />
<FormTextarea />
<CurrencyInput />
<DateInput />
```

### Table Empty State

```tsx
<TableEmptyState title="..." description="..." />
```

## Migration Sequence

1. Shared primitives and utilities.
2. Claims module (pagination, skeleton, table empty states).
3. Admin settings (button and alert standardization).
4. Dashboard/auth shared action and alert cleanup.

## Verification

- `npx tsc --noEmit`
- `npm run lint`
- Manual checks for claims list, approvals flows, and form behavior parity.

## Current Execution Status

- Step 1 and Step 2 complete.
- Step 3 implementation started.
