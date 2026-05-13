# BC Payment Integration — Implementation Spec

## Feature Name

`bcPaymentIntegration`

## UI Note

For any UI work (modal, vendor search, bulk approval screen), use the `frontend-design` plugin. Match the existing app's theme, colors, typography, button styles, and card shadows exactly. Do not introduce new UI libraries.

---

## Scope & Constraints

- **Who can use this**: Finance Approvers and Admins only. No other roles can trigger this flow. Enforce on both client and server.
- **Which claims**: Only claims where `payment_mode = 'Reimbursement'`. Determined by joining `claims.payment_mode_id` → `master_payment_modes.name = 'Reimbursement'`. All other payment modes: skip silently, no modal, no API call.
- **When it triggers**: During Finance Approval, at the transition to status `"Finance Approved - Payment Under Process"`. No other step in the claim lifecycle is touched.
- **One expense_details row per claim**: Each claim has exactly one active `expense_details` row. Use `WHERE claim_id = ? AND is_active = true LIMIT 1` to fetch it.

---

## DB Changes Required

### Already created: `bc_claim_vendors`

This table exists via migration `20260513100000_create_bc_claim_vendors.sql`. Do NOT re-create it.

**Required fix (add via new migration)**: The original migration created `bc_vendor_id` and `bc_vendor_name` as `NOT NULL`, but non-vendor payments have no vendor — NULL is the correct value here, not an empty string. Add a migration to drop the NOT NULL constraint:

```sql
ALTER TABLE public.bc_claim_vendors
  ALTER COLUMN bc_vendor_id   DROP NOT NULL,
  ALTER COLUMN bc_vendor_name DROP NOT NULL;
```

Final schema after the fix:

```
bc_claim_vendors
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
  claim_id       TEXT        NOT NULL REFERENCES claims(id) ON DELETE CASCADE
  bc_vendor_id   TEXT        NULL
  bc_vendor_name TEXT        NULL
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```

Insert one row per claim when BC payment is processed:

- **Vendor payment**: `bc_vendor_id` = vendor's `No` from BC API, `bc_vendor_name` = vendor's `Name` from BC API.
- **Non-vendor payment**: `bc_vendor_id` = NULL, `bc_vendor_name` = NULL.

Always insert a row — even for non-vendor — so there is a complete audit record of every BC payment. Query `WHERE bc_vendor_id IS NULL` to identify non-vendor payments.

### Already created: columns on `claims`

These columns already exist via migration `20260512120000_add_payment_flags_to_claims.sql`. Do NOT re-add them.

`bc_payments_flag  BOOLEAN NOT NULL DEFAULT false` → set to `true` after successful BC send. Never re-send if this is `true`.
`is_vendor_payment BOOLEAN NOT NULL DEFAULT false` → set to `true` when a vendor is chosen for this payment.

### New Postgres enums (add via migration)

```sql
CREATE TYPE bc_account_type AS ENUM ('Employee', 'Vendor');
CREATE TYPE bc_employee_transaction_type AS ENUM ('ADVANCE');
CREATE TYPE bc_bal_account_type AS ENUM ('G/L Account');
```

These enums are used in the BC payload construction and in the audit log. They prevent typos and make the BC contract explicit.

### New table: `bc_payment_audit_log` (add via migration)

```sql
CREATE TABLE public.bc_payment_audit_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         TEXT NOT NULL REFERENCES claims(id),
  idempotency_key  UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status           TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  payload_json     JSONB NOT NULL,
  bc_response_json JSONB,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
```

This table is the safety net. It records every BC payment attempt BEFORE the external call is made. If BC succeeds but the DB update fails, a `PENDING` row older than 5 minutes signals an inconsistency that must be manually resolved. An admin dashboard or monitoring query should alert on these.

---

## Architecture Decision: Where Logic Lives

### Supabase Edge Function: `bc-payment`

Handles the entire payment flow for a single claim or a batch. Called from the frontend via `supabase.functions.invoke('bc-payment', { body: { ... } })`.

Responsibilities:

- Validates input
- Fetches and validates claim data + all mappings from DB in one DB function call
- Writes `PENDING` audit log record
- Acquires BC OAuth2 token (with in-memory caching per Edge Function instance)
- Calls BC Payments API
- On success: atomically updates claims, bc_claim_vendors, and audit log in one DB call
- On failure: marks audit log as `FAILED`, returns error to client

### Supabase Edge Function: `bc-vendor-search`

Handles vendor autocomplete. Called with a search term, calls BC Vendor API, returns matching vendors.

