# BC Payload Expansion Design

**Date:** 2026-05-16
**Status:** Approved — ready for implementation planning

## Context

The Business Central integration currently sends a fixed set of fields per claim (1–2 line items per claim). The BC API has been updated with a richer schema. This spec covers expanding the payload to match the new schema.

Key decisions:

- **One BC POST per claim** — each claim has exactly one `expense_detail` row, so exactly one JSON object is sent to BC.
- **`bc_claim_vendors` replaced → `bc_claim_details`** — lean table: only `is_vendor_payment` is a separate column; everything else (vendor fields, payload, response) lives in JSONB columns. No schema migration needed when BC payload evolves.
- **No separate audit log** — `bc_claim_details` stores `bc_status`, `bc_payload_json`, `bc_response_json` directly. `bc_payment_audit_log` is dropped entirely.
- **Finance user selects** Currency Code, GST Group Code, HSN/SAC Code, Vendor Code/Name in the modal — only shown when vendor payment is chosen.
- A new **`bc-reference` edge function** serves dropdown options from BC OData using `$select=Code,Description` (BC returns 35+ fields per record; we only need 2).
- `amount`, `postingDate`, `accountType`, `accountNo` **removed** from the new BC API.
- `locationCode` is **fixed `"HBT"`** — no DB lookup needed.
- Vendor-only fields are **omitted entirely** (not set to null) for non-vendor claims.

---

## 1. Database Schema

### 1.1 Migration: Replace `bc_claim_vendors` with `bc_claim_details`

No existing data to preserve — BC is test-env only. Drop and recreate cleanly.

```sql
-- Drop old table and audit table entirely
DROP TABLE IF EXISTS bc_claim_vendors;
DROP TABLE IF EXISTS bc_payment_audit_log;
DROP TYPE  IF EXISTS bc_payment_audit_status;

-- Create bc_claim_details — lean table, vendor fields live in bc_payload_json
CREATE TABLE public.bc_claim_details (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          TEXT        NOT NULL REFERENCES public.claims(id),
  is_vendor_payment BOOLEAN     NOT NULL DEFAULT false,
  bc_status         TEXT        NOT NULL DEFAULT 'pending', -- 'pending' | 'success' | 'failed'
  bc_payload_json   JSONB,      -- exact payload sent to BC
  bc_response_json  JSONB,      -- BC's response (success body or error)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Remove old flags from claims, add FK to bc_claim_details
-- NULL = claim not yet sent to BC; non-NULL = BC submission exists
ALTER TABLE public.claims DROP COLUMN IF EXISTS bc_payments_flag;
ALTER TABLE public.claims DROP COLUMN IF EXISTS is_vendor_payment;
ALTER TABLE public.claims
  ADD COLUMN bc_claim_details_id UUID REFERENCES public.bc_claim_details(id) ON DELETE SET NULL;

-- Fix enum value used in bc_bal_account_type
ALTER TYPE bc_bal_account_type RENAME VALUE 'G/L Account' TO 'G/l';
```

**Example `bc_claim_details` row after a successful vendor payment:**

```json
{
  "id": "d1e2f3a4-...",
  "claim_id": "CLM-000145",
  "is_vendor_payment": true,
  "bc_status": "success",
  "bc_payload_json": {
    "documentType": "Invoice",
    "locationCode": "HBT",
    "currencyCode": "INR",
    "vendorInvoiceNo": "INV-2026-001",
    "documentDate": "2026-05-10",
    "type": "G/l",
    "quantity": 1,
    "gstGroupCode": "GST18",
    "gstCredit": "Non-Availment",
    "hsnSacCode": "998314",
    "gstSubcategory": "Ineligible-43/44",
    "employeeId": "NW0001234",
    "employeeName": "Arjun Chander",
    "vendorCode": "V0001",
    "vendorName": "Twilio Inc",
    "glCode": "503063",
    "employeeTransactionType": "Advance",
    "remarks": "CLM-000145 - Software subscription\nbill - https://xyz.supabase.co/storage/v1/object/public/receipts/inv.pdf\nbank statement - https://xyz.supabase.co/storage/v1/object/public/bank/stmt.pdf",
    "claimNo": "CLM-000145",
    "programCode": "COMMON",
    "subproductCode": "COMMON",
    "responsibleDepartment": "GENAI",
    "beneficiaryDepartment": "GENAI",
    "regionCode": "TELUGU",
    "invoiceRequired": true,
    "paymentRequired": true
  },
  "bc_response_json": { "id": "bc-internal-id-xyz", "status": "created" },
  "created_at": "2026-05-16T10:00:00Z",
  "updated_at": "2026-05-16T10:00:05Z"
}
```

