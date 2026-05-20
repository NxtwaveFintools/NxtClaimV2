# Foreign Currency Expense Fields — Design Spec

**Date:** 2026-05-18  
**Branch:** ForeignC  
**Status:** Approved — ready for implementation

---

## 1. Overview

Expand the expense claims system to capture foreign currency expense data in parallel with the existing local INR amounts. Four new columns already exist on the `expense_details` table. This spec covers wiring them end-to-end: domain contracts → Zod schemas → UI forms → details view → AI parser → repository persistence.

**Key invariant:** The existing `currency_code` column (always `"INR"`) is never touched. All new work targets the four `foreign_*` columns exclusively.

---

## 2. Database Columns (already migrated)

| Column                  | Type                            | Notes                                        |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| `foreign_currency_code` | `enum('INR','USD','EUR','CHF')` | Null = no foreign transaction                |
| `foreign_basic_amount`  | `numeric`                       | Base cost in foreign currency                |
| `foreign_gst_amount`    | `numeric`                       | Tax in foreign currency                      |
| `foreign_total_amount`  | `numeric`                       | Computed: basic + gst (enforced client-side) |

---

## 3. Domain Contracts (`contracts.ts`)

Add four optional fields to **three** payload types:

```ts
foreignCurrencyCode?: 'INR' | 'USD' | 'EUR' | 'CHF' | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

Affected types:

- `ClaimSubmissionInput.expense`
- `PreparedClaimSubmission.expense`
- `FinanceExpenseEditPayload`
- `OwnExpenseEditPayload`

Also add these fields to `ClaimExpenseDetail` in `claim-full-details-grid.tsx` (local type).

---

## 4. Zod Validation Schemas

### Shared enum definition

```ts
const foreignCurrencyCodeSchema = z.enum(["INR", "USD", "EUR", "CHF"]).default("INR");
```

### Fields added to expense object in all three schemas

(`new-claim-schema.ts`, `finance-edit-schema.ts`, `own-edit-schema.ts`)

```ts
foreignCurrencyCode: foreignCurrencyCodeSchema,
foreignBasicAmount: z.number().min(0).optional().nullable(),
foreignGstAmount:   z.number().min(0).optional().nullable(),
foreignTotalAmount: z.number().min(0).optional().nullable(),
```

### Cross-field validation (superRefine)

Add to the `superRefine` in each schema:

> If `foreignCurrencyCode` is not `"INR"`, then `foreignBasicAmount` must be present and > 0.

```ts
if (value.expense?.foreignCurrencyCode !== "INR" && value.expense?.foreignCurrencyCode != null) {
  if (!value.expense.foreignBasicAmount || value.expense.foreignBasicAmount <= 0) {
    ctx.addIssue({
      code: "custom",
      message: "Foreign basic amount is required for non-INR currencies.",
      path: ["expense", "foreignBasicAmount"],
    });
  }
}
```

---

## 5. UI Forms

### Components: `new-claim-form-client.tsx` and `finance-edit-claim-form.tsx`

Add a **"Foreign Expense Details"** section below the existing local amounts section. Only visible when `detailType === 'expense'`.

**Section layout:**

| Field                | Type              | Behaviour                                                                                                                                                                                                                      |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foreign Currency     | `<FormSelect>`    | Options: INR, USD, EUR, CHF. Default: INR.                                                                                                                                                                                     |
| Foreign Basic Amount | `<CurrencyInput>` | Editable. Required when currency ≠ INR.                                                                                                                                                                                        |
| Foreign GST Amount   | `<CurrencyInput>` | Editable. Optional.                                                                                                                                                                                                            |
| Foreign Total Amount | `<CurrencyInput>` | `disabled` + `readOnly`. Value = `foreignBasicAmount + foreignGstAmount`, recomputed on every change via `useEffect` or derived state. Never submitted as user-controlled input — calculated value is written into form state. |

**State management:** The form must maintain `foreignBasicAmount` and `foreignGstAmount` as numeric state fields (mirroring the existing `ExpenseAmountState` pattern for local amounts). `foreignTotalAmount` is always derived, never independently editable.

**Default values on load:** Pre-populate from existing claim data when editing. For new claims, all foreign fields default to `INR` / `0` / `0` / `0`.

---

## 6. Claim Details View (`claim-full-details-grid.tsx`)

### Type extension

Add to the `ClaimExpenseDetail` local type:

```ts
foreignCurrencyCode?: string | null;
foreignBasicAmount?: number | null;
foreignGstAmount?: number | null;
foreignTotalAmount?: number | null;
```

### Render condition

Show the "Foreign Expense Details" section **only when** `claim.expense.foreignCurrencyCode !== 'INR' && claim.expense.foreignCurrencyCode != null`.

### Display

Render four data cards inside a new `<section>` mirroring the existing expense detail style:

- **Currency** — display the code string (e.g., `"USD"`)
- **Foreign Basic Amount** — formatted with the foreign currency (use `Intl.NumberFormat` with `currency: foreignCurrencyCode`)
- **Foreign GST Amount** — same formatter
- **Foreign Total Amount** — same formatter, visually emphasised like the local total

---

## 7. AI Parsing Logic (`parse-receipt.ts`)

### New input field

`parseReceiptAction(input: FormData)` reads a new key:

```
documentType: "invoice" | "bank_statement"
```

Default (if absent): `"invoice"`.

### New output fields on `ParsedReceiptResult`

```ts
foreignCurrencyCode: "INR" | "USD" | "EUR" | "CHF" | null;
foreignBasicAmount: number;
foreignGstAmount: number;
foreignTotalAmount: number;
```

### Prompt routing

**RULE A — Invoice (`documentType = "invoice"`)**

New instructions appended to the system prompt:

> RULE 8 — FOREIGN CURRENCY INVOICES:
>
> If the invoice currency is NOT Indian Rupees (INR):
>
> - Set `foreign_currency_code` to one of: INR, USD, EUR, CHF. Snap strictly to this enum — do not invent values.
>   - US Dollar / $ → USD
>   - Euro / € → EUR
>   - Swiss Franc / CHF / Fr. → CHF
>   - If currency is unrecognised or cannot be mapped → null
> - Set `foreign_basic_amount` = invoice base cost in the foreign currency
> - Set `foreign_gst_amount` = tax amount in the foreign currency (0 if none)
> - Set `foreign_total_amount` = `foreign_basic_amount + foreign_gst_amount`
> - Set local `basicAmount`, `cgst_amount`, `sgst_amount`, `igst_amount` to 0
> - Set local `totalAmount` to 0
>
> If the invoice IS in INR, set `foreign_currency_code` = null, all foreign amounts = 0, and populate local fields normally.

**RULE B — Bank Statement (`documentType = "bank_statement"`)**

Separate system prompt focusing only on settled debit:

> You are parsing a bank statement to find a settled payment deduction.
> Find the debit/deduction amount in INR for the relevant transaction.
> Return ONLY the settled INR deduction as `basicAmount`. Set all other fields to 0 or null.

### Schema extension (`geminiParseResultSchema`)

```ts
foreign_currency_code: z.enum(['INR','USD','EUR','CHF']).nullable().optional(),
foreign_basic_amount:  looseNumber.optional(),
foreign_gst_amount:    looseNumber.optional(),
foreign_total_amount:  looseNumber.optional(),
```

### Normalisation (`normalizeGeminiResult`)

Map the new fields through the same `normalizeAmount` / null-guard helpers and include them in the returned `ParsedReceiptResult`.

### UI wiring (`new-claim-form-client.tsx`)

When calling `parseReceiptAction`:

- Append `documentType = "invoice"` when parsing a receipt file
- Append `documentType = "bank_statement"` when parsing a bank statement file

On a successful invoice parse with a non-null `foreignCurrencyCode`, auto-fill all four foreign fields into form state.

---

## 8. Backend Persistence

### `actions.ts`

Extract from `FormData` (or typed form values) the four new camelCase fields and pass them into the `ClaimSubmissionInput.expense` and `FinanceExpenseEditPayload` objects.

### `SupabaseClaimRepository.ts`

**`createExpenseDetailDraft`** — add to the `.insert()` object:

```ts
foreign_currency_code: prepared.expense.foreignCurrencyCode ?? null,
foreign_basic_amount:  prepared.expense.foreignBasicAmount  ?? null,
foreign_gst_amount:    prepared.expense.foreignGstAmount    ?? null,
foreign_total_amount:  prepared.expense.foreignTotalAmount  ?? null,
```

**`updateClaimDetailsByFinance` / `updateClaimDetailsBySubmitter`** — these go through RPCs (`update_claim_by_finance`, `update_claim_by_submitter`) that receive `p_payload`. The foreign fields must be included in the `FinanceExpenseEditPayload` / `OwnExpenseEditPayload` objects so they are serialised into the JSONB payload passed to Postgres. The Postgres function is assumed to already handle the new columns (they exist on the table).

> **Risk note:** If the Postgres RPC functions do not yet extract and write the new `foreign_*` columns from `p_payload`, those functions will need a migration update. Verify this before marking Step 5 complete.

---

## 9. Type Safety Checkpoint

Run `npx tsc --noEmit` after completing each step. The compile must be clean before moving on. Pay particular attention to:

- `ClaimFullExportRecord` — may need the four foreign fields added if used in type-checked export paths
- Any place that spreads or destructures `ClaimExpenseDetail` or `PreparedClaimSubmission.expense`

---

## 10. Implementation Order

1. `contracts.ts` — domain types (unblocks everything)
2. Three Zod schemas — validation
3. `claim-full-details-grid.tsx` — details view (no form state complexity)
4. `parse-receipt.ts` + `ParsedReceiptResult` — AI parser
5. `new-claim-form-client.tsx` — new claim UI
6. `finance-edit-claim-form.tsx` — edit UI
7. `actions.ts` + `SupabaseClaimRepository.ts` — persistence
8. `npx tsc --noEmit` — type safety gate