### Supabase DB Function: `get_bc_claim_payload(claim_id TEXT)`

Runs all mapping lookups in a single DB round-trip. Returns a JSON object with all the data needed to construct the BC payload:

```
{
  employee_id,
  approved_amount,
  purpose,
  receipt_file_path,
  bank_statement_file_path,
  expense_category_id,
  bc_code,                      -- from expense_category_bc_mappings
  program_code,                 -- from master_program_product_mappings
  sub_product_code,             -- from master_sub_product_mappings
  responsible_department_code,  -- from master_department_responsible_mappings
  region_code,                  -- from master_expense_location_mappings
  payment_mode_name,            -- to confirm it's Reimbursement
  bc_payments_flag              -- to guard against duplicate sends
}
```

If any mapping is missing, the function returns an error object naming the missing mapping.

### Supabase DB Function: `complete_bc_payment(claim_id, is_vendor, vendor_id, vendor_name, audit_log_id, bc_response)`

Atomic DB update. In a single transaction:

1. Update `claims`: set `status = 'Finance Approved - Payment Under Process'`, `bc_payments_flag = true`, `is_vendor_payment = is_vendor`.
2. Insert into `bc_claim_vendors`: `(claim_id, bc_vendor_id, bc_vendor_name)`.
3. Update `bc_payment_audit_log`: set `status = 'SUCCESS'`, `bc_response_json = bc_response`, `resolved_at = now()`.

If this DB function fails after BC already succeeded: the audit log row remains `PENDING`. Monitoring detects it. Admin resolves manually. Never re-call BC.

---

## Exact Order of Operations (Critical — Follow Precisely)

### For a single claim

**Step 1 — Finance approver clicks Approve on a Reimbursement claim.**

- Do NOT change any DB state. Show the BC payment modal.

**Step 2 — Finance approver fills the modal and clicks Confirm.**

- Client calls `bc-payment` Edge Function with: `{ claim_id, is_vendor_payment, bc_vendor_id (if vendor), bc_vendor_name (if vendor) }`.

**Step 3 — Edge Function: validate.**

- Call `get_bc_claim_payload(claim_id)` DB function.
- If `bc_payments_flag = true`: return error "This claim has already been sent to Business Central." Do NOT proceed.
- If `payment_mode_name != 'Reimbursement'`: return error. Do NOT proceed.
- If any mapping is missing: return error naming the missing mapping. Do NOT proceed.
- If `is_vendor_payment = true` but no vendor selected: return error. Do NOT proceed.
- If `is_vendor_payment = false` and `bc_code` is NULL: return error "Expense category has no BC account code configured."

**Step 4 — Edge Function: write PENDING audit log.**

- Insert into `bc_payment_audit_log`: `{ claim_id, status: 'PENDING', payload_json: <the BC payload that will be sent> }`.
- Capture the returned `audit_log_id`.
- If this INSERT fails: return error to client. Do NOT call BC API.

**Step 5 — Edge Function: call BC Payments API.**

- Build the BC payload (see Field Mapping section).
- POST to BC endpoint.
- If BC returns error (any non-2xx): update audit log to `FAILED` with error details. Return error to client. Do NOT update claims state. Done.

**Step 6 — Edge Function: atomic DB update on BC success.**

- Call `complete_bc_payment(...)` DB function.
- If this DB function fails: audit log remains `PENDING` (never got to `SUCCESS`). Return error: "Payment sent to Business Central, but our records could not be updated. Please contact the admin immediately with Claim ID [claim_id]." Do NOT retry the BC call.

**Step 7 — Return success to client.**

- Client closes modal, refreshes claim view to show new status.

### For bulk approval (multiple claims)

Same Edge Function (`bc-payment`) called with an array of claim_ids.

Process each claim **sequentially** (one at a time, not in parallel). Reasons:

1. Avoids BC API rate limits.
2. Failure of one claim doesn't affect others.
3. Easier audit trail.

For each claim in the sequence:

- Re-check `bc_payments_flag` before calling BC (another call in the batch might have already processed this claim).
- If `bc_payments_flag = true`: skip, add to "already sent" list.
- Otherwise: follow Steps 3-6 above.
- If a claim fails: log it, continue to the next claim. Do NOT abort the entire batch.

After all claims are processed, return a batch result:

```json
{
  "succeeded": ["CLAIM-ID-1", "CLAIM-ID-3"],
  "failed": [{ "claim_id": "CLAIM-ID-2", "reason": "Expense category has no BC account code" }],
  "skipped": ["CLAIM-ID-4"]
}
```

The frontend shows this summary in the modal.

---

