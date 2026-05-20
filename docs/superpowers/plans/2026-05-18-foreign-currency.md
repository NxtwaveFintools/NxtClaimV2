# Foreign Currency Expense Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire four existing DB columns (`foreign_currency_code`, `foreign_basic_amount`, `foreign_gst_amount`, `foreign_total_amount`) through domain contracts, Zod schemas, UI forms, the details view, the AI parser, and the repository.

**Architecture:** All foreign fields are optional additions alongside existing local INR fields — they never replace or touch `currency_code`/`basic_amount`/`total_amount`. The foreign total is computed client-side and stored server-side but never user-editable. The AI parser routes amounts to local vs foreign fields based on a `documentType` flag passed from the UI.

**Tech Stack:** TypeScript, Next.js 15 (App Router, Server Actions), React Hook Form + Zod, Supabase (PostgREST + RPCs), Google Gemini AI via `@google/generative-ai`.

---

## File Map

| File                                                         | Change                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `src/core/domain/claims/contracts.ts`                        | Add 4 optional foreign fields to 4 payload types                                        |
| `src/modules/claims/validators/new-claim-schema.ts`          | Add foreign fields + cross-field validation to `expenseDetailSchema`                    |
| `src/modules/claims/validators/finance-edit-schema.ts`       | Add foreign fields + cross-field validation to `financeExpenseEditSchema`               |
| `src/modules/claims/validators/own-edit-schema.ts`           | Add foreign fields + cross-field validation to `ownExpenseEditSchema`                   |
| `src/modules/claims/ui/claim-full-details-grid.tsx`          | Extend `ClaimExpenseDetail` type; add conditional foreign section                       |
| `src/modules/claims/actions/parse-receipt.ts`                | Add `documentType` routing, extend schema + result type, update prompts                 |
| `src/modules/claims/ui/new-claim-form-client.tsx`            | Extend `ClaimFormDraftValues`, add useWatch+useEffect, add UI section, wire AI autofill |
| `src/modules/claims/ui/finance-edit-claim-form.tsx`          | Add `ForeignAmountState`, state management, hidden inputs, UI section                   |
| `src/modules/claims/actions.ts`                              | Extract 4 new fields in `extractSubmissionInput` and `buildFinanceEditPayload`          |
| `src/modules/claims/repositories/SupabaseClaimRepository.ts` | Add 4 snake_case columns to `createExpenseDetailDraft` insert                           |

---

## Task 1: Update Domain Contracts

**Files:**

- Modify: `src/core/domain/claims/contracts.ts`

- [ ] **Step 1: Add the 4 foreign fields to the 4 payload types**

Open `src/core/domain/claims/contracts.ts`.

In `ClaimSubmissionInput.expense` (around line 47), add after `currencyCode: string`:

```ts
foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

In `PreparedClaimSubmission.expense` (around line 101), add after `currencyCode: string`:

```ts
foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

In `FinanceExpenseEditPayload` (around line 141), add after `totalAmount: number`:

