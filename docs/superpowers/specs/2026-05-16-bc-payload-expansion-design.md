# BC Payload Expansion Design

**Date:** 2026-05-16  
**Status:** Approved — ready for implementation planning

## Context

The Business Central integration currently sends a fixed set of fields per claim (1–2 line items per claim). The BC API has been updated with a richer schema requiring additional GST, vendor, and document fields. This spec covers expanding the payload to match the new schema.

Key decisions:

- **One BC line item per claim** — each claim has exactly one `expense_detail` row, so exactly one object is POSTed to BC per claim submission.
- 1> **`bc_claim_vendors` renamed → `bc_claim_details`** with new columns; `is_vendor_payment` moves here from `claims`
- **Finance user selects** Currency Code, GST Group Code, HSN/SAC Code, Vendor Code/Name in the modal — only shown when vendor payment is chosen.
- A new **`bc-reference` edge function** serves dropdown options from BC OData; uses `$select=Code,Description` to avoid returning BC's many internal fields
- `amount`, `postingDate`, `accountType`, `accountNo` **removed** from the new BC API — BC derives the amount internally
- `locationCode` is **fixed `"HBT"`** — no DB lookup needed
- Vendor-only fields are **omitted** (not set to null) when not applicable

---

## 1. Database Schema

### 1.1 Migration: Replace `bc_claim_vendors` with `bc_claim_details`

No existing data to preserve — BC is test-env only. Drop and recreate cleanly.

```sql
-- Drop old table entirely
DROP TABLE IF EXISTS bc_claim_vendors;

-- Create bc_claim_details from scratch with all required columns
CREATE TABLE bc_claim_details (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         TEXT NOT NULL REFERENCES claims(id),
  is_vendor_payment BOOLEAN NOT NULL DEFAULT false,
  bc_vendor_id     TEXT,
  bc_vendor_name   TEXT,
  currency_code    TEXT,
  gst_group_code   TEXT,
  hsn_sac_code     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Remove old columns from claims, add FK to bc_claim_details
ALTER TABLE claims DROP COLUMN IF EXISTS bc_payments_flag;
ALTER TABLE claims DROP COLUMN IF EXISTS is_vendor_payment;
ALTER TABLE claims ADD COLUMN bc_claim_details_id UUID
  REFERENCES bc_claim_details(id) ON DELETE SET NULL;

-- Fix enum value
ALTER TYPE bc_bal_account_type RENAME VALUE 'G/L Account' TO 'G/l';
```

### 1.2 Update `complete_bc_claim()` function (renamed from `complete_bc_payment`)

New signature adds `currency_code`, `gst_group_code`, `hsn_sac_code`. `is_vendor_payment` moves into the `bc_claim_details` INSERT. `bc_payments_flag` is replaced by setting `bc_claim_details_id` on `claims`.

```sql
-- Step 1: insert into bc_claim_details, capture the new row's id
INSERT INTO bc_claim_details
  (claim_id, is_vendor_payment, bc_vendor_id, bc_vendor_name,
   currency_code, gst_group_code, hsn_sac_code)
VALUES (...)
RETURNING id INTO v_bc_details_id;

-- Step 2: link claims back to the bc_claim_details row (replaces bc_payments_flag)
UPDATE claims
  SET bc_claim_details_id = v_bc_details_id,
      status = 'Finance Approved - Payment under process'
  WHERE id = p_claim_id;
```

All existing code that checks `bc_payments_flag = true` must be updated to `bc_claim_details_id IS NOT NULL`.

### 1.3 Update DB views

The views do **not** JOIN on `bc_claim_vendors`. They project `c.is_vendor_payment` and `c.bc_payments_flag` directly from `claims`. Since both columns are moving/renaming, the views need:

1. Add `LEFT JOIN bc_claim_details bce ON bce.claim_id = c.id`
2. Replace `c.is_vendor_payment` → `bce.is_vendor_payment`
3. Replace `c.bc_payments_flag` → `(c.bc_claim_details_id IS NOT NULL) AS bc_payments_flag`