**Example row for a failed non-vendor payment:**

```json
{
  "id": "a9b8c7d6-...",
  "claim_id": "CLM-000200",
  "is_vendor_payment": false,
  "bc_status": "failed",
  "bc_payload_json": {
    "documentType": "Invoice",
    "locationCode": "HBT",
    "documentDate": "2026-05-12",
    "type": "G/l",
    "quantity": 1,
    "gstCredit": "Non-Availment",
    "gstSubcategory": "Ineligible-43/44",
    "employeeId": "NW0005678",
    "employeeName": "Priya Sharma",
    "glCode": "503040",
    "employeeTransactionType": "Advance",
    "remarks": "CLM-000200 - Team lunch\nbill - https://xyz.supabase.co/storage/v1/object/public/receipts/lunch.pdf",
    "claimNo": "CLM-000200",
    "programCode": "COMMON",
    "subproductCode": "COMMON",
    "responsibleDepartment": "HR",
    "beneficiaryDepartment": "HR",
    "regionCode": "TELUGU",
    "invoiceRequired": false,
    "paymentRequired": true
  },
  "bc_response_json": { "error": "InvalidGLCode", "message": "GL code 503040 not found" },
  "created_at": "2026-05-16T11:00:00Z",
  "updated_at": "2026-05-16T11:00:03Z"
}
```

---

### 1.2 `complete_bc_claim()` DB function (replaces `complete_bc_payment`)

This function runs inside the edge function after a successful BC API call. It is atomic — both the insert and the update happen in one transaction.

```sql
CREATE OR REPLACE FUNCTION public.complete_bc_claim(
  p_claim_id          TEXT,
  p_actor_user_id     UUID,
  p_is_vendor_payment BOOLEAN,
  p_payload_json      JSONB,
  p_response_json     JSONB
)
RETURNS UUID   -- returns the new bc_claim_details.id
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bc_details_id UUID;
BEGIN
  -- Step 1: insert the BC submission record
  INSERT INTO public.bc_claim_details
    (claim_id, is_vendor_payment, bc_status, bc_payload_json, bc_response_json)
  VALUES
    (p_claim_id, p_is_vendor_payment, 'success', p_payload_json, p_response_json)
  RETURNING id INTO v_bc_details_id;

  -- Step 2: link the claim to the submission and advance status
  UPDATE public.claims
  SET
    bc_claim_details_id = v_bc_details_id,
    status              = 'Finance Approved - Payment under process',
    updated_at          = now()
  WHERE id = p_claim_id;

  -- Step 3: write claim audit log entry
  INSERT INTO public.claim_audit_log (claim_id, actor_user_id, action, metadata)
  VALUES (p_claim_id, p_actor_user_id, 'bc_submitted',
          jsonb_build_object('bc_claim_details_id', v_bc_details_id));

  RETURN v_bc_details_id;
END;
$$;
```

`bcPaymentsFlag` is a data field only — it is never used as a condition in UI code. It exists in `contracts.ts` (type definition) and two repository files (SELECT strings + row mappings). Those three files are updated as part of Section 5.4.

---

### 1.3 Recreate DB views (clean slate)

Drop both views completely and recreate them fresh. No backward-compat aliases — clean names throughout.

```sql
DROP VIEW IF EXISTS public.vw_admin_claims_dashboard;
DROP VIEW IF EXISTS public.vw_enterprise_claims_dashboard;
-- Then CREATE OR REPLACE VIEW ... with full body (copy existing SQL, apply changes below)
```

**Changes inside each new view body:**

1. Add this JOIN (after the existing `advance_details` LEFT JOIN):

```sql
LEFT JOIN public.bc_claim_details bcd ON bcd.claim_id = c.id
```