## UI Flow

### Single Claim Approval Modal

When finance approver clicks Approve on a Reimbursement claim, show a modal (use `frontend-design` plugin to match app styling):

**Title**: "Send to Business Central"

**Body**:

- Payment Type (radio, required, nothing pre-selected):
  - `Non-Vendor Payment`
  - `Vendor Payment`
- If `Vendor Payment` is selected: show a vendor search input below the radio buttons.
  - Calls `bc-vendor-search` Edge Function on input, debounced 300ms.
  - Shows results as dropdown: `{Vendor Name} ({Vendor ID})`.
  - User must select one result. Typing without selecting does not count.

**Footer**:

- `Cancel`: close modal, no DB changes.
- `Confirm`: disabled until payment type is selected AND (if Vendor Payment) a vendor has been selected. When clicked, call `bc-payment` Edge Function. Show a loading state on the button while waiting.

**Error display**: if the Edge Function returns an error, show it inline in the modal (below the form, above the footer). Keep the modal open — let the user retry or cancel.

### Bulk Approval Modal

When finance approver selects multiple claims (mix of payment modes) and clicks Approve:

- Show a notice: "X of Y selected claims are Reimbursement claims and will be sent to Business Central. The remaining Y-X claims will use the standard approval flow."
- Same payment type radio + vendor search as single approval.
- One choice applies to all Reimbursement claims in the selection.
- Show a progress indicator while processing (e.g., "Processing 3 of 10...").
- After completion, show the batch result summary (succeeded / failed / skipped).

---

## BC Line Item Generation

Each claim produces either 1 or 2 lines sent to BC.

**Non-Vendor Payment** → 1 line: Employee line.
**Vendor Payment** → 2 lines: Employee line + Vendor line.