Files: `vw_admin_claims_dashboard` (lines 122–123) and `vw_enterprise_claims_dashboard` (lines 233–234) in migration `20260512120000_add_payment_flags_to_claims.sql` — the new migration must recreate both views.

### 1.4 TypeScript types

Update `src/types/database.ts`:

- Rename `bc_claim_vendors` key → `bc_claim_details`
- Add `currency_code`, `gst_group_code`, `hsn_sac_code`, `is_vendor_payment` columns
- On `claims` row type: remove `bc_payments_flag`, remove `is_vendor_payment`, add `bc_claim_details_id: string | null`

---

## 2. New `bc-reference` Edge Function

**Location:** `supabase/functions/bc-reference/`

**Purpose:** Serves BC OData reference data for Finance modal dropdowns. Reuses `_shared/bcAuth.ts` for token management.

**Interface:**

```
GET /bc-reference?type=currencies
GET /bc-reference?type=gstGroupCodes
GET /bc-reference?type=hsnSacCodes
```

Note: vendor search already has its own `bc-vendor-search` edge function — leave it unchanged.

**Response shape:**

```json
{ "value": [{ "code": "INR", "name": "Indian Rupee" }] }
```

**BC OData entity names** — confirmed via live API call:

- currencies → `/ODataV4/Company('NxtWave')/currencies?$select=Code,Description`
- gstGroupCodes → `/ODataV4/Company('NxtWave')/gstGroup?$select=Code,Description`
- hsnSacCodes → `/ODataV4/Company('NxtWave')/hsnSAC?$select=Code,Description`
- vendors → `/ODataV4/Company('NxtWave')/vendors` (handled by existing `bc-vendor-search`, unchanged)

`$select` is required — BC returns 35 fields for currencies, 9 for gstGroup, 5 for hsnSAC. We only need `Code` and `Description` for dropdowns.

**Auth:** Same client credentials OAuth2 flow as `bc-claim`. Reuse `_shared/bcAuth.ts` and `_shared/bcEnv.ts`.

---

## 3. Edge Function `bc-claim` — Payload Changes

### 3.1 Updated enums (`types.ts`)

```typescript
// Keep (unchanged values)
export const BcAccountType = { Employee: "Employee", Vendor: "Vendor" } as const;
// ↑ Still used for accountType field in DB records; remove from BcClaimLineItem only

// New fixed-value constants
export const BcDocumentType = { Invoice: "Invoice" } as const;
export const BcType = { GLAccount: "G/l" } as const;
export const BcGstCredit = { NonAvailment: "Non-Availment" } as const;
export const BcGstSubcategory = { Ineligible4344: "Ineligible-43/44" } as const;
export const BcEmployeeTransactionType = { Advance: "Advance" } as const;
export const BcQuantity = 1 as const;

// REMOVED enums (no longer needed in payload):
// BcBalAccountType ("G/L Account") → replaced by BcType ("G/l")
// Old BcEmployeeTransactionType.Advance = "ADVANCE" → updated to "Advance"
```

**Enum cleanup:** Delete `BcBalAccountType`. After rewriting `BcClaimLineItem` and `payloadBuilder.ts`, remove any enum keys or interfaces with zero remaining references. Do not keep dead values.

### 3.2 Complete new `BcClaimLineItem` interface (`types.ts`)

The new BC API is a single POST per `expense_detail` row. Employee and vendor data coexist in one object. Fields `postingDate`, `accountType`, `accountNo`, `amount` are **gone** from the new API.