2. Replace the last two SELECT columns:

```sql
-- OLD (remove):
c.bc_payments_flag,
c.is_vendor_payment

-- NEW (replace with):
(c.bc_claim_details_id IS NOT NULL) AS is_bc_submitted,
bcd.is_vendor_payment
```

**Cascade — all places that read `bc_payments_flag` must be updated to `is_bc_submitted`:**

| File                                        | Old                                    | New                                  |
| ------------------------------------------- | -------------------------------------- | ------------------------------------ |
| `SupabaseClaimRepository.ts` SELECT strings | `bc_payments_flag`                     | `is_bc_submitted`                    |
| `SupabaseClaimRepository.ts` mappings       | `bcPaymentsFlag: row.bc_payments_flag` | `isBcSubmitted: row.is_bc_submitted` |
| `SupabaseDepartmentViewerRepository.ts`     | same                                   | same                                 |
| `src/core/domain/claims/contracts.ts`       | `bcPaymentsFlag: boolean`              | `isBcSubmitted: boolean`             |
| UI files checking `claim.bcPaymentsFlag`    | `claim.bcPaymentsFlag`                 | `claim.isBcSubmitted`                |

---

### 1.4 TypeScript types (`src/types/database.ts`)

```typescript
// REMOVE:
bc_claim_vendors: { ... }
bc_payment_audit_log: { ... }

// ADD bc_claim_details:
bc_claim_details: {
  Row: {
    id: string
    claim_id: string
    is_vendor_payment: boolean
    bc_status: string           // 'pending' | 'success' | 'failed'
    bc_payload_json: Json | null
    bc_response_json: Json | null
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    claim_id: string
    is_vendor_payment?: boolean
    bc_status?: string
    bc_payload_json?: Json | null
    bc_response_json?: Json | null
    created_at?: string
    updated_at?: string
  }
  Update: Partial<bc_claim_details['Insert']>
}

// UPDATE claims row type:
// REMOVE: bc_payments_flag: boolean, is_vendor_payment: boolean
// ADD:    bc_claim_details_id: string | null
```

---

## 2. New `bc-reference` Edge Function

**Location:** `supabase/functions/bc-reference/index.ts`

**Purpose:** Serves BC OData reference data for Finance modal dropdowns. Three types supported.

**Request:**

```
GET /bc-reference?type=currencies
GET /bc-reference?type=gstGroupCodes
GET /bc-reference?type=hsnSacCodes
```

**Response shape** (same structure for all three):

```json
{
  "value": [
    { "code": "INR", "description": "Indian Rupee" },
    { "code": "USD", "description": "US Dollar" }
  ]
}
```

**BC OData mapping** (confirmed via live API):

| `type` param  | BC entity path                           | BC fields used        |
| ------------- | ---------------------------------------- | --------------------- |
| currencies    | `/ODataV4/Company('NxtWave')/currencies` | `Code`, `Description` |
| gstGroupCodes | `/ODataV4/Company('NxtWave')/gstGroup`   | `Code`, `Description` |
| hsnSacCodes   | `/ODataV4/Company('NxtWave')/hsnSAC`     | `Code`, `Description` |

All three append `?$select=Code,Description` — BC returns 35 fields for currencies, 9 for gstGroup, 5 for hsnSAC. We return only `code` + `description`.

**Sample edge function logic:**

```typescript
const entityMap: Record<string, string> = {
  currencies: "currencies",
  gstGroupCodes: "gstGroup",
  hsnSacCodes: "hsnSAC",
};

const type = url.searchParams.get("type");
const entity = entityMap[type];
if (!entity) return errorResponse(400, "Unknown type");

const token = await getBcToken();
const bcRes = await fetch(
  `${BC_BASE_URL}/ODataV4/Company('NxtWave')/${entity}?$select=Code,Description`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const data = await bcRes.json();

return Response.json({
  value: data.value.map((r: { Code: string; Description: string }) => ({
    code: r.Code,
    description: r.Description,
  })),
});
```

**Auth:** Reuse `_shared/bcAuth.ts` and `_shared/bcEnv.ts` — same client credentials OAuth2 flow as `bc-claim`.