```ts
foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

In `OwnExpenseEditPayload` (around line 184), add after `totalAmount: number`:

```ts
foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
cd D:\nxtclaim; npx tsc --noEmit
```

Expected: No new errors (may have pre-existing ones in other tasks — that's fine for now).

- [ ] **Step 3: Commit**

```powershell
cd D:\nxtclaim
git add src/core/domain/claims/contracts.ts
git commit -m "feat(contracts): add foreign currency fields to expense payload types"
```

---

## Task 2: Update Zod Schemas

**Files:**

- Modify: `src/modules/claims/validators/new-claim-schema.ts`
- Modify: `src/modules/claims/validators/finance-edit-schema.ts`
- Modify: `src/modules/claims/validators/own-edit-schema.ts`

### 2a — `new-claim-schema.ts`

- [ ] **Step 1: Add foreign fields inside `expenseDetailSchema.expense` object**

In `src/modules/claims/validators/new-claim-schema.ts`, the `expenseDetailSchema` has a nested `.object({ ... })` for the `expense` key. Add these four fields inside that object, after the existing `currencyCode` field (around line 89):

```ts
foreignCurrencyCode: z.enum(["INR", "USD", "EUR", "CHF"]).default("INR"),
foreignBasicAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
foreignGstAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
foreignTotalAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
```

- [ ] **Step 2: Add cross-field validation in `superRefine`**

In the same file, inside the `.superRefine((value, context) => { ... })` at the bottom, add this block **before** the `if (value.detailType === "advance")` check:

```ts
if (
  value.detailType === "expense" &&
  value.expense?.foreignCurrencyCode !== "INR" &&
  value.expense?.foreignCurrencyCode != null
) {
  if (!value.expense.foreignBasicAmount || value.expense.foreignBasicAmount <= 0) {
    context.addIssue({
      code: "custom",
      message: "Foreign basic amount is required for non-INR currencies.",
      path: ["expense", "foreignBasicAmount"],
    });
  }
}
```

### 2b — `finance-edit-schema.ts`

- [ ] **Step 3: Add foreign fields to `financeExpenseEditSchema`**

In `src/modules/claims/validators/finance-edit-schema.ts`, the `financeExpenseEditSchema` is a flat `.object({ ... }).superRefine(...).strict()`. Add these fields **inside** the `.object({ ... })`, after `totalAmount` (around line 53) and **before** the closing `})` of the object — note the schema uses `.strict()` so every field must be declared:

```ts
foreignCurrencyCode: z.enum(["INR", "USD", "EUR", "CHF"]).default("INR"),
foreignBasicAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
foreignGstAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
foreignTotalAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
```

- [ ] **Step 4: Add cross-field validation to `financeExpenseEditSchema`**

The schema already has `.superRefine((value, context) => { ... })`. Add this block inside it:

```ts
if (value.foreignCurrencyCode !== "INR" && value.foreignCurrencyCode != null) {
  if (!value.foreignBasicAmount || value.foreignBasicAmount <= 0) {
    context.addIssue({
      code: "custom",
      message: "Foreign basic amount is required for non-INR currencies.",
      path: ["foreignBasicAmount"],
    });
  }
}
```

### 2c — `own-edit-schema.ts`

- [ ] **Step 5: Add foreign fields to `ownExpenseEditSchema`**

In `src/modules/claims/validators/own-edit-schema.ts`, the `ownExpenseEditSchema` is a flat `.object({ ... }).strict()`. Add these fields **inside** the `.object({ ... })`, after `remarks` (around line 82) and **before** the `receiptFile` field — the schema uses `.strict()` so every field must be declared:

```ts
foreignCurrencyCode: z.enum(["INR", "USD", "EUR", "CHF"]).default("INR"),
foreignBasicAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
foreignGstAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
foreignTotalAmount: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().min(0).nullable().optional(),
),
```

Note: `ownExpenseEditSchema` has no `.superRefine()` — add it by chaining `.superRefine()` **before** the `.strict()` call, changing:

```ts
export const ownExpenseEditSchema = z
  .object({ ... })
  .strict();
```

to:

```ts
export const ownExpenseEditSchema = z
  .object({ ... })
  .superRefine((value, context) => {
    if (value.foreignCurrencyCode !== "INR" && value.foreignCurrencyCode != null) {
      if (!value.foreignBasicAmount || value.foreignBasicAmount <= 0) {
        context.addIssue({
          code: "custom",
          message: "Foreign basic amount is required for non-INR currencies.",
          path: ["foreignBasicAmount"],
        });
      }
    }
  })
  .strict();
```

- [ ] **Step 6: Verify TypeScript compiles**

```powershell
cd D:\nxtclaim; npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```powershell
cd D:\nxtclaim
git add src/modules/claims/validators/new-claim-schema.ts src/modules/claims/validators/finance-edit-schema.ts src/modules/claims/validators/own-edit-schema.ts
git commit -m "feat(validators): add foreign currency fields to expense schemas"
```

---

## Task 3: Update Claim Details View

**Files:**

- Modify: `src/modules/claims/ui/claim-full-details-grid.tsx`

- [ ] **Step 1: Extend `ClaimExpenseDetail` type**

In `src/modules/claims/ui/claim-full-details-grid.tsx`, find the `type ClaimExpenseDetail` (around line 8). Add four fields after `aiMetadata`:

```ts
foreignCurrencyCode?: string | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

- [ ] **Step 2: Add a foreign currency formatter helper**

After the existing `indiaAmountFormatter` and `formatAmount` (around line 64–77), add:

```ts
function formatForeignAmount(amount: number | null, currencyCode: string): string {
  if (amount === null) return "N/A";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}