The 2 lines for vendor payment are sent together in a single API call (as an array in the request body, or as two separate POST calls — check the Postman collection's request body format to determine if BC accepts a single object or an array).

### Non-Vendor Example

**Claim data:**

- Claim ID: `CLAIM-NW0002053-20260424-462F`
- Employee ID: `NW0002053`
- Product: "Common" → Program Code: `COMMON`, Sub Product Code: `COMMON`
- Department: "GenAI Social Media" → Dept Code: `GENAI SOCIAL MEDIA`
- Expense: Food, approved_amount: `573.00`, location: Hyderabad → `TELUGU`, bc_code: `503063`
- Purpose: `"Food bill for Production team - Video shoot"`
- Receipt path: `https://storage.example.com/receipts/abc.jpg`
- Bank statement path: `https://storage.example.com/bank/def.pdf`
- Approval date: 27-Apr-26

**1 line sent:**

```
Field                   | Value
------------------------|--------------------------------------------------
postingDate             | "2026-04-27"  (ISO YYYY-MM-DD)
accountType             | "Employee"
accountNo               | "NW0002053"
employeeTransactionType | "ADVANCE"
amount                  | -573.00  (negative — Employee line always negative)
description             | "CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot\nbill - https://storage.example.com/receipts/abc.jpg\nbank statement - https://storage.example.com/bank/def.pdf"
balAccountType          | "G/L Account"
balAccountNo            | "503063"  (bc_code from expense_category_bc_mappings)
claimNo                 | "CLAIM-NW0002053-20260424-462F"
nwProgramCode           | "COMMON"
subProductCode          | "COMMON"
responsibleDepartment   | "GENAI SOCIAL MEDIA"
beneficiaryDepartment   | "GENAI SOCIAL MEDIA"  (from beneficiary_department_code column — same value as responsibleDepartment for most departments)
regionCode              | "TELUGU"
```

Fields NOT sent: `documentNo`, `claimAmount`, `approvedAmount`, `remarks`, `nwProductCode`.

---

### Vendor Payment Example

**Same claim as above**, finance approver chose Vendor Payment with vendor `VEN/0008992` / `ABC Software Pvt Ltd`.

**2 lines sent:**

Employee line (POST call 1):

```
Field                   | Value
------------------------|--------------------------------------------------
postingDate             | "2026-04-27"  (ISO YYYY-MM-DD)
accountType             | "Employee"
accountNo               | "NW0002053"
employeeTransactionType | "ADVANCE"
amount                  | -573.00  (negative)
description             | "CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot\nbill - https://storage.example.com/receipts/abc.jpg\nbank statement - https://storage.example.com/bank/def.pdf"
balAccountType          | "G/L Account"
balAccountNo            | ""  (EMPTY — always empty for vendor payment, even on Employee line)
claimNo                 | "CLAIM-NW0002053-20260424-462F"
nwProgramCode           | "COMMON"
subProductCode          | "COMMON"
responsibleDepartment   | "GENAI SOCIAL MEDIA"
beneficiaryDepartment   | "GENAI SOCIAL MEDIA"
regionCode              | "TELUGU"
```

Vendor line (POST call 2):

```
Field                   | Value
------------------------|--------------------------------------------------
postingDate             | "2026-04-27"
accountType             | "Vendor"
accountNo               | "VEN/0008992"
employeeTransactionType | ""  (empty string)
amount                  | 573.00  (positive — same magnitude, opposite sign to Employee line)
description             | "CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot\nbill - https://storage.example.com/receipts/abc.jpg\nbank statement - https://storage.example.com/bank/def.pdf"
balAccountType          | "G/L Account"
balAccountNo            | ""  (EMPTY — always empty on Vendor line)
claimNo                 | "CLAIM-NW0002053-20260424-462F"
nwProgramCode           | "COMMON"
subProductCode          | "COMMON"
responsibleDepartment   | "GENAI SOCIAL MEDIA"
beneficiaryDepartment   | "GENAI SOCIAL MEDIA"
regionCode              | "TELUGU"
```

**Summary of Bal. Account No. rules:**

- Non-vendor payment (1 line): Employee line gets `bc_code` from `expense_category_bc_mappings`.
- Vendor payment (2 lines): BOTH Employee line and Vendor line get empty string `""`.

---

## Field Mapping (Complete Lookup Logic)

### postingDate

Server-side `NOW()` at the moment of the Edge Function execution. Format: `YYYY-MM-DD` (ISO 8601). Example: `2026-04-27`. Confirmed from Postman — BC expects ISO date, not `DD-MMM-YY`.

### documentNo

**Do not send this field.** Omit it from the payload entirely. BC auto-generates it.

### accountType

- Employee line: hardcoded `"Employee"` (matches `bc_account_type` enum).
- Vendor line: hardcoded `"Vendor"` (matches `bc_account_type` enum).

### accountNo

- Employee line: `claims.employee_id`. Example: `"NW0002053"`.
- Vendor line: the vendor ID from BC Vendor API search, stored as `bc_claim_vendors.bc_vendor_id`. Example: `"VEN/0008992"`.

### employeeTransactionType

- Employee line: `"ADVANCE"` (matches `bc_employee_transaction_type` enum).
- Vendor line: `""` (empty string).

### amount

API payload key: **`amount`**. Source column: **`expense_details.approved_amount`** (direct column on the `expense_details` table).

- Employee line: send as **negative**. `amount = -(expense_details.approved_amount)`. Example: if `approved_amount = 573.00`, send `"amount": -573.00`.
- Vendor line: send as **positive**. `amount = expense_details.approved_amount`. Example: `"amount": 573.00`.

### claimAmount

**Do not send.** Not present in the active Postman payload. Omit entirely.

### description

API field name: **`description`** (confirmed from updated Postman — NOT `remarks`).

Three lines joined by `\n`:

```
Line 1 (always):           {claims.id} - {expense_details.purpose}
Line 2 (if not null/empty): bill - {expense_details.receipt_file_path}
Line 3 (if not null/empty): bank statement - {expense_details.bank_statement_file_path}
```

Example (all three lines):

```
CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot\nbill - https://storage.example.com/receipts/abc.jpg\nbank statement - https://storage.example.com/bank/def.pdf
```

Example (no files — only line 1):

```
CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot
```

`description` is **identical** on both the Employee and Vendor lines for the same claim.

### balAccountType

Always `"G/L Account"` (matches `bc_bal_account_type` enum). On every line, every time.

### balAccountNo

- Non-vendor payment, Employee line: look up `expense_category_bc_mappings.bc_code` using `expense_details.expense_category_id`.
  - Query: `SELECT bc_code FROM expense_category_bc_mappings WHERE expense_category_id = {expense_details.expense_category_id} AND is_active = true LIMIT 1`
  - Known examples: Food → `503063`, Travel Domestic → `535001`, Accommodation Domestic → `535004`, Local Subscription → `533501`, Team outing → `503067`, Miscellaneous → `536007`.
  - If `bc_code` is NULL: abort with error before calling BC.
- Vendor payment, Employee line: always `""` (empty string).
- Vendor payment, Vendor line: always `""` (empty string).

### claimNo

`claims.id`. Example: `"CLAIM-NW0002053-20260424-462F"`. Same on both lines.

### nwProgramCode

Lookup via `expense_details.product_id`:

```sql
SELECT program_code FROM master_program_product_mappings
WHERE product_id = {expense_details.product_id} AND is_active = true LIMIT 1
```

Known examples: product "Common" → `COMMON`, product "NIAT Batch 2025/2026" → `NIAT`, product "Academy Online" → `CCBP 4.0 ACADEMY`, product "Intensive Online" → `INTENSIVE 3.0`.
If missing: abort with error. Same on both lines.

### subProductCode

Lookup via `expense_details.product_id`:

```sql
SELECT sub_product_code FROM master_sub_product_mappings
WHERE product_id = {expense_details.product_id} AND is_active = true LIMIT 1
```

Known examples: product "Common" → `COMMON`, product "NIAT Batch 2025/2026" → `NIAT362`, product "Academy Online" → `AO107`.
If missing: abort with error. Same on both lines.

### responsibleDepartment and beneficiaryDepartment

Both BC fields are sourced from `master_department_responsible_mappings` using `claims.department_id`. The table has **TWO separate columns** — look up both in a single query:

```sql
SELECT responsible_department_code, beneficiary_department_code
FROM master_department_responsible_mappings
WHERE department_id = {claims.department_id}
  AND is_active = true
LIMIT 1
```

`responsibleDepartment` ← `responsible_department_code`
`beneficiaryDepartment` ← `beneficiary_department_code`

For most departments these two values are **identical** (the backfill set them equal). The known exception:

- Department "Human Resource" / "Travel & Stay (Sales)":
  - `responsible_department_code` = `HR-OPR PAYROLL`
  - `beneficiary_department_code` = `HR-OPR & PAYROLL` ← **different, includes `&`**

Known examples:

- Department "Technology" → responsible: `TECHNOLOGY`, beneficiary: `TECHNOLOGY`
- Department "GenAI Social Media" → responsible: `GENAI SOCIAL MEDIA`, beneficiary: `GENAI SOCIAL MEDIA`
- Department "Finance" → responsible: `FIN-OPR ANALYSIS`, beneficiary: `FIN-OPR ANALYSIS`
- Department "NIAT - Academics" → responsible: `NIAT - TUTORS`, beneficiary: `NIAT - TUTORS`
- Department "Human Resource" → responsible: `HR-OPR PAYROLL`, beneficiary: `HR-OPR & PAYROLL`

If no row found for the claim's `department_id`: abort with error naming the department. Same on both Employee and Vendor lines.

### regionCode

Lookup via `expense_details.location_id`:

```sql
SELECT region_code FROM master_expense_location_mappings
WHERE location_id = {expense_details.location_id} AND is_active = true LIMIT 1
```

Known examples: Hyderabad locations → `TELUGU`, Bangalore locations → `KANNADA`, Chennai locations → `TAMIL`, Delhi locations → `HINDI`.
If missing: abort with error. Same on both lines.

---

## BC APIs

### Authentication (OAuth2 Client Credentials)

Both the Payments API and the Vendor API use the same OAuth2 app credentials.

**Token endpoint** — make a **POST** request (the Postman collection shows GET with body-pruning disabled, which is non-standard; use POST as per OAuth2 spec):

```
POST https://login.microsoftonline.com/6ae3d026-e965-483e-8309-8f8f3aca71c8/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
scope=https://api.businesscentral.dynamics.com/.default
client_id={BC_CLIENT_ID}
client_secret={BC_CLIENT_SECRET}
```

**Environment variables** — store all as Supabase secrets, never hardcode:

```
BC_TENANT_ID       = 6ae3d026-e965-483e-8309-8f8f3aca71c8
BC_CLIENT_ID       = a5170024-af89-4142-b29b-65562f395b6f
BC_CLIENT_SECRET   = <redacted — store in Supabase secrets, never commit>
BC_ENVIRONMENT     = Sandbox_05052026  (change to production value when going live)
BC_COMPANY_ID      = 2a9bf2ba-5cfe-ef11-9346-6045bdac6fc7  (GUID, used in Payments API)
BC_COMPANY_NAME    = NxtWave  (string name, used in Vendor API)
```

**Token caching**: Cache the token in Edge Function memory for its `expires_in` duration (typically 3600 seconds). Do not fetch a new token for every API call. On expiry, fetch a fresh one.

---

### BC Payments API

> **Source**: `postman/sandbox/bc-claims-api.postman_collection.json`. Production collection will be at `postman/production/bc-claims-api.postman_collection.json` when available.

**Endpoint**:

```
POST https://api.businesscentral.dynamics.com/v2.0/{BC_ENVIRONMENT}/api/Alletec/Claim/v1.0/companies({BC_COMPANY_ID})/Claims
Authorization: Bearer {access_token}
Content-Type: application/json
```

Expanding with env values (sandbox):

```
POST https://api.businesscentral.dynamics.com/v2.0/Sandbox_05052026/api/Alletec/Claim/v1.0/companies(2a9bf2ba-5cfe-ef11-9346-6045bdac6fc7)/Claims
```

**Request body** (single JSON object per line item, camelCase keys — confirmed from `postman/sandbox/bc-claims-api.postman_collection.json`):

```json
{
  "postingDate": "2026-04-27",
  "accountType": "Employee",
  "accountNo": "NW0002053",
  "employeeTransactionType": "ADVANCE",
  "amount": -573.0, // -(expense_details.approved_amount)
  "description": "CLAIM-NW0002053-20260424-462F - Food bill\nbill - https://...\nbank statement - https://...",
  "balAccountType": "G/L Account",
  "balAccountNo": "503063",
  "claimNo": "CLAIM-NW0002053-20260424-462F",
  "nwProgramCode": "COMMON",
  "subProductCode": "COMMON",
  "responsibleDepartment": "GENAI SOCIAL MEDIA",
  "beneficiaryDepartment": "GENAI SOCIAL MEDIA",
  "regionCode": "SOUTH"
}
```

Fields **never sent**: `documentNo`, `claimAmount`, `approvedAmount`, `remarks`, `nwProductCode`, `previousClaimNo`. Omit them from the payload entirely.

**`postingDate` format**: `YYYY-MM-DD` (ISO 8601 date, e.g., `"2026-04-27"`).

**Vendor payment — 2 separate POST calls**: The BC Payments API appears to accept one line item per request body (single object, not an array). For vendor payment, make **2 sequential POST calls** to the same endpoint — first the Employee line, then the Vendor line. Both calls use the same Bearer token. If the first call succeeds and the second fails, treat the whole claim as failed, log both BC responses in the audit log, and show error to the user. (The implementing AI must confirm this 2-call behaviour against the actual Postman file when it's available.)

---

### BC Vendor Search API

**Endpoint** (confirmed from `postman/sandbox/bc-vendor-api.postman_collection.json`):

```
GET https://api.businesscentral.dynamics.com/v2.0/{BC_TENANT_ID}/{BC_ENVIRONMENT}/ODataV4/Company('{BC_COMPANY_NAME}')/vendors
Authorization: Bearer {access_token}
```

Expanding with env values (sandbox):

```
GET https://api.businesscentral.dynamics.com/v2.0/6ae3d026-e965-483e-8309-8f8f3aca71c8/Sandbox_05052026/ODataV4/Company('NxtWave')/vendors
```

**Vendor search filter**: The Postman collection fetches all vendors with no filter. For the autocomplete search, append an OData `$filter` query parameter:

```
?$filter=contains(No,'${searchTerm}') or contains(Name,'${searchTerm}')&$top=20
```

Example for search term `"ABC"`:

```
GET .../vendors?$filter=contains(No,'ABC') or contains(Name,'ABC')&$top=20
```

**Response**: OData JSON. Each vendor in the `value` array has at minimum:

- `No` → vendor ID (e.g., `"VEN/0008992"`). Use as `accountNo` on the Vendor line and store as `bc_claim_vendors.bc_vendor_id`.
- `Name` → vendor display name (e.g., `"ABC Software Pvt Ltd"`). Store as `bc_claim_vendors.bc_vendor_name`.

Show in dropdown as: `{Name} ({No})`. Example: `ABC Software Pvt Ltd (VEN/0008992)`.

**Important**: The Vendor API URL structure is different from the Payments API URL — it uses `{BC_TENANT_ID}` in the path and `ODataV4/Company('{BC_COMPANY_NAME}')`, not the custom Alletec API path. Use the correct URL for each.

---

## Edge Cases & Data Integrity Scenarios

### Case 1: Finance approver clicks Confirm — network drops before Edge Function responds

Frontend doesn't know if anything happened. When the approver re-opens the claim, the frontend should check `bc_payments_flag`. If `true`, show "Already sent to Business Central" and disable re-send. If `false`, allow retry.
**Guard in Edge Function**: always check `bc_payments_flag = false` at Step 3 before doing anything. This makes the operation safe to retry.

### Case 2: Edge Function crashes after writing PENDING audit log but before BC call

PENDING audit log exists. BC was never called. BC data is clean. `bc_payments_flag = false` on the claim. The approver can retry safely (Step 3 checks `bc_payments_flag`).
The new retry will write a new PENDING audit log row (old one stays as PENDING — monitoring will flag it, but no data was sent to BC so it's safe to investigate later).

### Case 3: BC API call succeeds, then `complete_bc_payment` DB function fails

This is the highest-severity scenario. Data is in BC but not in our DB.

- Audit log remains `PENDING` (never reached `SUCCESS`).
- `bc_payments_flag` remains `false` on the claim.
- Monitoring query `SELECT * FROM bc_payment_audit_log WHERE status = 'PENDING' AND created_at < now() - interval '5 minutes'` detects this.
- Admin must manually: call `complete_bc_payment(...)` or set `bc_payments_flag = true` + insert `bc_claim_vendors` row + update audit log.
- Show the user a specific message: "Payment was sent to Business Central but our records could not be updated. Please contact admin with Claim ID [X]." Do NOT retry the BC call.

### Case 4: Duplicate send — bulk approval processes a claim, then single approval also processes it

The `bc_payments_flag` check at Step 3 prevents this. The second attempt sees `bc_payments_flag = true` and returns "Already sent to Business Central" without calling BC.

### Case 5: Bulk approval — 10 claims, claim 5 fails midway

Claims 1-4: processed, DB updated, `bc_payments_flag = true`.
Claim 5: BC call fails. Audit log set to `FAILED`. Claim 5 state unchanged. Error logged.
Claims 6-10: continue processing independently.
Final summary shows which claims succeeded, which failed.

### Case 6: Vendor payment — bc_code is NULL for the expense category

Pre-flight validation catches this BEFORE writing the audit log. For vendor payment, `balAccountNo` is always empty, so bc_code being NULL is irrelevant — but the pre-flight still runs to confirm all other mappings are present.
Actually for vendor payment: skip the bc_code null check since balAccountNo is empty for both lines. Only block on null bc_code for **non-vendor payment**.

### Case 7: Vendor search returns no results

`bc-vendor-search` returns an empty array. Show "No vendors found" in dropdown. Confirm button stays disabled. User must search again or switch to Non-Vendor Payment.

### Case 8: A mapping table (program/sub-product/dept/region) has no row for this claim's data

`get_bc_claim_payload` DB function returns an error. Pre-flight validation at Step 3 catches it. Error shown to approver: "NW Program Code not found for product '[product name]'. Contact admin to add the mapping." BC is never called.

### Case 9: BC API returns 401 (token expired)

Edge Function's token cache has an expired token. Fetch a new token and retry the BC call once. If the retry also fails, return the error to the client.

### Case 10: claim was previously rejected and re-submitted — can it be sent to BC again?

If `bc_payments_flag = true` on the current claim record: no, block it. The flag was set from a prior successful send. This should not happen in normal flow (the claim would have a different status), but the guard prevents accidental double-sending.

---

## Coding Standards & Best Practices

These apply to every file created for this feature. No exceptions.

### TypeScript — No `any`, Strict Types Throughout

Define explicit types for every data structure. Never use `any`. Use `unknown` at system boundaries and narrow with type guards.

**BC payload type** — define once, use everywhere:

```typescript
interface BcClaimLineItem {
  postingDate: string; // ISO YYYY-MM-DD
  accountType: BcAccountType; // enum
  accountNo: string;
  employeeTransactionType: BcEmployeeTransactionType | "";
  amount: number;
  description: string;
  balAccountType: BcBalAccountType; // enum
  balAccountNo: string;
  claimNo: string;
  nwProgramCode: string;
  subProductCode: string;
  responsibleDepartment: string;
  beneficiaryDepartment: string;
  regionCode: string;
}
```

**Enums** — define in a shared constants file, not inline:

```typescript
enum BcAccountType {
  Employee = "Employee",
  Vendor = "Vendor",
}

enum BcEmployeeTransactionType {
  Advance = "ADVANCE",
}

enum BcBalAccountType {
  GLAccount = "G/L Account",
}

enum BcPaymentStatus {
  Pending = "PENDING",
  Success = "SUCCESS",
  Failed = "FAILED",
}
```

**Error types** — define a typed error class or union instead of throwing raw `Error`:

```typescript
type BcPaymentError =
  | { code: "ALREADY_SENT"; claimId: string }
  | { code: "NOT_REIMBURSEMENT"; claimId: string }
  | { code: "MISSING_MAPPING"; field: string; value: string }
  | { code: "BC_API_ERROR"; status: number; body: unknown }
  | { code: "DB_UPDATE_FAILED"; claimId: string; bcResponse: unknown };
```

**Edge Function input** — validate with Zod at the boundary before touching any internal logic:

```typescript
const BcPaymentInput = z.object({
  claimId: z.string().min(1),
  isVendorPayment: z.boolean(),
  bcVendorId: z.string().optional(),
  bcVendorName: z.string().optional(),
});
type BcPaymentInput = z.infer<typeof BcPaymentInput>;
```

### Modularity — One Responsibility Per File

Split the implementation into these files (adapt paths to match existing project structure):

```
supabase/functions/bc-payment/
  index.ts              — entry point, validates input, orchestrates steps
  bcApiClient.ts        — BC OAuth2 token fetch + caching + HTTP calls
  payloadBuilder.ts     — builds BcClaimLineItem[] from DB payload data
  types.ts              — all interfaces, enums, error types for this feature

supabase/functions/bc-vendor-search/
  index.ts              — entry point, calls BC Vendor API, returns filtered results
  bcApiClient.ts        — can be shared or re-exported from a shared module

supabase/migrations/
  YYYYMMDD_bc_payment_integration.sql  — all DB changes: enums, columns, tables, functions
```

### Reusability

- **BC auth client**: write once in `bcApiClient.ts`. Both `bc-payment` and `bc-vendor-search` import from it. It owns token acquisition and caching. No other file touches the token.
- **`get_bc_claim_payload` DB function**: called by `bc-payment` only. Returns all data needed for one claim in a single round-trip. No other code fetches individual mappings one by one.
- **`complete_bc_payment` DB function**: the only place that updates `claims`, `bc_claim_vendors`, and `bc_payment_audit_log` together. Never update these tables in application code outside this function.
- **`payloadBuilder.ts`**: pure function — takes the DB payload object, returns `BcClaimLineItem[]`. No DB access, no API calls. Fully unit-testable in isolation.

### No Magic Strings

Every hardcoded BC field value (`"ADVANCE"`, `"G/L Account"`, `"Employee"`, `"Vendor"`, `"PENDING"`, etc.) must come from an enum or a constant. No raw string literals in logic code.

### No In-Memory Operations on DB Data

Do not fetch all vendors, all mappings, or all claims into memory and filter in code. All filtering happens at the DB layer (SQL `WHERE` clauses, OData `$filter`). The `$top=20` limit on vendor search prevents unbounded responses.

### No Partial State Writes

Never write to `claims`, `bc_claim_vendors`, or `bc_payment_audit_log` (status updates) from multiple places. All writes go through `complete_bc_payment` DB function. The audit log `PENDING` insert is the only write that happens outside this function, and it happens before the BC call.

### Environment Variables

All BC credentials and URLs are environment variables stored as Supabase secrets. The Edge Function reads them via `Deno.env.get('BC_CLIENT_SECRET')` etc. Any missing env var at startup should cause the function to return a 500 immediately with a clear message — never fail silently mid-request.

### Null Safety

Every mapping lookup can return null (missing row in mapping table). Handle null explicitly — never assume a mapping exists. The `get_bc_claim_payload` DB function should return a typed error if any lookup returns null, not a partial result.

---

## Out of Scope

- Claims with `payment_mode != 'Reimbursement'` — completely excluded.
- `documentNo` — never sent, never stored.
- `claimAmount`, `approvedAmount`, `remarks`, `nwProductCode`, `previousClaimNo` — never sent (confirmed from Postman).
- The claim flow for any status other than the Finance Approval transition.
- Any UI changes outside the approval modal and claim status display.
- Modifying the existing approval flow for non-Reimbursement claims.

---

## Implementation Notes

- If you have any doubt about a requirement in this spec, **ask before implementing**. Do not assume.
- **All SQL queries in this document are reference examples only.** They show the intended lookup logic and table relationships, not production-ready queries. During implementation: validate the actual column names and table structures against the live migrations, use the project's existing query pattern (Supabase client, DB function, or ORM), and choose the best approach for each lookup. Never copy-paste these queries blindly into production code without verifying against the current schema.
- Similarly, the TypeScript types, enums, and Zod schemas in the Coding Standards section are starting-point examples. Adapt them to match the project's existing conventions and file structure.
- Read `postman/sandbox/bc-claims-api.postman_collection.json` and `postman/sandbox/bc-vendor-api.postman_collection.json` before writing any API client code. They are the authoritative source for request format, URL structure, and auth flow. When the production collection arrives, it will be at `postman/production/` with the same file names — update `BC_ENVIRONMENT` and `BC_COMPANY_ID` env vars accordingly, no code changes needed.