**Note:** Vendor search is handled by the existing `bc-vendor-search` edge function — leave it unchanged.

---

## 3. Edge Function `bc-claim` — Payload Changes

### 3.1 Updated enums (`types.ts`)

```typescript
// DELETE — replaced by BcType below:
// export const BcBalAccountType = { GLAccount: "G/L Account" } as const;

// DELETE — value was "ADVANCE", now "Advance":
// export const BcEmployeeTransactionType = { Advance: "ADVANCE" } as const;

// NEW fixed-value constants:
export const BcDocumentType = { Invoice: "Invoice" } as const;
export const BcType = { GLAccount: "G/l" } as const;
export const BcGstCredit = { NonAvailment: "Non-Availment" } as const;
export const BcGstSubcategory = { Ineligible4344: "Ineligible-43/44" } as const;
export const BcEmployeeTransactionType = { Advance: "Advance" } as const;
export const BcQuantity = 1 as const;
export const BcLocationCode = "HBT" as const;

// KEEP unchanged:
export const BcAccountType = { Employee: "Employee", Vendor: "Vendor" } as const;
```

---

### 3.2 `BcClaimLineItem` interface (`types.ts`)

Full interface for the single object POSTed to BC per claim:

```typescript
export interface BcClaimLineItem {
  // Fixed values — always hardcoded
  documentType: "Invoice"; // BcDocumentType.Invoice
  locationCode: "HBT"; // BcLocationCode
  type: "G/l"; // BcType.GLAccount
  quantity: 1; // BcQuantity
  gstCredit: "Non-Availment"; // BcGstCredit.NonAvailment
  gstSubcategory: "Ineligible-43/44"; // BcGstSubcategory.Ineligible4344
  employeeTransactionType: "Advance"; // BcEmployeeTransactionType.Advance

  // From expense_details row
  documentDate: string; // expense_details.transaction_date → "2026-05-10"
  glCode: string; // expense_category_bc_mappings.bc_code → "503063"

  // Employee — depends on submission_type
  // If submission_type = "On_behalf": use on_behalf_employee_code + on_behalf_of_id's full_name
  // If submission_type = "Self":      use claims.employee_id + submitted_by's full_name
  employeeId: string; // e.g. "NW0001234"
  employeeName: string; // e.g. "Arjun Chander"

  // Claim-level fields
  claimNo: string; // claims.id → "CLM-000145"
  remarks: string; // see format below
  programCode: string; // master_program_product_mappings.program_code
  subproductCode: string; // master_sub_product_mappings.sub_product_code
  responsibleDepartment: string; // master_department_responsible_mappings.responsible_department_code
  beneficiaryDepartment: string; // master_department_responsible_mappings.beneficiary_department_code
  regionCode: string; // master_expense_location_mappings.region_code

  // Booleans
  invoiceRequired: boolean; // true if vendor payment, false otherwise
  paymentRequired: boolean; // true if payment_mode_name = "Reimbursement", false otherwise

  // Vendor-only — OMIT ENTIRELY (do not send null/empty) for non-vendor claims
  currencyCode?: string; // Finance modal → bc-reference?type=currencies
  vendorInvoiceNo?: string; // expense_details.bill_no → "INV-2026-001"
  vendorCode?: string; // Finance modal → bc-vendor-search
  vendorName?: string; // Finance modal → bc-vendor-search
  gstGroupCode?: string; // Finance modal → bc-reference?type=gstGroupCodes
  hsnSacCode?: string; // Finance modal → bc-reference?type=hsnSacCodes
}
```

**`remarks` format:**

```
"CLM-000145 - Software subscription
bill - https://xyz.supabase.co/storage/v1/object/public/receipts/inv.pdf
bank statement - https://xyz.supabase.co/storage/v1/object/public/bank/stmt.pdf"
```

Rules:

- Always include: `"{claimId} - {purpose}"`
- Include `bill` line only if `receipt_file_path` is non-null and non-empty
- Include `bank statement` line only if `bank_statement_file_path` is non-null and non-empty
- Use full absolute URLs — not relative storage paths

**Omit pattern for vendor-only fields:**