```typescript
interface BcClaimLineItem {
  // Fixed values
  documentType: "Invoice"; // BcDocumentType.Invoice
  type: "G/l"; // BcType.GLAccount (renamed from balAccountType)
  quantity: 1; // BcQuantity
  gstCredit: "Non-Availment"; // BcGstCredit.NonAvailment
  gstSubcategory: "Ineligible-43/44"; // BcGstSubcategory.Ineligible4344
  employeeTransactionType: "Advance"; // BcEmployeeTransactionType.Advance

  // Per-expense-detail (varies per row)
  documentDate: string; // expense_details.transaction_date (ISO YYYY-MM-DD)
  glCode: string; // expense_category_bc_mappings.bc_code (renamed from balAccountNo)

  // Employee fields (from claim + users table)
  employeeId: string; // on_behalf_employee_code if On_behalf, else claims.employee_id
  employeeName: string; // users.full_name (on_behalf_of_id if On_behalf, else submitted_by)

  // Claim reference + mappings
  claimNo: string; // claims.id
  remarks: string; // "claimId - purpose\nbill - <full_url>\nbank statement - <full_url>"
  programCode: string; // master_program_product_mappings.program_code (renamed from nwProgramCode)
  subproductCode: string; // master_sub_product_mappings.sub_product_code (was subProductCode)
  responsibleDepartment: string; // master_department_responsible_mappings.responsible_department_code
  beneficiaryDepartment: string; // master_department_responsible_mappings.beneficiary_department_code
  regionCode: string; // master_expense_location_mappings.region_code
  locationCode: "HBT"; // fixed value always

  // Booleans
  invoiceRequired: boolean; // true if is_vendor_payment, false otherwise
  paymentRequired: boolean; // true if payment_mode_name = "Reimbursement", false otherwise

  // Vendor-only — OMIT ENTIRELY (do not send null) for non-vendor claims
  currencyCode?: string; // Finance modal selection
  vendorInvoiceNo?: string; // expense_details.bill_no
  vendorCode?: string; // Finance modal selection
  vendorName?: string; // Finance modal selection
  gstGroupCode?: string; // Finance modal selection
  hsnSacCode?: string; // Finance modal selection
}
```

**Null vs omit rule:** For vendor-only optional fields on a non-vendor claim, omit the key entirely. In TypeScript:

```typescript
const line: BcClaimLineItem = {
  documentType: "Invoice",
  // ... all required fields ...
  ...(isVendorPayment && {
    currencyCode,
    vendorInvoiceNo,
    vendorCode,
    vendorName,
    gstGroupCode,
    hsnSacCode,
  }),
};
```

### 3.3 DB query — `get_bc_claim_payload` rewrite

The existing `get_bc_claim_payload` function needs a full rewrite. Current gaps:

- Only returns first `expense_detail` row (`LIMIT 1`) — fine for single-expense claims but `LIMIT 1` should be replaced with a direct WHERE on claim_id
- No `submission_type`, `on_behalf_employee_code`, `on_behalf_of_id`, `employee_id` from claims
- No `users.full_name` JOIN for employee name
- No `bill_no`, `transaction_date` from expense_detail
- No `payment_mode_name` (needed for `paymentRequired` field)
- Still references `bc_payments_flag` (being removed)

New return shape (JSONB) — flat object, no `expense_details` array since there is exactly one expense per claim:

```json
{
  "claim_id": "CLAIM-...",
  "bc_claim_details_id": null,
  "payment_mode_name": "Reimbursement",
  "submission_type": "Self",
  "employee_id": "NW0001234",
  "on_behalf_employee_code": null,
  "employee_name": "Arjun Chander",
  "program_code": "COMMON",
  "sub_product_code": "COMMON",
  "responsible_department_code": "GENAI",
  "beneficiary_department_code": "GENAI",
  "region_code": "TELUGU",
  "bill_no": "INV-001",
  "transaction_date": "2026-05-10",
  "approved_amount": 1500.0,
  "purpose": "Software subscription",
  "receipt_file_path": "https://...",
  "bank_statement_file_path": null,
  "bc_code": "503063"
}
```

