# Receipt Extraction Overhaul — Design

**Date:** 2026-06-10
**Status:** Approved
**Owner area:** `src/modules/claims/actions/parse-receipt.ts` and surrounding form/DB layers

## Problem

The AI auto-fill on the new-claim form produces poor results: incorrect dates, missing
fields, undetected currency, and wrong basic/total amounts. Root causes identified:

1. **Weak model** — `gemini-2.5-flash-lite` (lowest-accuracy vision tier) on a
   deprecated, EOL SDK (`@google/generative-ai`, support ended 2025-11-30).
2. **Date corruption in code** — `looseDate` runs `new Date(value)` on model output.
   JS parses ambiguous dates as MM/DD (US order), so Indian DD/MM dates flip; and
   `.toISOString()` shifts IST-parsed dates back one day via UTC conversion.
3. **Currency hard-cap** — only INR/USD/EUR/CHF pass the Zod enum (`.catch(null)`),
   the form dropdown, and a DB check constraint. Any other currency silently nulls.
4. **LLM arithmetic** — the prompt asks the model to compute
   `basicAmount = total − taxes` and self-grade a confidence score with deductions.
   Both are unreliable in LLMs.
5. **No enforced output schema** — `responseMimeType: application/json` is set but
   not `responseSchema`; fields go missing and JSON is regex-scraped from text.
6. **One monolithic prompt** for all document types, with internally inconsistent
   worked examples (3 of 4 omit the foreign-currency keys the schema requires).

## Decisions (made with user)

- **Model:** `gemini-3.5-flash` (GA 2026-05-19), model ID configurable via env var
  with this default. Cost ≈ $0.006 per parse — negligible at expected volume.
- **SDK:** migrate to the unified `@google/genai` SDK (required for Gemini 3.x).
- **Currency scope:** any valid ISO 4217 code, end-to-end (DB, validation, form, AI).
- **Approach:** hardened single-pass pipeline (one Gemini call per document; no
  two-stage classification, no external OCR vendor).
- **Verification:** unit tests + an eval harness run against real sample documents
  supplied by the user (including currently-failing ones).

## Design

### 1. Architecture & data flow

Unchanged shape, hardened internals:

```
Upload (PDF/JPG/PNG/WEBP ≤25MB)
  → parseReceiptAction (server action)
    → ONE Gemini call (gemini-3.5-flash, @google/genai, responseSchema enforced)
    → code-side normalization, math, validation, confidence
  → ParseReceiptActionResult (existing contract, unchanged)
  → form auto-fill (existing logic, minimal changes)
```

`ParseReceiptActionResult` keeps its current field names so the form integration is
a drop-in. `foreignCurrencyCode` widens from the 4-value union to `string | null`
(validated ISO 4217).

### 2. Extraction contract — model reads, code computes

Gemini `responseSchema` (constrained decoding) enforces this model output:

| Field                                      | Type         | Notes                                                                                |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| `docType`                                  | enum         | `food_delivery \| ride_hailing \| gst_invoice \| receipt \| bank_statement \| other` |
| `vendorName`                               | string\|null | never guessed                                                                        |
| `billNo`                                   | string\|null | full token verbatim incl. `#`/hyphens; ride-ID fallback for ride apps                |
| `gstNumber`                                | string\|null | only if visibly printed                                                              |
| `dateAsPrinted`                            | string\|null | verbatim as it appears (audit trail for conversion)                                  |
| `transactionDate`                          | string\|null | `YYYY-MM-DD` only                                                                    |
| `currencyCode`                             | string\|null | ISO 4217 alpha-3                                                                     |
| `subtotalAmount`                           | number\|null | pre-fee, pre-tax item total if printed                                               |
| `feesTotal`                                | number\|null | platform/delivery/service/convenience fees summed                                    |
| `discountTotal`                            | number\|null | discounts/coupons (NOT wallet payments)                                              |
| `cgstAmount` / `sgstAmount` / `igstAmount` | number\|null | printed tax lines                                                                    |
| `totalAmount`                              | number\|null | final payable BEFORE wallet/payment adjustments                                      |

Prompt principles:

- Short, per-`docType` compact hints (Swiggy/Zomato: grand total before wallet
  deduction; Uber/Ola/Rapido: Trip Fare + bill-ID-first/ride-ID-fallback; GST
  invoices: read the tax table).
- All "calculate X" and "deduct N from confidence" instructions are **removed**.
- `null` over guessing, explicitly.

### 3. Code-side computation & validation