```typescript
const line: BcClaimLineItem = {
  documentType: "Invoice",
  locationCode: "HBT",
  type: "G/l",
  quantity: 1,
  gstCredit: "Non-Availment",
  gstSubcategory: "Ineligible-43/44",
  employeeTransactionType: "Advance",
  documentDate,
  glCode,
  employeeId,
  employeeName,
  claimNo,
  remarks,
  programCode,
  subproductCode,
  responsibleDepartment,
  beneficiaryDepartment,
  regionCode,
  invoiceRequired: isVendorPayment,
  paymentRequired: paymentModeName === "Reimbursement",
  ...(isVendorPayment && {
    currencyCode,
    vendorInvoiceNo: bill_no,
    vendorCode,
    vendorName,
    gstGroupCode,
    hsnSacCode,
  }),
};
```

---

### 3.3 DB query — `get_bc_claim_payload` rewrite

Current function fetches minimal data. Needs a full rewrite to return all fields required to build the payload.

**New return shape (JSONB) — flat object:**

```json
{
  "claim_id": "CLM-000145",
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
  "bill_no": "INV-2026-001",
  "transaction_date": "2026-05-10",
  "approved_amount": 1500.0,
  "purpose": "Software subscription",
  "receipt_file_path": "receipts/CLM-000145/inv.pdf",
  "bank_statement_file_path": null,
  "bc_code": "503063"
}
```

On-behalf example (submission_type = "On_behalf"):

```json
{
  "submission_type": "On_behalf",
  "employee_id": "NW0009999",
  "on_behalf_employee_code": "NW0009999",
  "employee_name": "Ravi Kumar"
}
```

→ Edge function uses `on_behalf_employee_code` for `employeeId` and `employee_name` (resolved from `on_behalf_of_id → users.full_name`) for `employeeName`.

**Key JOINs the new function requires:**

```sql
FROM   public.claims c
JOIN   public.master_payment_modes mpm   ON mpm.id = c.payment_mode_id
JOIN   public.expense_details ed          ON ed.claim_id = c.id AND ed.is_active = true
JOIN   public.users submitter             ON submitter.id = c.submitted_by
LEFT JOIN public.users onbehalf           ON onbehalf.id = c.on_behalf_of_id
JOIN   public.expense_category_bc_mappings ecm ON ecm.expense_category_id = ed.expense_category_id AND ecm.is_active = true
JOIN   public.master_program_product_mappings ppm ON ppm.product_id = ed.product_id AND ppm.is_active = true
JOIN   public.master_sub_product_mappings spm     ON spm.product_id = ed.product_id AND spm.is_active = true
JOIN   public.master_department_responsible_mappings drm ON drm.department_id = c.department_id AND drm.is_active = true
JOIN   public.master_expense_location_mappings elm        ON elm.location_id = ed.location_id AND elm.is_active = true
WHERE  c.id = p_claim_id AND c.is_active = true
```

**Error variants the function returns:**

```json
{ "error": "CLAIM_NOT_FOUND",      "claim_id": "..." }
{ "error": "NOT_EXPENSE_MODE",     "payment_mode": "Advance" }
{ "error": "ALREADY_SUBMITTED",    "bc_claim_details_id": "..." }
{ "error": "EXPENSE_DETAILS_MISSING" }
{ "error": "MISSING_MAPPING",      "field": "bc_code",               "expense_category_id": "..." }
{ "error": "MISSING_MAPPING",      "field": "programCode",           "product_id": "..." }
{ "error": "MISSING_MAPPING",      "field": "subproductCode",        "product_id": "..." }
{ "error": "MISSING_MAPPING",      "field": "responsibleDepartment", "department_id": "..." }
{ "error": "MISSING_MAPPING",      "field": "regionCode",            "location_id": "..." }
```

---

### 3.4 Edge function `bc-claim/index.ts` — request body + flow

**Request body from Finance modal:**

```json
{
  "claimId": "CLM-000145",
  "isVendorPayment": true,
  "bcVendorCode": "V0001",
  "bcVendorName": "Twilio Inc",
  "currencyCode": "INR",
  "gstGroupCode": "GST18",
  "hsnSacCode": "998314",
  "actorUserId": "uuid-of-finance-user"
}
```

Non-vendor request (vendor fields absent):