The edge function body accepts new Finance modal params: `currencyCode`, `gstGroupCode`, `hsnSacCode`, `bcVendorId`, `bcVendorName`, `isVendorPayment`.

### 3.4 Payload builder rewrite (`payloadBuilder.ts`)

**Old:** 1 or 2 line items per claim (employee line + optional vendor line as separate BC API calls).

**New:** 1 object per claim (one expense per claim). Vendor-only fields are conditionally spread in.

```
line = {
  documentType: "Invoice",
  locationCode: "HBT",
  type: "G/l",
  quantity: 1,
  gstCredit: "Non-Availment",
  gstSubcategory: "Ineligible-43/44",
  employeeTransactionType: "Advance",
  documentDate: db.transaction_date,
  glCode: db.bc_code,
  employeeId: db.submission_type === "On_behalf" ? db.on_behalf_employee_code : db.employee_id,
  employeeName: db.employee_name,
  claimNo: db.claim_id,
  remarks: buildRemarks(db.claim_id, db.purpose, db.receipt_file_path, db.bank_statement_file_path),
  programCode: db.program_code,
  subproductCode: db.sub_product_code,
  responsibleDepartment: db.responsible_department_code,
  beneficiaryDepartment: db.beneficiary_department_code,
  regionCode: db.region_code,
  invoiceRequired: isVendorPayment,
  paymentRequired: db.payment_mode_name === "Reimbursement",
  ...(isVendorPayment && { currencyCode, vendorInvoiceNo: db.bill_no, vendorCode, vendorName, gstGroupCode, hsnSacCode })
}
```

`remarks` format: `"{claim_id} - {purpose}\nbill - {full_url}\nbank statement - {full_url}"` — only include file lines if the path is non-null and non-empty. Use full absolute URLs, not relative paths.

---

## 4. UI — BC Claim Modal

**File to update:** `src/modules/claims/ui/bc-claim-modal.tsx` (renamed from `bc-payment-modal.tsx`)

### 4.1 New vendor-only dropdown fields

Shown only when `is_vendor_payment = true`:

| Field          | Fetched from                      |
| -------------- | --------------------------------- |
| Currency Code  | `bc-reference?type=currencies`    |
| GST Group Code | `bc-reference?type=gstGroupCodes` |
| HSN/SAC Code   | `bc-reference?type=hsnSacCodes`   |

Vendor Code + Vendor Name already exist in the modal via the existing `bc-vendor-search` edge function — no change needed there.

### 4.2 Payload to edge function

Add to the existing edge function call body:

```json
{
  "currencyCode": "INR",
  "gstGroupCode": "GOODS",
  "hsnSacCode": "998311"
}
```

---

## 5. Rename: `bc-payment` → `bc-claim` Throughout BC Layer

"BC payment" was a misnomer — these are claim postings to BC covering both expenses and vendor payments. All BC-specific identifiers must use `bc-claim` / `bc_claim`.

### 5.1 Edge function directory

```
supabase/functions/bc-payment/  →  supabase/functions/bc-claim/
```

### 5.2 DB renames (new migration)

```sql
-- Drop old audit table and enum entirely (test env, no data to preserve)
DROP TABLE IF EXISTS bc_payment_audit_log;
DROP TYPE IF EXISTS bc_payment_audit_status;

-- Recreate with new names (schema defined in bc_claim_functions migration)
-- bc_claim_audit_log and bc_claim_audit_status created fresh there

-- DB function (drop old, create new with updated name and body)
DROP FUNCTION IF EXISTS public.complete_bc_payment(TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB);
CREATE OR REPLACE FUNCTION public.complete_bc_claim(...) ...
```

### 5.3 Frontend renames

| File                                                            | Change                             |
| --------------------------------------------------------------- | ---------------------------------- |
| `src/modules/claims/ui/bc-payment-modal.tsx`                    | Rename file → `bc-claim-modal.tsx` |
| `BcPaymentModal` (component export + usages)                    | → `BcClaimModal`                   |
| `supabase.functions.invoke("bc-payment", ...)`                  | → `invoke("bc-claim", ...)`        |
| `import { BcPaymentModal }` in `claim-decision-action-form.tsx` | → `import { BcClaimModal }`        |