```

- [ ] **Step 3: Add the Foreign Expense Details section to the JSX**

In the `ClaimFullDetailsGrid` component, inside the `{includeExpenseDetail && claim.expense ? ( ... ) : null}` block, after the closing `</section>` tag of "Expense Detail", add a new section:

```tsx
{
  claim.expense.foreignCurrencyCode !== null &&
  claim.expense.foreignCurrencyCode !== "INR" &&
  !isQuickViewMode ? (
    <section className={detailSectionClassName}>
      <h2 className={detailHeadingClassName}>Foreign Expense Details</h2>
      <div className={detailGridClassName}>
        <div className={detailCardClassName}>
          <p className={fieldLabelClassName}>Currency</p>
          <p className={fieldValueClassName}>{claim.expense.foreignCurrencyCode}</p>
        </div>
        <div className={detailCardClassName}>
          <p className={fieldLabelClassName}>Foreign Basic Amount</p>
          <p className={fieldValueClassName}>
            {formatForeignAmount(
              claim.expense.foreignBasicAmount ?? null,
              claim.expense.foreignCurrencyCode,
            )}
          </p>
        </div>
        <div className={detailCardClassName}>
          <p className={fieldLabelClassName}>Foreign GST Amount</p>
          <p className={fieldValueClassName}>
            {formatForeignAmount(
              claim.expense.foreignGstAmount ?? null,
              claim.expense.foreignCurrencyCode,
            )}
          </p>
        </div>
        <div className={detailCardClassName}>
          <p className={fieldLabelClassName}>Foreign Total Amount</p>
          <p className={emphasizedValueClassName}>
            {formatForeignAmount(
              claim.expense.foreignTotalAmount ?? null,
              claim.expense.foreignCurrencyCode,
            )}
          </p>
        </div>
      </div>
    </section>
  ) : null;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```powershell
cd D:\nxtclaim; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```powershell
cd D:\nxtclaim
git add src/modules/claims/ui/claim-full-details-grid.tsx
git commit -m "feat(details): render foreign expense section when non-INR currency present"
```

---

## Task 4: Upgrade AI Parser

**Files:**

- Modify: `src/modules/claims/actions/parse-receipt.ts`

- [ ] **Step 1: Extend the Zod schema and result types**

In `src/modules/claims/actions/parse-receipt.ts`:

1. In `geminiParseResultSchema` (around line 62), add after `confidenceScore`:

```ts
foreign_currency_code: z
  .enum(["INR", "USD", "EUR", "CHF"])
  .nullable()
  .optional(),
foreign_basic_amount: looseNumber.optional(),
foreign_gst_amount: looseNumber.optional(),
foreign_total_amount: looseNumber.optional(),
```

2. In `ParsedReceiptResult` type (around line 326), add after `confidenceScore`:

```ts
foreignCurrencyCode: "INR" | "USD" | "EUR" | "CHF" | null;
foreignBasicAmount: number;
foreignGstAmount: number;
foreignTotalAmount: number;
```

3. Update `toParsedReceiptResult` (around line 347) to include the new fields:

```ts
function toParsedReceiptResult(data: ParsedReceiptResult): ParsedReceiptResult {
  return {
    billNo: data.billNo,
    transactionDate: data.transactionDate,
    vendorName: data.vendorName,
    gstNumber: data.gstNumber,
    basicAmount: data.basicAmount,
    cgstAmount: data.cgstAmount,
    sgstAmount: data.sgstAmount,
    igstAmount: data.igstAmount,
    totalAmount: data.totalAmount,
    category_name: data.category_name,
    confidenceScore: data.confidenceScore,
    foreignCurrencyCode: data.foreignCurrencyCode,
    foreignBasicAmount: data.foreignBasicAmount,
    foreignGstAmount: data.foreignGstAmount,
    foreignTotalAmount: data.foreignTotalAmount,
  };
}
```

- [ ] **Step 2: Update `normalizeGeminiResult` to map foreign fields**

In `normalizeGeminiResult` (around line 571), add after the existing normalisations:

```ts
const rawForeignCode = raw.foreign_currency_code ?? null;
const foreignCurrencyCode =
  rawForeignCode != null && ["INR", "USD", "EUR", "CHF"].includes(rawForeignCode)
    ? (rawForeignCode as "INR" | "USD" | "EUR" | "CHF")
    : null;
const foreignBasicAmount = normalizeAmount(raw.foreign_basic_amount ?? 0);
const foreignGstAmount = normalizeAmount(raw.foreign_gst_amount ?? 0);
const foreignTotalAmount = normalizeAmount(raw.foreign_total_amount ?? 0);
```

And update the returned object to include:

```ts
return {
  billNo: normalizeNullableText(raw.billNo),
  transactionDate: raw.transactionDate,
  vendorName: normalizeNullableText(raw.vendorName),
  gstNumber,
  basicAmount,
  cgstAmount,
  sgstAmount,
  igstAmount,
  totalAmount,
  category_name: normalizeNullableText(raw.category_name),
  confidenceScore: normalizedConfidence,
  foreignCurrencyCode,
  foreignBasicAmount,
  foreignGstAmount,
  foreignTotalAmount,
};
```

- [ ] **Step 3: Split the system prompt builder by document type**

Replace `buildGeminiSystemInstruction` with two separate builders:

```ts
function buildInvoiceSystemInstruction(allowedCategoryNames: string[]): string {
  const categoryInstructionBlock =
    allowedCategoryNames.length > 0
      ? `ALLOWED EXPENSE CATEGORY NAMES (EXACT VALUES ONLY):\n${allowedCategoryNames.map((name) => `- ${name}`).join("\n")}`
      : `ALLOWED EXPENSE CATEGORY NAMES:\n- No categories provided → category_name MUST be null`;

  return `
ROLE:
You are a high-precision financial document parser specialized in receipts and invoices.

GOAL:
Extract structured expense data with maximum accuracy.
Documents may be blurry, rotated, cropped, handwritten, or partially missing.

---

EXTRACTION PRIORITY ORDER:
1. totalAmount        ← highest priority
2. cgst / sgst / igst
3. basicAmount
4. billNo, transactionDate
5. vendorName
6. category_name
7. confidenceScore

---

RULE 1 — TOTAL AMOUNT ("totalAmount"):

- MUST be the FINAL payable amount BEFORE any wallet/payment adjustments.
- Ignore: wallet deductions, cashback, discounts, partial payments.
- For ride apps (Uber/Ola): use "Total Fare", "Trip Fare", or "Amount Charged".
- NUMBER FORMAT: Strip ALL currency symbols and commas.
  Example: "₹1,365.40" → 1365.40

---

RULE 2 — TAXES:
Return: cgst_amount, sgst_amount, igst_amount.

- If tax % shown but amount missing → calculate it.
- If no GST is found anywhere → all tax fields = 0.
- NEVER put tax values in fees or basicAmount.

---

RULE 3 — FEES (CRITICAL):

Fees include: platform fees, delivery fees, service charges, ICANN fees, convenience fees.

- Fees are NOT taxes — do NOT put them in cgst/sgst/igst.
- Fees ARE included in totalAmount.
- Fees MUST be absorbed into basicAmount.

Correct mental model:
  basicAmount = subtotal + all fees (if subtotal is listed)
  OR
  basicAmount = totalAmount − cgst_amount − sgst_amount − igst_amount

---

RULE 4 — BASIC AMOUNT ("basicAmount"):

SINGLE CANONICAL FORMULA (always use this):
  basicAmount = totalAmount − (cgst_amount + sgst_amount + igst_amount)

This formula automatically absorbs all fees into basicAmount.
Do NOT create alternate logic paths.

STRICT MATH VALIDATION:
  basicAmount + cgst_amount + sgst_amount + igst_amount = totalAmount
  Allowed rounding tolerance: ±1

If this does not hold → deduct 30 from confidenceScore.

---

RULE 5 — IDENTIFIERS:

- billNo          → Invoice No / Bill No / Receipt No / Txn No
- For ride, trip, taxi, courier, or delivery platforms, ALWAYS extract the primary receipt identifier into billNo.
- If a Bill ID / Invoice ID / Receipt ID / Booking ID / Trip ID / Order ID is visible, use that first for billNo.
- Only fall back to Ride ID when no bill-style identifier is present.
- Capture the FULL identifier token exactly as shown.
- transactionDate → YYYY-MM-DD ONLY. Convert ALL regional formats.
- vendorName      → brand / company name
- gst_number      → GST registration number. If not visible → null. NEVER hallucinate.
- If any field is unclear → null.

---

RULE 6 — CATEGORY:
${categoryInstructionBlock}

- MUST match EXACT string from the list above.
- Use vendor name + line items to reason.
- If unsure → null.

---

RULE 7 — CONFIDENCE SCORE (0–100):
Start at 100. Deduct:
  -30 → math mismatch (basicAmount + taxes ≠ totalAmount)
  -20 → blurry or unreadable image
  -15 → missing billNo or transactionDate
  -10 → basicAmount was estimated or guessed
Clamp result between 0 and 100.

---

RULE 8 — FOREIGN CURRENCY INVOICES:

If the invoice currency is NOT Indian Rupees (INR):
- Detect the currency. Snap STRICTLY to this enum: INR, USD, EUR, CHF.
  - US Dollar / $ / USD → "USD"
  - Euro / € / EUR → "EUR"
  - Swiss Franc / CHF / Fr. / SFr → "CHF"
  - If currency is unrecognised or cannot be mapped to the enum → null
- Set foreign_currency_code to the matched enum value.
- Set foreign_basic_amount = the invoice base cost in the foreign currency.
- Set foreign_gst_amount = tax amount in the foreign currency (0 if none).
- Set foreign_total_amount = foreign_basic_amount + foreign_gst_amount.
- IMPORTANT: Set local basicAmount = 0, cgst_amount = 0, sgst_amount = 0, igst_amount = 0, totalAmount = 0.

If the invoice IS in INR (₹ / Rs / Rupees):
- Set foreign_currency_code = null.
- Set foreign_basic_amount = 0, foreign_gst_amount = 0, foreign_total_amount = 0.
- Populate local basicAmount, cgst_amount, sgst_amount, igst_amount, totalAmount normally.

---

STRICT OUTPUT RULES:

- Return EXACTLY ONE JSON object.
- Return ONLY raw, valid JSON. No markdown, no backticks, no explanation.
- NEVER leave numeric fields undefined.
- NEVER output commas inside numbers.

---

SCHEMA:
{
  "billNo": string | null,
  "transactionDate": string | null,
  "vendorName": string | null,
  "basicAmount": number,
  "gst_number": string | null,
  "cgst_amount": number,
  "sgst_amount": number,
  "igst_amount": number,
  "totalAmount": number,
  "category_name": string | null,
  "confidenceScore": number,
  "foreign_currency_code": "INR" | "USD" | "EUR" | "CHF" | null,
  "foreign_basic_amount": number,
  "foreign_gst_amount": number,
  "foreign_total_amount": number
}
`;
}

function buildBankStatementSystemInstruction(): string {
  return `
ROLE:
You are a financial document parser specializing in bank statements.

GOAL:
Find the single settled INR debit/deduction amount for a specific expense transaction.

RULES:
- Scan the bank statement for a debit entry (money going OUT of the account).
- Return the deducted INR amount as basicAmount.
- Set ALL other numeric fields to 0.
- Set foreign_currency_code to null.
- Set confidenceScore based on how clearly you identified the debit entry.

STRICT OUTPUT RULES:
- Return EXACTLY ONE JSON object. No markdown. No backticks. No explanation.

SCHEMA:
{
  "billNo": null,
  "transactionDate": string | null,
  "vendorName": null,
  "basicAmount": number,
  "gst_number": null,
  "cgst_amount": 0,
  "sgst_amount": 0,
  "igst_amount": 0,
  "totalAmount": 0,
  "category_name": null,
  "confidenceScore": number,
  "foreign_currency_code": null,
  "foreign_basic_amount": 0,
  "foreign_gst_amount": 0,
  "foreign_total_amount": 0
}
`;
}
```

- [ ] **Step 4: Update `parseReceiptAction` to read `documentType` and route prompts**

In `parseReceiptAction` (around line 610), replace the existing calls to `buildGeminiSystemInstruction` and `createGeminiModel` with the new document-type routing:

```ts
export async function parseReceiptAction(input: FormData): Promise<ParseReceiptActionResult> {
  const fileEntry = input.get("receiptFile");
  const documentType =
    input.get("documentType") === "bank_statement" ? "bank_statement" : "invoice";
  const allowedCategoryNames =
    documentType === "invoice" ? extractAllowedCategoryNames(input) : [];
  const geminiInstruction =
    documentType === "invoice"
      ? buildInvoiceSystemInstruction(allowedCategoryNames)
      : buildBankStatementSystemInstruction();

  // ... rest of the function is unchanged, it uses `geminiInstruction` already
```

Make sure the rest of the function body is kept exactly as before — only the instruction-building lines at the top change.

- [ ] **Step 5: Verify TypeScript compiles**

```powershell
cd D:\nxtclaim; npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```powershell
cd D:\nxtclaim
git add src/modules/claims/actions/parse-receipt.ts
git commit -m "feat(ai): add documentType routing and foreign currency fields to parser"
```

---

## Task 5: Update New Claim Form

**Files:**

- Modify: `src/modules/claims/ui/new-claim-form-client.tsx`

- [ ] **Step 1: Extend `ClaimFormDraftValues.expense`**

In the `ClaimFormDraftValues` type (around line 37), add four fields to the `expense` object after `currencyCode`:

```ts
foreignCurrencyCode: string;
foreignBasicAmount: number;
foreignGstAmount: number;
foreignTotalAmount: number;
```

- [ ] **Step 2: Add default values in `useForm`**

In the `useForm({ defaultValues: { expense: { ... } } })` (around line 377), add after `currencyCode: "INR"`:

```ts
foreignCurrencyCode: "INR",
foreignBasicAmount: 0,
foreignGstAmount: 0,
foreignTotalAmount: 0,
```

- [ ] **Step 3: Add `useWatch` for foreign amount fields**

After the existing `useWatch` calls for `igstAmount` (around line 436), add:

```ts
const foreignBasicAmount = useWatch({ control, name: "expense.foreignBasicAmount" });
const foreignGstAmount = useWatch({ control, name: "expense.foreignGstAmount" });
```

- [ ] **Step 4: Add derived `foreignTotalAmount` via `useEffect`**

After the existing `useEffect` that computes `expense.totalAmount` (around line 462), add:

```ts
useEffect(() => {
  const safeBasic = Number.isFinite(foreignBasicAmount) ? foreignBasicAmount : 0;
  const safeGst = Number.isFinite(foreignGstAmount) ? foreignGstAmount : 0;
  const foreignTotal = Math.round((safeBasic + safeGst) * 100) / 100;
  setValue("expense.foreignTotalAmount", foreignTotal, {
    shouldDirty: false,
    shouldTouch: false,
    shouldValidate: false,
  });
}, [foreignBasicAmount, foreignGstAmount, setValue]);
```

- [ ] **Step 5: Add AI autofill wiring for foreign fields**

Find the section in the form where the AI parse result is applied to form fields (the `handleReceiptParse` or autofill handler that calls `setValue` for `basicAmount`, `cgstAmount`, etc.). After setting those local fields, add:

```ts
if (result.data.foreignCurrencyCode && result.data.foreignCurrencyCode !== "INR") {
  setValue("expense.foreignCurrencyCode", result.data.foreignCurrencyCode, {
    shouldValidate: true,
  });
  setValue("expense.foreignBasicAmount", result.data.foreignBasicAmount, { shouldValidate: true });
  setValue("expense.foreignGstAmount", result.data.foreignGstAmount, { shouldValidate: true });
}
```

Also, when calling `parseReceiptAction` for a receipt/invoice, append `documentType = "invoice"` to the `FormData`:

```ts
parseFormData.append("documentType", "invoice");
```

When calling `parseReceiptAction` for a bank statement (find the bank statement parse handler), append:

```ts
parseFormData.append("documentType", "bank_statement");
```

- [ ] **Step 6: Add the Foreign Expense Details UI section**

Find where the local amount fields (basicAmount, cgstAmount etc.) are rendered in the JSX for the expense form. Add this section **after** the local amounts section, inside the `detailType === "expense"` branch:

```tsx
{
  /* Foreign Expense Details */
}
<div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 mb-6 space-y-4 dark:border-amber-800/40 dark:bg-amber-900/10">
  <h4 className="text-xs uppercase tracking-wider text-amber-700 font-bold mb-4 dark:text-amber-400">
    Foreign Expense Details (optional)
  </h4>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
      Foreign Currency
      <select
        {...register("expense.foreignCurrencyCode")}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      >
        <option value="INR">INR — Indian Rupee (no foreign amount)</option>
        <option value="USD">USD — US Dollar</option>
        <option value="EUR">EUR — Euro</option>
        <option value="CHF">CHF — Swiss Franc</option>
      </select>
    </label>

    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
      Foreign Basic Amount
      <CurrencyInput
        {...register("expense.foreignBasicAmount", { valueAsNumber: true })}
        min="0"
        step="0.01"
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {errors.expense?.foreignBasicAmount && (
        <span className="text-xs text-red-500">{errors.expense.foreignBasicAmount.message}</span>
      )}
    </label>

    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
      Foreign GST Amount
      <CurrencyInput
        {...register("expense.foreignGstAmount", { valueAsNumber: true })}
        min="0"
        step="0.01"
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
    </label>

    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
      Foreign Total Amount (auto-calculated)
      <CurrencyInput
        {...register("expense.foreignTotalAmount", { valueAsNumber: true })}
        disabled
        readOnly
        className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
      />
    </label>
  </div>
</div>;
```

- [ ] **Step 7: Verify TypeScript compiles**

```powershell
cd D:\nxtclaim; npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```powershell
cd D:\nxtclaim
git add src/modules/claims/ui/new-claim-form-client.tsx
git commit -m "feat(new-claim-form): add Foreign Expense Details section with auto-calculated total"
```

---

## Task 6: Update Finance/Own Edit Form

**Files:**

- Modify: `src/modules/claims/ui/finance-edit-claim-form.tsx`

- [ ] **Step 1: Add `ForeignAmountState` type and extend props**

At the top of the file, after `ExpenseAmountState` type (around line 36), add:

```ts
type ForeignAmountState = {
  foreignCurrencyCode: string;
  foreignBasicAmount: number;
  foreignGstAmount: number;
  foreignTotalAmount: number;
};
```

- [ ] **Step 2: Extend the `claim.expense` prop type**

In `FinanceEditClaimFormProps`, inside the `expense` object type (around line 56), add after `totalAmount`:

```ts
foreignCurrencyCode?: string | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

- [ ] **Step 3: Add `buildForeignAmountState` helper**

After the `buildExpenseAmountState` function (around line 124), add:

```ts
function buildForeignAmountState(
  expense:
    | Pick<
        NonNullable<FinanceEditClaimFormProps["claim"]["expense"]>,
        "foreignCurrencyCode" | "foreignBasicAmount" | "foreignGstAmount" | "foreignTotalAmount"
      >
    | null
    | undefined,
): ForeignAmountState {
  const foreignCurrencyCode = expense?.foreignCurrencyCode ?? "INR";
  const foreignBasicAmount = toNonNegativeCurrency(expense?.foreignBasicAmount);
  const foreignGstAmount = toNonNegativeCurrency(expense?.foreignGstAmount);
  const foreignTotalAmount = roundCurrency(foreignBasicAmount + foreignGstAmount);

  return { foreignCurrencyCode, foreignBasicAmount, foreignGstAmount, foreignTotalAmount };
}
```

- [ ] **Step 4: Add state for foreign amounts**

In the `FinanceEditClaimForm` component, after the `expenseAmounts` state (around line 186), add:

```ts
const [foreignAmounts, setForeignAmounts] = useState<ForeignAmountState>(() =>
  buildForeignAmountState(claim.expense),
);
```

- [ ] **Step 5: Add `useEffect` to sync foreign state when claim prop changes**

After the existing `useEffect` that syncs `expenseAmounts` from `expenseId` dependency (around line 226), add:

```ts
useEffect(() => {
  setForeignAmounts(buildForeignAmountState(claim.expense));
}, [
  claim.expense?.foreignCurrencyCode,
  claim.expense?.foreignBasicAmount,
  claim.expense?.foreignGstAmount,
  claim.expense?.foreignTotalAmount,
]);
```

Note: The dependency array intentionally uses primitive values (not the full `claim.expense` object) to avoid infinite loops.

- [ ] **Step 6: Add foreign amount change handlers**

After `handleExpenseComponentAmountChange` (around line 250), add:

```ts
const handleForeignCurrencyCodeChange = (code: string) => {
  setForeignAmounts((current) => ({ ...current, foreignCurrencyCode: code }));
};

const handleForeignAmountChange = (
  field: "foreignBasicAmount" | "foreignGstAmount",
  value: number | null,
) => {
  setForeignAmounts((current) => {
    const next = {
      ...current,
      [field]: toNonNegativeCurrency(value),
    };
    next.foreignTotalAmount = roundCurrency(next.foreignBasicAmount + next.foreignGstAmount);
    return next;
  });
};
```

- [ ] **Step 7: Add hidden inputs for foreign fields in the form**

In the JSX, inside `<form onSubmit={handleSubmit} ...>`, after the existing hidden inputs for `detailType` and `detailId` (around line 334), add:

```tsx
{
  claim.detailType === "expense" && (
    <>
      <input type="hidden" name="foreignCurrencyCode" value={foreignAmounts.foreignCurrencyCode} />
      <input
        type="hidden"
        name="foreignBasicAmount"
        value={String(foreignAmounts.foreignBasicAmount)}
      />
      <input
        type="hidden"
        name="foreignGstAmount"
        value={String(foreignAmounts.foreignGstAmount)}
      />
      <input
        type="hidden"
        name="foreignTotalAmount"
        value={String(foreignAmounts.foreignTotalAmount)}
      />
    </>
  );
}
```

- [ ] **Step 8: Add the Foreign Expense Details UI section**

Find the "Amount Details" groupedWrapper section (around line 675) which contains `Basic Amount`, `CGST Amount`, etc. Add a new `groupedWrapperClassName` section **after** the closing `</div>` of that "Amount Details" block (and still within the `claim.detailType === "expense"` branch):

```tsx
{
  claim.detailType === "expense" && (
    <div className={groupedWrapperClassName}>
      <h4 className={groupedTitleClassName}>Foreign Expense Details (optional)</h4>
      <div className={groupedGridClassName}>
        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Foreign Currency
          <select
            value={foreignAmounts.foreignCurrencyCode}
            onChange={(e) => handleForeignCurrencyCodeChange(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="INR">INR — Indian Rupee (no foreign amount)</option>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="CHF">CHF — Swiss Franc</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Foreign Basic Amount
          <CurrencyInput
            min="0"
            step="0.01"
            value={foreignAmounts.foreignBasicAmount}
            onValueChange={(value) => handleForeignAmountChange("foreignBasicAmount", value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>

        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Foreign GST Amount
          <CurrencyInput
            min="0"
            step="0.01"
            value={foreignAmounts.foreignGstAmount}
            onValueChange={(value) => handleForeignAmountChange("foreignGstAmount", value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>

        <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Foreign Total Amount (auto-calculated)
          <CurrencyInput
            value={foreignAmounts.foreignTotalAmount}
            disabled
            className={lockedFieldClassName}
          />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Verify TypeScript compiles**

```powershell
cd D:\nxtclaim; npx tsc --noEmit
```

- [ ] **Step 10: Commit**

```powershell
cd D:\nxtclaim
git add src/modules/claims/ui/finance-edit-claim-form.tsx
git commit -m "feat(finance-edit-form): add Foreign Expense Details section"
```

---

## Task 7: Update Backend Persistence

**Files:**

- Modify: `src/modules/claims/actions.ts`
- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts`

### 7a — `actions.ts`

- [ ] **Step 1: Add foreign fields to `extractSubmissionInput`**

In `src/modules/claims/actions.ts`, inside `extractSubmissionInput` (around line 418), in the `payload.expense` object (around line 462), add after `currencyCode`:

```ts
foreignCurrencyCode: getFormDataNullableString(input, "expense.foreignCurrencyCode"),
foreignBasicAmount: getFormDataNumber(input, "expense.foreignBasicAmount"),
foreignGstAmount: getFormDataNumber(input, "expense.foreignGstAmount"),
foreignTotalAmount: getFormDataNumber(input, "expense.foreignTotalAmount"),
```

- [ ] **Step 2: Add foreign fields to `buildFinanceEditPayload`**

In the same file, in `buildFinanceEditPayload` (around line 1086), in the `if (detailType === "expense")` branch's returned object (around line 1096), add after `totalAmount`:

```ts
foreignCurrencyCode: getFormDataNullableString(formData, "foreignCurrencyCode"),
foreignBasicAmount: getFormDataNumber(formData, "foreignBasicAmount"),
foreignGstAmount: getFormDataNumber(formData, "foreignGstAmount"),
foreignTotalAmount: getFormDataNumber(formData, "foreignTotalAmount"),
```

### 7b — `SupabaseClaimRepository.ts`

- [ ] **Step 3: Add foreign columns to `createExpenseDetailDraft` insert**

In `src/modules/claims/repositories/SupabaseClaimRepository.ts`, in `createExpenseDetailDraft` (around line 2642), in the `.insert({ ... })` object (around line 2652), add after `ai_metadata`:

```ts
foreign_currency_code: prepared.expense.foreignCurrencyCode ?? null,
foreign_basic_amount: prepared.expense.foreignBasicAmount ?? null,
foreign_gst_amount: prepared.expense.foreignGstAmount ?? null,
foreign_total_amount: prepared.expense.foreignTotalAmount ?? null,
```

- [ ] **Step 4: Verify the RPC path (manual check)**

The `update_claim_by_finance` and `update_claim_by_submitter` RPCs receive `p_payload` as JSONB. The foreign fields are now in `FinanceExpenseEditPayload` / `OwnExpenseEditPayload`, so they will be serialised into `p_payload`. Confirm that the Postgres function body for each RPC reads and writes these columns. If not, a SQL migration is needed — but that is outside this plan's scope; flag it before marking this task done.

To check, run this in the Supabase SQL editor or via the MCP supabase tool:

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'update_claim_by_finance';
```

Look for references to `foreign_basic_amount`, `foreign_currency_code`, etc. If absent, coordinate with the DB team to add them.

- [ ] **Step 5: Verify TypeScript compiles — full clean pass**

```powershell
cd D:\nxtclaim; npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```powershell
cd D:\nxtclaim
git add src/modules/claims/actions.ts src/modules/claims/repositories/SupabaseClaimRepository.ts
git commit -m "feat(persistence): wire foreign currency fields through actions and repository"
```

---

## Task 8: Final Type Safety Gate

**Files:** None (validation only)

- [ ] **Step 1: Run full TypeScript check**

```powershell
cd D:\nxtclaim; npx tsc --noEmit 2>&1
```

Expected: No errors. If there are errors, fix them before proceeding. Common issues:

- `ClaimFullExportRecord` may need the 4 foreign fields added if it spreads `expense_details` columns
- Any spread (`...prepared.expense`) that now includes the new optional fields should type-check fine since they're `?: T | null`

- [ ] **Step 2: Check for Playwright test breakage**

```powershell
cd D:\nxtclaim; npx playwright test --reporter=list 2>&1 | Select-Object -First 60
```

The new fields are all optional so existing tests should not break. If any fail, inspect the error — it is likely an existing issue, not caused by this feature.

- [ ] **Step 3: Final commit**

```powershell
cd D:\nxtclaim
git add -A
git commit -m "chore: verify type safety gate for foreign currency feature"
```

---

## Self-Review Checklist

**Spec coverage:**

- [x] `contracts.ts` — 4 types updated (Task 1)
- [x] `new-claim-schema.ts`, `finance-edit-schema.ts`, `own-edit-schema.ts` — foreign fields + cross-field validation (Task 2)
- [x] `claim-full-details-grid.tsx` — type extension + conditional section with non-INR render condition (Task 3)
- [x] `parse-receipt.ts` — `documentType` flag, invoice/bank statement prompt split, schema + result type + normalisation (Task 4)
- [x] `new-claim-form-client.tsx` — form state, `useWatch`, `useEffect` for foreign total, AI autofill, UI section (Task 5)
- [x] `finance-edit-claim-form.tsx` — `ForeignAmountState`, handlers, hidden inputs, UI section (Task 6)
- [x] `actions.ts` — `extractSubmissionInput` and `buildFinanceEditPayload` extended (Task 7)
- [x] `SupabaseClaimRepository.ts` — `createExpenseDetailDraft` insert extended (Task 7)
- [x] TypeScript gate (Task 8)

**Type consistency verified:**

- `foreignCurrencyCode`, `foreignBasicAmount`, `foreignGstAmount`, `foreignTotalAmount` — same names used consistently in contracts, schemas, form state, actions, and repository
- `ForeignAmountState` field names match the camelCase convention in contracts
- Snake-case DB columns `foreign_currency_code` etc. used only in the repository insert