```json
{
  "claimId": "CLM-000200",
  "isVendorPayment": false,
  "actorUserId": "uuid-of-finance-user"
}
```

**Edge function flow:**

```
1. Parse + validate request body
2. Call get_bc_claim_payload(claimId) → error if CLAIM_NOT_FOUND / ALREADY_SUBMITTED
3. Build BcClaimLineItem via payloadBuilder
4. POST payload to BC API
5. On success → call complete_bc_claim(claimId, actorUserId, isVendorPayment, payload, bcResponse)
6. Return { success: true, bcClaimDetailsId }

On BC API failure:
5b. INSERT bc_claim_details with bc_status='failed', bc_payload_json, bc_response_json
6b. Return { success: false, error: bcResponse }
```

---

## 4. UI — BC Claim Modal

**File:** `src/modules/claims/ui/bc-claim-modal.tsx` (renamed from `bc-payment-modal.tsx`)

### 4.1 Dropdown fields — vendor payment only

These three dropdowns appear **only when Finance selects "Vendor Payment"**. They are fetched from `bc-reference` when the vendor toggle is turned on (not on modal open — lazy load).

| Field          | Edge function call                     | What displays in dropdown |
| -------------- | -------------------------------------- | ------------------------- |
| Currency Code  | `GET /bc-reference?type=currencies`    | `"INR - Indian Rupee"`    |
| GST Group Code | `GET /bc-reference?type=gstGroupCodes` | `"GST18 - GST 18%"`       |
| HSN/SAC Code   | `GET /bc-reference?type=hsnSacCodes`   | `"998314 - IT Services"`  |

Vendor Code + Vendor Name use the existing `bc-vendor-search` — no change.

### 4.2 Updated payload sent to `bc-claim` edge function

Vendor payment submission:

```typescript
supabase.functions.invoke("bc-claim", {
  body: {
    claimId: claim.id,
    isVendorPayment: true,
    bcVendorCode: selectedVendor.code,
    bcVendorName: selectedVendor.name,
    currencyCode: selectedCurrency.code, // "INR"
    gstGroupCode: selectedGstGroup.code, // "GST18"
    hsnSacCode: selectedHsnSac.code, // "998314"
    actorUserId: currentUser.id,
  },
});
```

Non-vendor payment submission:

```typescript
supabase.functions.invoke("bc-claim", {
  body: {
    claimId: claim.id,
    isVendorPayment: false,
    actorUserId: currentUser.id,
  },
});
```

---

## 5. Rename: `bc-payment` → `bc-claim` Throughout

### 5.1 Edge function directory

```
supabase/functions/bc-payment/  →  supabase/functions/bc-claim/
```

All files inside move with it: `index.ts`, `types.ts`, `payloadBuilder.ts`, `bcAuth.ts`, `bcEnv.ts`, `bcPaymentsClient.ts`.

### 5.2 DB cleanup (handled in migration from Section 1.1)

```sql
-- Already covered in 1.1 migration:
DROP TABLE IF EXISTS bc_payment_audit_log;
DROP TYPE  IF EXISTS bc_payment_audit_status;
DROP FUNCTION IF EXISTS public.complete_bc_payment(TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB);
```

No `bc_claim_audit_log` or `bc_claim_audit_status` is created — audit lives in `bc_claim_details`.

### 5.3 Frontend renames

| Old                                                             | New                       |
| --------------------------------------------------------------- | ------------------------- |
| `src/modules/claims/ui/bc-payment-modal.tsx`                    | `bc-claim-modal.tsx`      |
| `BcPaymentModal` component                                      | `BcClaimModal`            |
| `supabase.functions.invoke("bc-payment", ...)`                  | `invoke("bc-claim", ...)` |
| `import { BcPaymentModal }` in `claim-decision-action-form.tsx` | `import { BcClaimModal }` |

### 5.4 Domain / repository layer

| Old                                               | New                                           |
| ------------------------------------------------- | --------------------------------------------- |
| `bcPaymentsFlag` in `contracts.ts`                | `isBcSubmitted: boolean`                      |
| `isVendorPayment` in `contracts.ts`               | `isVendorPayment: boolean` (keep, still used) |
| `bc_payments_flag` in repository SELECT strings   | `is_bc_submitted`                             |
| `bc_payments_flag: row.bc_payments_flag` mappings | `isBcSubmitted: row.is_bc_submitted`          |
| `claim.bcPaymentsFlag` in UI files                | `claim.isBcSubmitted`                         |