### 5.4 Domain / repository layer

`bcPaymentsFlag` in `contracts.ts` and `SupabaseClaimRepository.ts` is already being removed (replaced by `bcClaimDetailsId`) — no separate rename needed there.

`bc-vendor-search` edge function is **not renamed** — it's vendor lookup, unrelated to claim posting.

---

## 6. Summary of All File Changes

| File                                                                             | Change                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/20260516XXXXXX_bc_schema_changes.sql`                       | Rename bc_claim_vendors→bc_claim_details; move is_vendor_payment; replace bc_payments_flag with bc_claim_details_id FK; add vendor columns; fix bc_bal_account_type enum |
| `supabase/migrations/20260516XXXXXX_bc_claim_rename.sql`                         | Rename bc_payment_audit_log→bc_claim_audit_log, enum, indexes                                                                                                            |
| `supabase/migrations/20260516XXXXXX_bc_claim_functions.sql`                      | Rewrite get_bc_claim_payload (all expense_details, new fields); drop complete_bc_payment, create complete_bc_claim                                                       |
| `supabase/migrations/20260516XXXXXX_update_bc_views.sql`                         | Recreate views: LEFT JOIN bc_claim_details, is_vendor_payment from bce, bc_claim_details_id IS NOT NULL for bc_payments_flag                                             |
| `src/types/database.ts`                                                          | Rename bc_claim_vendors → bc_claim_details, rename bc_payment_audit_log → bc_claim_audit_log, update claims columns                                                      |
| `supabase/functions/bc-reference/index.ts`                                       | New edge function                                                                                                                                                        |
| `supabase/functions/bc-claim/` (renamed from `bc-payment/`)                      | Directory rename; all internal files updated                                                                                                                             |
| `supabase/functions/bc-claim/types.ts`                                           | New enums, updated interface, enum cleanup                                                                                                                               |
| `supabase/functions/bc-claim/payloadBuilder.ts`                                  | Rewrite: single object per claim, locationCode fixed "HBT", vendor fields conditionally spread                                                                           |
| `supabase/functions/bc-claim/index.ts`                                           | Updated DB query, new body params, calls `complete_bc_claim()`                                                                                                           |
| `src/modules/claims/ui/bc-claim-modal.tsx` (renamed from `bc-payment-modal.tsx`) | New vendor-only dropdowns, invokes `bc-claim`                                                                                                                            |
| `src/modules/claims/ui/claim-decision-action-form.tsx`                           | Import `BcClaimModal`                                                                                                                                                    |
| `src/core/domain/claims/contracts.ts`                                            | Remove `bcPaymentsFlag`, add `bcClaimDetailsId`                                                                                                                          |
| `src/modules/claims/repositories/SupabaseClaimRepository.ts`                     | Update column/field references                                                                                                                                           |

---

## 7. Verification

1. **DB migration:** `supabase db push` clean — no errors, views resolve correctly
2. **bc-reference function:** `curl` each type param returns a non-empty array of `{ code, name }` from BC sandbox
3. **bc-claim function (non-vendor):** Submit a Reimbursement claim — BC receives correct per-row line items; `paymentRequired=true`, no vendor fields
4. **bc-claim function (vendor):** Submit a vendor claim — BC receives employee + vendor line item pair per expense row; all vendor fields populated
5. **Modal dropdowns:** Finance approval modal shows Currency/GST/HSN dropdowns only for vendor payments; they populate from bc-reference
6. **Audit log:** `bc_claim_audit_log.payload_json` reflects new field names (`remarks` not `description`, `type` not `balAccountType`, `glCode` not `balAccountNo`)
7. **TypeScript:** `tsc --noEmit` clean