New pure module `src/modules/claims/actions/receipt-normalization.ts` (unit-testable
without mocking Gemini):

- **Amounts:** `basicAmount = totalAmount − (cgst + sgst + igst)`, floored at 0,
  rounded to 2dp. Cross-check against `subtotal + fees − discount` when those are
  present; mismatch beyond ±1 flags `mathConsistent = false`.
- **Dates:** accept only strict `^\d{4}-\d{2}-\d{2}$` that is a real calendar date,
  not in the future, and not older than 2 years. Anything else → `null` (manual
  fill) — never a silently wrong date. **No `new Date(string)` parsing anywhere.**
- **Currency:** validate against `Intl.supportedValuesOf("currency")` (built into
  Node; no hardcoded list). `INR` or null → populate local INR fields, foreign
  fields zero/null. Non-INR → populate foreign fields
  (`foreignBasicAmount/GstAmount/TotalAmount`), zero local fields (preserves the
  2026-05-18 foreign-currency business rule).
- **Confidence (deterministic, replaces model self-grading):** start 100; deduct
  30 if math inconsistent, 15 if no `transactionDate`, 15 if no `billNo`, 10 if no
  `vendorName`, 20 if a currency symbol/code was detected but failed ISO
  validation; clamp 0–100. Existing threshold (80) and the partial-fill /
  low-confidence messaging behavior are unchanged.

### 4. ISO currency end-to-end

- **DB migration** (+ matching rollback file, per repo convention): relax the
  `foreign_currency_code` check constraint from the 4-value list to
  `foreign_currency_code ~ '^[A-Z]{3}$'` (nullable as today).
- **Zod** (`new-claim-schema.ts`): `z.string().regex(/^[A-Z]{3}$/)` + refine
  against `Intl.supportedValuesOf("currency")`; default `"INR"`. The existing
  cross-field rule (non-INR ⇒ `foreignBasicAmount` required > 0) stays.
- **Form:** currency dropdown lists all ISO codes with common ones pinned first
  (INR, USD, EUR, GBP, CHF, AED, SGD).
- Display helpers (`formatForeignAmountValue`) already take the code as a string —
  verify, no redesign.

### 5. Bank-statement mode

Same hardening: enforced `responseSchema`, code-side validation, deterministic
confidence. The existing selection rules (settled debits only, never credits or
holds, rank by vendor/date/billNo/foreign-total hints) are retained — they are
sound. Output mapping unchanged: matched INR debit → `basicAmount`,
`totalAmount = 0`, taxes 0.

### 6. SDK migration & resilience

- Replace `@google/generative-ai` with `@google/genai` in `package.json` and
  `parse-receipt.ts` (the only call site).
- Model ID read from `GEMINI_MODEL` env var (optional in `server-env.ts`),
  defaulting to `gemini-3.5-flash`. Document in `.env.example`.
- Preserve behavior: 503 retry (3 attempts, 1s delay), 429 quota messaging with
  retry-delay extraction, 25MB limit, MIME allowlist, `temperature: 0`. Error
  detection adapted to the new SDK's `ApiError` shape (status code on the error).
- `safeParseJSON` retained only as a fallback; with `responseSchema` the response
  should already be valid JSON.

### 7. Verification

- **Unit tests** (`tests/unit/claims/`): date-normalization table (valid ISO,
  DD/MM strings, US-format strings, two-digit years, future dates, impossible
  dates — all non-ISO → null); amount math incl. fee absorption and mismatch
  flagging; currency validation (valid ISO, invalid code, lowercase, null);
  confidence scoring; existing action tests (retry, quota, partial fill) adapted
  to the new SDK mock.
- **Eval harness** `scripts/eval-receipt-parser.mjs`: reads documents from
  `tests/fixtures/receipts/` plus an `expected.json` (per-file expected field
  values), invokes the live parser, prints per-field accuracy and a diff of
  mismatches. Run before/after on the user's real failing samples; ship only when
  dates/currency/amounts are correct on them.

## Out of scope

- Claim-form UI redesign, approval-flow changes, multi-receipt batch upload.
- Changing the auto-fill UX (thresholds, captions) beyond message wording.
- Reprocessing historical claims.

## Risks

- **New SDK error shapes** differ from the old SDK; retry/quota tests guard this.
- **gemini-3.5-flash output drift** vs the old prompt — mitigated by
  `responseSchema` and the eval harness on real documents.
- **Wider currency list in the form** could surprise finance reviewers; pinned
  common currencies keep the default path familiar.