Also add `bcClaimDetailsId: string | null` to `contracts.ts` — needed when the edge function returns the new bc_claim_details id.

`bc-vendor-search` edge function is **not renamed** — vendor lookup, unrelated to claim posting.

---

## 6. Summary of All File Changes

| File                                                                    | Change                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/20260516XXXXXX_bc_schema_changes.sql`              | Drop bc_claim_vendors, bc_payment_audit_log; create bc_claim_details (lean table); update claims columns; fix enum |
| `supabase/migrations/20260516XXXXXX_bc_claim_functions.sql`             | Rewrite get_bc_claim_payload; drop complete_bc_payment; create complete_bc_claim                                   |
| `supabase/migrations/20260516XXXXXX_update_bc_views.sql`                | Recreate vw_admin_claims_dashboard and vw_enterprise_claims_dashboard with LEFT JOIN bc_claim_details              |
| `src/types/database.ts`                                                 | Remove bc_claim_vendors + bc_payment_audit_log types; add bc_claim_details type; update claims row                 |
| `supabase/functions/bc-reference/index.ts`                              | New edge function — currencies, gstGroupCodes, hsnSacCodes                                                         |
| `supabase/functions/bc-claim/` (dir rename from `bc-payment/`)          | All internal files updated                                                                                         |
| `supabase/functions/bc-claim/types.ts`                                  | New enums + BcClaimLineItem interface; delete BcBalAccountType                                                     |
| `supabase/functions/bc-claim/payloadBuilder.ts`                         | Rewrite: single flat object, locationCode = "HBT", vendor spread                                                   |
| `supabase/functions/bc-claim/index.ts`                                  | New request body shape, updated DB call, complete_bc_claim on success                                              |
| `src/modules/claims/ui/bc-claim-modal.tsx` (renamed)                    | Three vendor-only dropdowns; updated invoke body                                                                   |
| `src/modules/claims/ui/claim-decision-action-form.tsx`                  | Import BcClaimModal                                                                                                |
| `src/core/domain/claims/contracts.ts`                                   | Remove `bcPaymentsFlag`; add `isBcSubmitted: boolean` + `bcClaimDetailsId: string \| null`                         |
| `src/modules/claims/repositories/SupabaseClaimRepository.ts`            | Replace `bc_payments_flag` → `is_bc_submitted` in all SELECT strings and mappings                                  |
| `src/modules/claims/repositories/SupabaseDepartmentViewerRepository.ts` | Same — replace `bc_payments_flag` → `is_bc_submitted`                                                              |

---

## 7. Verification

1. **DB migration clean:** `supabase db push` — no errors; `bc_claim_vendors` and `bc_payment_audit_log` gone; `bc_claim_details` exists with correct columns
2. **Views resolve:** `SELECT bc_payments_flag, is_vendor_payment FROM vw_admin_claims_dashboard LIMIT 1` — no error
3. **bc-reference (currencies):** `GET /bc-reference?type=currencies` → `{ value: [{ code: "INR", description: "Indian Rupee" }, ...] }`
4. **bc-reference (gstGroupCodes):** `GET /bc-reference?type=gstGroupCodes` → non-empty array
5. **bc-reference (hsnSacCodes):** `GET /bc-reference?type=hsnSacCodes` → non-empty array
6. **Non-vendor claim POST:** BC receives payload with no `currencyCode`, `vendorCode`, `vendorName`, `gstGroupCode`, `hsnSacCode` keys at all — not null, not empty string, fully absent
7. **Vendor claim POST:** BC receives all 26 fields including vendor-only fields; `invoiceRequired: true`
8. **bc_claim_details row:** After successful submission — `bc_status = 'success'`, `bc_payload_json` has full payload, `claims.bc_claim_details_id` is set
9. **Failed submission:** `bc_status = 'failed'`, `bc_response_json` has BC error message, `claims.bc_claim_details_id` remains null
10. **TypeScript:** `tsc --noEmit` clean
