# Receipt Extraction Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreliable AI receipt auto-fill (wrong dates, missing fields, undetected currencies, wrong amounts) with a hardened single-pass pipeline: gemini-3.5-flash on the new `@google/genai` SDK, schema-enforced extraction, and all math/dates/confidence computed deterministically in TypeScript.

**Architecture:** One Gemini call per document returns _observed facts only_ (enforced by `responseJsonSchema`); a new pure module `receipt-normalization.ts` computes amounts, validates dates strictly (no `new Date(string)` ever), resolves ISO 4217 currencies, and scores confidence. Currency support widens from {INR,USD,EUR,CHF} to all ISO 4217 codes by extending the existing Postgres enum (RPC functions that cast to it keep working unchanged).

**Tech Stack:** Next.js 16 server actions, `@google/genai` (replaces deprecated `@google/generative-ai`), Zod, Jest, Supabase/Postgres.

**Spec:** `docs/superpowers/specs/2026-06-10-receipt-extraction-overhaul-design.md`

**Deviations from spec (agreed rationale):**

1. Spec said "validate via `Intl.supportedValuesOf("currency")`, no hardcoded list". The DB column is a Postgres **enum**, so app-side and DB-side lists must match exactly. A single canonical committed list (`iso-currency-codes.ts`) is used by Zod, the form, the parser, _and_ the migration. (`Intl.supportedValuesOf` varies by ICU build, risking inserts the DB rejects.)
2. Spec said eval harness `scripts/eval-receipt-parser.mjs`. A Jest **integration test** is used instead (`tests/integration/receipt-parser-eval.test.ts`) because Jest already resolves the `@/` path aliases and TS; a standalone `.mjs` script cannot import the server action. It auto-skips when fixtures or `GEMINI_API_KEY` are absent.
3. The spec's extraction-contract table omitted `categoryName`; it is included (category matching from the allowed list is semantic work only the model can do). It was always part of `ParsedReceiptResult`.

---

### Task 1: ISO currency constants module

**Files:**

- Create: `src/core/constants/iso-currency-codes.ts`
- Test: `tests/unit/claims/iso-currency-codes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import {
  ISO_CURRENCY_CODES,
  PINNED_CURRENCY_CODES,
  isIsoCurrencyCode,
} from "@/core/constants/iso-currency-codes";

describe("iso-currency-codes", () => {
  test("contains the previously supported codes and common additions", () => {
    for (const code of ["INR", "USD", "EUR", "CHF", "GBP", "AED", "SGD", "JPY"]) {
      expect(ISO_CURRENCY_CODES).toContain(code);
    }
  });

  test("all codes are unique three-letter uppercase strings", () => {
    expect(new Set(ISO_CURRENCY_CODES).size).toBe(ISO_CURRENCY_CODES.length);
    for (const code of ISO_CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  test("pinned codes are a subset of the full list, INR first", () => {
    expect(PINNED_CURRENCY_CODES[0]).toBe("INR");
    for (const code of PINNED_CURRENCY_CODES) {
      expect(ISO_CURRENCY_CODES).toContain(code);
    }
  });

  test("isIsoCurrencyCode validates membership", () => {
    expect(isIsoCurrencyCode("INR")).toBe(true);
    expect(isIsoCurrencyCode("AED")).toBe(true);
    expect(isIsoCurrencyCode("XXX")).toBe(false);
    expect(isIsoCurrencyCode("inr")).toBe(false);
    expect(isIsoCurrencyCode("")).toBe(false);
    expect(isIsoCurrencyCode(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/claims/iso-currency-codes.test.ts`
Expected: FAIL — `Cannot find module '@/core/constants/iso-currency-codes'`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/constants/iso-currency-codes.ts
// Canonical ISO 4217 active currency codes. This list MUST stay in sync with the
// values of the Postgres enum public.foreign_currency_code (see migration
// 20260610090000_expand_foreign_currency_codes.sql).
export const ISO_CURRENCY_CODES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SVC",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
  "ZWG",
] as const;

export type IsoCurrencyCode = (typeof ISO_CURRENCY_CODES)[number];

// Shown at the top of the currency dropdown.
export const PINNED_CURRENCY_CODES: IsoCurrencyCode[] = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "CHF",
  "AED",
  "SGD",
];

const ISO_CURRENCY_CODE_SET: ReadonlySet<string> = new Set(ISO_CURRENCY_CODES);

export function isIsoCurrencyCode(value: unknown): value is IsoCurrencyCode {
  return typeof value === "string" && ISO_CURRENCY_CODE_SET.has(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/claims/iso-currency-codes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/constants/iso-currency-codes.ts tests/unit/claims/iso-currency-codes.test.ts
git commit -m "feat(claims): add canonical ISO 4217 currency code list"
```

---

### Task 2: Receipt normalization module (dates, amounts, currency, confidence)

**Files:**

- Create: `src/modules/claims/actions/receipt-normalization.ts`
- Test: `tests/unit/claims/receipt-normalization.test.ts`

This pure module holds ALL computation the old prompt asked the LLM to do. No `"use server"` directive (it exports sync functions). It must never call `new Date(<string>)`.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
import {
  normalizeTransactionDate,
  resolveCurrencyCode,
  computeReceiptAmounts,
  computeConfidenceScore,
} from "@/modules/claims/actions/receipt-normalization";

// Fixed "today" for deterministic tests: 10 June 2026 (UTC parts).
const TODAY = new Date(Date.UTC(2026, 5, 10));

describe("normalizeTransactionDate", () => {
  test.each([
    ["2026-05-18", "2026-05-18"], // valid ISO
    ["2026-06-10", "2026-06-10"], // today is valid
  ])("accepts %s", (input, expected) => {
    expect(normalizeTransactionDate(input, TODAY)).toBe(expected);
  });

  test.each([
    ["18/05/2026"], // DD/MM string — must NOT be parsed, returns null
    ["05/18/2026"], // US format — must NOT be parsed
    ["18-05-26"], // two-digit year
    ["May 18, 2026"], // prose date
    ["2026-13-01"], // impossible month
    ["2026-02-30"], // impossible day
    ["2026-06-11"], // tomorrow (future)
    ["2024-06-09"], // older than 2 years
    [""],
    [null],
  ])("rejects %s -> null", (input) => {
    expect(normalizeTransactionDate(input as string | null, TODAY)).toBeNull();
  });

  test("leap day is accepted when real", () => {
    expect(normalizeTransactionDate("2024-02-29", new Date(Date.UTC(2025, 1, 1)))).toBe(
      "2024-02-29",
    );
  });
});

describe("resolveCurrencyCode", () => {
  test("valid ISO code passes through uppercased", () => {
    expect(resolveCurrencyCode("aed")).toEqual({ code: "AED", invalidDetected: false });
    expect(resolveCurrencyCode("INR")).toEqual({ code: "INR", invalidDetected: false });
  });

  test("null/empty means no currency detected (not invalid)", () => {
    expect(resolveCurrencyCode(null)).toEqual({ code: null, invalidDetected: false });
    expect(resolveCurrencyCode("  ")).toEqual({ code: null, invalidDetected: false });
  });

  test("unknown code is flagged invalid", () => {
    expect(resolveCurrencyCode("XYZ")).toEqual({ code: null, invalidDetected: true });
    expect(resolveCurrencyCode("RUPEES")).toEqual({ code: null, invalidDetected: true });
  });
});

describe("computeReceiptAmounts", () => {
  test("basic = total - taxes (fees absorbed automatically)", () => {
    const result = computeReceiptAmounts({
      subtotalAmount: 1347,
      feesTotal: 18.4,
      discountTotal: null,
      cgstAmount: null,
      sgstAmount: null,
      igstAmount: null,
      otherTaxTotal: null,
      totalAmount: 1365.4,
    });
    expect(result.basicAmount).toBe(1365.4);
    expect(result.totalAmount).toBe(1365.4);
    expect(result.mathConsistent).toBe(true); // 1347 + 18.40 = 1365.40
  });

  test("GST invoice math", () => {
    const result = computeReceiptAmounts({
      subtotalAmount: 1000,
      feesTotal: null,
      discountTotal: null,
      cgstAmount: 90,
      sgstAmount: 90,
      igstAmount: null,
      otherTaxTotal: null,
      totalAmount: 1180,
    });
    expect(result.basicAmount).toBe(1000);
    expect(result.cgstAmount).toBe(90);
    expect(result.sgstAmount).toBe(90);
    expect(result.igstAmount).toBe(0);
    expect(result.mathConsistent).toBe(true);
  });

  test("inconsistent printed subtotal flags mathConsistent=false but keeps total authority", () => {
    const result = computeReceiptAmounts({
      subtotalAmount: 100,
      feesTotal: null,
      discountTotal: null,
      cgstAmount: 10,
      sgstAmount: null,
      igstAmount: null,
      otherTaxTotal: null,
      totalAmount: 500,
    });
    expect(result.basicAmount).toBe(490); // 500 - 10, computed in code
    expect(result.mathConsistent).toBe(false); // 100 + 10 != 500
  });

  test("rounding tolerance of ±1 is consistent", () => {
    const result = computeReceiptAmounts({
      subtotalAmount: 99.5,
      feesTotal: null,
      discountTotal: null,
      cgstAmount: 9,
      sgstAmount: 9,
      igstAmount: null,
      otherTaxTotal: null,
      totalAmount: 118, // 99.5 + 18 = 117.5, within ±1
    });
    expect(result.mathConsistent).toBe(true);
  });

  test("missing total yields zeros and inconsistent math", () => {
    const result = computeReceiptAmounts({
      subtotalAmount: null,
      feesTotal: null,
      discountTotal: null,
      cgstAmount: null,
      sgstAmount: null,
      igstAmount: null,
      otherTaxTotal: null,
      totalAmount: null,
    });
    expect(result.basicAmount).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.mathConsistent).toBe(false);
  });

  test("negative model values are clamped to 0", () => {
    const result = computeReceiptAmounts({
      subtotalAmount: null,
      feesTotal: null,
      discountTotal: null,
      cgstAmount: -5,
      sgstAmount: null,
      igstAmount: null,
      otherTaxTotal: null,
      totalAmount: 100,
    });
    expect(result.cgstAmount).toBe(0);
    expect(result.basicAmount).toBe(100);
  });
});

describe("computeConfidenceScore", () => {
  const base = {
    mathConsistent: true,
    hasTransactionDate: true,
    hasBillNo: true,
    hasVendorName: true,
    invalidCurrencyDetected: false,
  };

  test("perfect extraction scores 100", () => {
    expect(computeConfidenceScore(base)).toBe(100);
  });

  test("deductions: math 30, date 15, billNo 15, vendor 10, currency 20", () => {
    expect(computeConfidenceScore({ ...base, mathConsistent: false })).toBe(70);
    expect(computeConfidenceScore({ ...base, hasTransactionDate: false })).toBe(85);
    expect(computeConfidenceScore({ ...base, hasBillNo: false })).toBe(85);
    expect(computeConfidenceScore({ ...base, hasVendorName: false })).toBe(90);
    expect(computeConfidenceScore({ ...base, invalidCurrencyDetected: true })).toBe(80);
  });

  test("clamped at 0", () => {
    expect(
      computeConfidenceScore({
        mathConsistent: false,
        hasTransactionDate: false,
        hasBillNo: false,
        hasVendorName: false,
        invalidCurrencyDetected: true,
      }),
    ).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/claims/receipt-normalization.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/claims/actions/receipt-normalization.ts
import { isIsoCurrencyCode } from "@/core/constants/iso-currency-codes";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_DATE_AGE_YEARS = 2;
const MATH_TOLERANCE = 1;

export type ExtractedAmounts = {
  subtotalAmount: number | null;
  feesTotal: number | null;
  discountTotal: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
  otherTaxTotal: number | null;
  totalAmount: number | null;
};

export type ComputedAmounts = {
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  taxTotal: number;
  mathConsistent: boolean;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampAmount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return roundMoney(Math.max(value, 0));
}

/**
 * Strict YYYY-MM-DD validation. Never parses date strings with `new Date(string)`
 * (locale-ambiguous and timezone-shifting). Rejects future dates and dates older
 * than MAX_DATE_AGE_YEARS relative to `today`.
 */
export function normalizeTransactionDate(value: string | null, today: Date): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(ISO_DATE_PATTERN);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Real-calendar round-trip check (UTC avoids DST edge cases; no string parsing).
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const oldestAllowed = Date.UTC(
    today.getUTCFullYear() - MAX_DATE_AGE_YEARS,
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const candidateUtc = candidate.getTime();

  if (candidateUtc > todayUtc || candidateUtc < oldestAllowed) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export type ResolvedCurrency = {
  code: string | null;
  invalidDetected: boolean;
};

export function resolveCurrencyCode(value: string | null): ResolvedCurrency {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { code: null, invalidDetected: false };
  }

  const normalized = value.trim().toUpperCase();
  if (isIsoCurrencyCode(normalized)) {
    return { code: normalized, invalidDetected: false };
  }

  return { code: null, invalidDetected: true };
}

/**
 * basicAmount = totalAmount - (GST taxes). Fees are absorbed into basicAmount by
 * construction. When the document also printed subtotal/fees/discount, cross-check
 * them against the total (±MATH_TOLERANCE) to detect misreads.
 */
export function computeReceiptAmounts(extracted: ExtractedAmounts): ComputedAmounts {
  const cgstAmount = clampAmount(extracted.cgstAmount);
  const sgstAmount = clampAmount(extracted.sgstAmount);
  const igstAmount = clampAmount(extracted.igstAmount);
  const totalAmount = clampAmount(extracted.totalAmount);
  const taxTotal = roundMoney(cgstAmount + sgstAmount + igstAmount);
  const basicAmount = roundMoney(Math.max(totalAmount - taxTotal, 0));

  let mathConsistent = totalAmount > 0;

  if (mathConsistent && extracted.subtotalAmount !== null) {
    const subtotal = clampAmount(extracted.subtotalAmount);
    const fees = clampAmount(extracted.feesTotal);
    const discount = clampAmount(extracted.discountTotal);
    const otherTax = clampAmount(extracted.otherTaxTotal);
    const reconstructed = roundMoney(subtotal + fees + taxTotal + otherTax - discount);
    if (Math.abs(reconstructed - totalAmount) > MATH_TOLERANCE) {
      mathConsistent = false;
    }
  }

  return { basicAmount, cgstAmount, sgstAmount, igstAmount, totalAmount, taxTotal, mathConsistent };
}

export type ConfidenceInputs = {
  mathConsistent: boolean;
  hasTransactionDate: boolean;
  hasBillNo: boolean;
  hasVendorName: boolean;
  invalidCurrencyDetected: boolean;
};

/** Deterministic replacement for the model's self-graded confidence score. */
export function computeConfidenceScore(inputs: ConfidenceInputs): number {
  let score = 100;
  if (!inputs.mathConsistent) score -= 30;
  if (!inputs.hasTransactionDate) score -= 15;
  if (!inputs.hasBillNo) score -= 15;
  if (!inputs.hasVendorName) score -= 10;
  if (inputs.invalidCurrencyDetected) score -= 20;
  return Math.max(0, Math.min(100, score));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/claims/receipt-normalization.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/claims/actions/receipt-normalization.ts tests/unit/claims/receipt-normalization.test.ts
git commit -m "feat(claims): add deterministic receipt normalization (dates, amounts, currency, confidence)"
```

---

### Task 3: SDK swap and model configuration

**Files:**

- Modify: `package.json` (dependency swap via npm)
- Modify: `src/core/config/server-env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Swap the SDK packages**

```bash
npm uninstall @google/generative-ai
npm install @google/genai
```

Expected: `package.json` dependencies now contain `@google/genai` and not `@google/generative-ai`.

- [ ] **Step 2: Add GEMINI_MODEL to server env (defaulted, optional)**

Replace the full contents of `src/core/config/server-env.ts` with:

```ts
import { z } from "zod";
import { clientEnv } from "@/core/config/client-env";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash"),
});

const parsedServerEnv = serverEnvSchema.safeParse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
});

if (!parsedServerEnv.success) {
  throw new Error(`Invalid server environment configuration: ${parsedServerEnv.error.message}`);
}

export const serverEnv = {
  ...clientEnv,
  ...parsedServerEnv.data,
};
```

- [ ] **Step 3: Document the new env var**

In `.env.example`, directly below the existing `GEMINI_API_KEY` line, add:

```bash
# Optional. Gemini model used for receipt parsing. Defaults to gemini-3.5-flash.
GEMINI_MODEL=gemini-3.5-flash
```

- [ ] **Step 4: Verify typecheck (parse-receipt.ts will fail — expected)**

Run: `npm run typecheck`
Expected: errors ONLY in `src/modules/claims/actions/parse-receipt.ts` (imports the removed SDK). Anything else failing is a problem — stop and investigate.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/core/config/server-env.ts .env.example
git commit -m "feat(claims): migrate to @google/genai SDK and configurable GEMINI_MODEL"
```

---

### Task 4: Rewrite parse-receipt.ts (new SDK, enforced schema, code-side computation)

**Files:**

- Modify: `src/modules/claims/actions/parse-receipt.ts` (full rewrite)
- Modify: `tests/unit/claims/parse-receipt.action.test.ts` (full rewrite)

Behavior preserved: exported types/names (`parseReceiptAction`, `ParsedReceiptResult`, `ParseReceiptActionResult`), file validations (25MB, MIME allowlist), 503 retry ×3 with 1s delay, 429 quota messaging with retry-delay extraction, auto-fill gating thresholds, FormData keys.
Behavior changed: model output contract (observed facts only), all math/confidence computed in code, currency = any ISO 4217, `foreignCurrencyCode` widened to `string | null`.

- [ ] **Step 1: Rewrite the test file**

Replace the full contents of `tests/unit/claims/parse-receipt.action.test.ts` with:

```ts
/** @jest-environment node */

const mockGenerateContent = jest.fn();
const mockGoogleGenAI = jest.fn().mockImplementation(() => ({
  models: { generateContent: mockGenerateContent },
}));

class MockApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

jest.mock("@google/genai", () => ({
  GoogleGenAI: mockGoogleGenAI,
  ApiError: MockApiError,
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODEL: "gemini-3.5-flash",
  },
}));

// A "today" far enough after fixture dates. The action uses the real clock; fixture
// dates below are chosen relative to test-run time via dynamic computation.
function isoDaysAgo(days: number): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return utc.toISOString().slice(0, 10);
}

const RECENT_DATE = isoDaysAgo(10);

function extractionPayload(overrides: Record<string, unknown> = {}) {
  return {
    docType: "gst_invoice",
    vendorName: "ACME Supplies",
    billNo: "INV-1001",
    gstNumber: "36ABCDE1234F1Z5",
    dateAsPrinted: "18/05/2026",
    transactionDate: RECENT_DATE,
    currencyCode: "INR",
    subtotalAmount: 1000,
    feesTotal: null,
    discountTotal: null,
    cgstAmount: 90,
    sgstAmount: 90,
    igstAmount: null,
    otherTaxTotal: null,
    totalAmount: 1180,
    categoryName: "Travel Domestic",
    ...overrides,
  };
}

function mockModelResponse(payload: unknown) {
  mockGenerateContent.mockResolvedValue({ text: JSON.stringify(payload) });
}

function createReceiptFormData(
  categoryNames: string[] = ["Travel Domestic", "Internet Expense"],
): FormData {
  const formData = new FormData();
  formData.append(
    "receiptFile",
    new File(["fake receipt payload"], "receipt.pdf", { type: "application/pdf" }),
  );
  for (const categoryName of categoryNames) {
    formData.append("expenseCategoryNames", categoryName);
  }
  return formData;
}

describe("parseReceiptAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("full INR invoice extraction computes amounts in code and auto-fills", async () => {
    mockModelResponse(extractionPayload());

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toBeNull();
    expect(result.data).toEqual({
      billNo: "INV-1001",
      transactionDate: RECENT_DATE,
      vendorName: "ACME Supplies",
      gstNumber: "36ABCDE1234F1Z5",
      basicAmount: 1000, // 1180 - 180, computed in code
      cgstAmount: 90,
      sgstAmount: 90,
      igstAmount: 0,
      totalAmount: 1180,
      category_name: "Travel Domestic",
      confidenceScore: 100,
      foreignCurrencyCode: null,
      foreignBasicAmount: 0,
      foreignGstAmount: 0,
      foreignTotalAmount: 0,
    });
  });

  test("requests the configured model with an enforced response schema", async () => {
    mockModelResponse(extractionPayload());

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    await parseReceiptAction(createReceiptFormData());

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const request = mockGenerateContent.mock.calls[0][0];
    expect(request.model).toBe("gemini-3.5-flash");
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toMatchObject({ type: "object" });
    expect(request.config.temperature).toBe(0);
    expect(request.config.systemInstruction).toContain("ALLOWED CATEGORIES");
    expect(request.config.systemInstruction).toContain("Travel Domestic");
  });

  test("ambiguous non-ISO date from model becomes null (never a guessed date)", async () => {
    mockModelResponse(extractionPayload({ transactionDate: "18/05/2026" }));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.transactionDate).toBeNull();
    // missing critical field -> partial fill message, but data still offered
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toContain("verify");
  });

  test("future date is rejected to null", async () => {
    mockModelResponse(extractionPayload({ transactionDate: isoDaysAgo(-30) }));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.data?.transactionDate).toBeNull();
  });

  test("inconsistent printed amounts lower confidence below threshold -> partial fill", async () => {
    mockModelResponse(
      extractionPayload({
        subtotalAmount: 100,
        cgstAmount: 10,
        sgstAmount: null,
        totalAmount: 500,
      }),
    );

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.basicAmount).toBe(490);
    expect(result.data?.totalAmount).toBe(500);
    expect(result.data?.confidenceScore).toBe(70);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toContain("verify");
  });

  test("foreign currency invoice (any ISO code) maps to foreign fields and zeroes local", async () => {
    mockModelResponse(
      extractionPayload({
        currencyCode: "AED",
        subtotalAmount: 90,
        cgstAmount: null,
        sgstAmount: null,
        igstAmount: null,
        otherTaxTotal: 10,
        totalAmount: 100,
        gstNumber: null,
      }),
    );

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.foreignCurrencyCode).toBe("AED");
    expect(result.data?.foreignTotalAmount).toBe(100);
    expect(result.data?.foreignGstAmount).toBe(10);
    expect(result.data?.foreignBasicAmount).toBe(90);
    expect(result.data?.basicAmount).toBe(0);
    expect(result.data?.totalAmount).toBe(0);
    expect(result.data?.cgstAmount).toBe(0);
  });

  test("unknown currency string is dropped and deducts confidence", async () => {
    mockModelResponse(extractionPayload({ currencyCode: "ZZZ" }));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.data?.foreignCurrencyCode).toBeNull();
    expect(result.data?.confidenceScore).toBe(80);
  });

  test("bank statement mode maps matched debit to basicAmount", async () => {
    mockModelResponse(
      extractionPayload({
        docType: "bank_statement",
        vendorName: "ADOBE SYSTEMS",
        billNo: null,
        gstNumber: null,
        subtotalAmount: null,
        cgstAmount: null,
        sgstAmount: null,
        igstAmount: null,
        totalAmount: 4250.75,
        categoryName: null,
      }),
    );

    const formData = createReceiptFormData([]);
    formData.append("documentType", "bank_statement");
    formData.append("bankStatementMatchVendorName", "Adobe");

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(formData);

    expect(result.ok).toBe(true);
    expect(result.data?.basicAmount).toBe(4250.75);
    expect(result.data?.totalAmount).toBe(0);
    expect(result.data?.cgstAmount).toBe(0);
    expect(result.data?.vendorName).toBe("ADOBE SYSTEMS");
    expect(result.autoFillAllowed).toBe(true);
  });

  test("invalid JSON from model returns friendly fallback", async () => {
    mockGenerateContent.mockResolvedValue({ text: "not json at all" });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(false);
    expect(result.autoFillAllowed).toBe(false);
    expect(result.message).toContain("fill the details manually");
  });

  test("quota error (429) returns quota fallback with retry hint", async () => {
    mockGenerateContent.mockRejectedValue(new MockApiError("Too Many Requests. Retry in 14s", 429));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("usage limits");
    expect(result.message).toContain("14 seconds");
  });

  test("503 retries up to 3 attempts then succeeds", async () => {
    jest.useFakeTimers();
    mockGenerateContent
      .mockRejectedValueOnce(new MockApiError("Service Unavailable", 503))
      .mockRejectedValueOnce(new MockApiError("Service Unavailable", 503))
      .mockResolvedValueOnce({ text: JSON.stringify(extractionPayload()) });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const pending = parseReceiptAction(createReceiptFormData());
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(true);
  });

  test("503 exhaustion returns busy message", async () => {
    jest.useFakeTimers();
    mockGenerateContent.mockRejectedValue(new MockApiError("Service Unavailable", 503));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const pending = parseReceiptAction(createReceiptFormData());
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("busy");
  });

  test("rejects missing file and oversized/wrong-type files", async () => {
    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");

    const empty = new FormData();
    expect((await parseReceiptAction(empty)).message).toBe("Receipt file is required.");

    const wrongType = new FormData();
    wrongType.append("receiptFile", new File(["x"], "x.gif", { type: "image/gif" }));
    expect((await parseReceiptAction(wrongType)).message).toBe(
      "Receipt file must be PDF, JPG, PNG, or WEBP.",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/claims/parse-receipt.action.test.ts`
Expected: FAIL (old implementation still imports `@google/generative-ai`, contract mismatch)

- [ ] **Step 3: Rewrite the implementation**

Replace the full contents of `src/modules/claims/actions/parse-receipt.ts` with:

````ts
"use server";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import {
  computeConfidenceScore,
  computeReceiptAmounts,
  normalizeTransactionDate,
  resolveCurrencyCode,
} from "@/modules/claims/actions/receipt-normalization";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const CONFIDENCE_THRESHOLD = 80;
const EXPENSE_CATEGORY_NAMES_FORM_KEY = "expenseCategoryNames";
const BANK_STATEMENT_MATCH_VENDOR_FORM_KEY = "bankStatementMatchVendorName";
const BANK_STATEMENT_MATCH_DATE_FORM_KEY = "bankStatementMatchTransactionDate";
const BANK_STATEMENT_MATCH_BILL_NO_FORM_KEY = "bankStatementMatchBillNo";
const BANK_STATEMENT_MATCH_FOREIGN_CURRENCY_FORM_KEY = "bankStatementMatchForeignCurrencyCode";
const BANK_STATEMENT_MATCH_FOREIGN_TOTAL_FORM_KEY = "bankStatementMatchForeignTotalAmount";
const BANK_STATEMENT_MATCH_CATEGORY_FORM_KEY = "bankStatementMatchCategoryName";
const GENERIC_PARSE_FALLBACK_MESSAGE =
  "AI could not read the text formatting in this document. Please fill the details manually.";
const GEMINI_QUOTA_FALLBACK_PREFIX =
  "AI auto-parse is temporarily unavailable due to usage limits.";
const GEMINI_SERVICE_BUSY_MESSAGE =
  "The AI service is currently busy. Please try again or fill the form manually.";
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_DELAY_MS = 1_000;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// ---------------------------------------------------------------------------
// Extraction contract: the model reports OBSERVED values only. All math,
// date validation, currency validation, and confidence are computed in code
// (see receipt-normalization.ts).
// ---------------------------------------------------------------------------

const looseNullableNumber = z.any().transform((val): number | null => {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === "string") {
    const parsed = parseFloat(val.replace(/,/g, ""));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
});

const looseNullableString = z.any().transform((val): string | null => {
  if (val === null || val === undefined) {
    return null;
  }
  const text = typeof val === "string" ? val : String(val);
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
});

const geminiExtractionSchema = z.object({
  docType: looseNullableString,
  vendorName: looseNullableString,
  billNo: looseNullableString,
  gstNumber: looseNullableString.optional(),
  dateAsPrinted: looseNullableString.optional(),
  transactionDate: looseNullableString,
  currencyCode: looseNullableString,
  subtotalAmount: looseNullableNumber.optional(),
  feesTotal: looseNullableNumber.optional(),
  discountTotal: looseNullableNumber.optional(),
  cgstAmount: looseNullableNumber.optional(),
  sgstAmount: looseNullableNumber.optional(),
  igstAmount: looseNullableNumber.optional(),
  otherTaxTotal: looseNullableNumber.optional(),
  totalAmount: looseNullableNumber,
  categoryName: looseNullableString.optional(),
});

type GeminiExtraction = z.infer<typeof geminiExtractionSchema>;

const DOC_TYPES = [
  "food_delivery",
  "ride_hailing",
  "gst_invoice",
  "receipt",
  "bank_statement",
  "other",
] as const;

// Standard JSON Schema enforced by Gemini constrained decoding. Every field is
// required so the model must explicitly emit null for unknowns.
const EXTRACTION_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    docType: { type: "string", enum: [...DOC_TYPES] },
    vendorName: { type: ["string", "null"] },
    billNo: { type: ["string", "null"] },
    gstNumber: { type: ["string", "null"] },
    dateAsPrinted: { type: ["string", "null"] },
    transactionDate: {
      type: ["string", "null"],
      description: "YYYY-MM-DD only",
    },
    currencyCode: { type: ["string", "null"], description: "ISO 4217 alpha-3 code" },
    subtotalAmount: { type: ["number", "null"] },
    feesTotal: { type: ["number", "null"] },
    discountTotal: { type: ["number", "null"] },
    cgstAmount: { type: ["number", "null"] },
    sgstAmount: { type: ["number", "null"] },
    igstAmount: { type: ["number", "null"] },
    otherTaxTotal: { type: ["number", "null"] },
    totalAmount: { type: ["number", "null"] },
    categoryName: { type: ["string", "null"] },
  },
  required: [
    "docType",
    "vendorName",
    "billNo",
    "gstNumber",
    "dateAsPrinted",
    "transactionDate",
    "currencyCode",
    "subtotalAmount",
    "feesTotal",
    "discountTotal",
    "cgstAmount",
    "sgstAmount",
    "igstAmount",
    "otherTaxTotal",
    "totalAmount",
    "categoryName",
  ],
} as const;

function sanitizeCategoryName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractAllowedCategoryNames(input: FormData): string[] {
  const entries = input.getAll(EXPENSE_CATEGORY_NAMES_FORM_KEY);
  const uniqueNames: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const sanitized = sanitizeCategoryName(entry);
    if (!sanitized) {
      continue;
    }
    const dedupeKey = sanitized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    uniqueNames.push(sanitized);
  }

  return uniqueNames;
}

type BankStatementMatchContext = {
  vendorName: string | null;
  transactionDate: string | null;
  billNo: string | null;
  foreignCurrencyCode: string | null;
  foreignTotalAmount: number | null;
  categoryName: string | null;
};

function getFormDataNullableString(input: FormData, key: string): string | null {
  const value = input.get(key);
  return sanitizeCategoryName(value);
}

function getFormDataNullableNumber(input: FormData, key: string): number | null {
  const value = input.get(key);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractBankStatementMatchContext(input: FormData): BankStatementMatchContext {
  return {
    vendorName: getFormDataNullableString(input, BANK_STATEMENT_MATCH_VENDOR_FORM_KEY),
    transactionDate: getFormDataNullableString(input, BANK_STATEMENT_MATCH_DATE_FORM_KEY),
    billNo: getFormDataNullableString(input, BANK_STATEMENT_MATCH_BILL_NO_FORM_KEY),
    foreignCurrencyCode: getFormDataNullableString(
      input,
      BANK_STATEMENT_MATCH_FOREIGN_CURRENCY_FORM_KEY,
    ),
    foreignTotalAmount: getFormDataNullableNumber(
      input,
      BANK_STATEMENT_MATCH_FOREIGN_TOTAL_FORM_KEY,
    ),
    categoryName: getFormDataNullableString(input, BANK_STATEMENT_MATCH_CATEGORY_FORM_KEY),
  };
}

function buildInvoiceSystemInstruction(allowedCategoryNames: string[]): string {
  const categoryBlock =
    allowedCategoryNames.length > 0
      ? `ALLOWED CATEGORIES (exact strings, pick the single best semantic match or null):\n${allowedCategoryNames.map((name) => `- ${name}`).join("\n")}`
      : `ALLOWED CATEGORIES: none provided — categoryName MUST be null.`;

  return `
ROLE:
You are a high-precision financial document READER for an expense claims system.
You report values exactly as printed. You never calculate, estimate, or guess.
Documents may be Indian app screenshots (Swiggy, Zomato, Uber, Ola, Rapido, Porter),
GST tax invoices, hotel folios, retail receipts, or foreign invoices. They may be
blurry, rotated, cropped, or partial.

TASK:
Report ONLY what is visibly printed in the document. If a value is not clearly
and unambiguously visible, return null for it. Null is always better than a guess.

FIELDS:
- docType: classify the document:
  food_delivery (Swiggy/Zomato/UberEats-style), ride_hailing (Uber/Ola/Rapido/
  Porter/taxi/courier), gst_invoice (formal tax invoice with GST details),
  receipt (any other bill/receipt), bank_statement, other.
- vendorName: the issuing brand/company name.
- billNo: Invoice No / Bill No / Receipt No / Order ID / Booking ID. For ride or
  delivery apps prefer a bill/invoice/order identifier; use Trip ID / Ride ID only
  when no bill-style identifier exists. Copy the FULL token verbatim, including
  any leading # and hyphens (e.g. "#RD17766973787873583").
- gstNumber: the seller GST registration number, only if printed. Never invent.
- dateAsPrinted: the transaction/invoice date EXACTLY as printed, verbatim
  (e.g. "18/05/26", "May 18, 2026"). This is an audit trail.
- transactionDate: that same date converted to YYYY-MM-DD. IMPORTANT: Indian
  documents print dates as day/month/year — "05/06/2026" means 5 June 2026.
  If the date order is genuinely ambiguous and cannot be resolved from context
  (month names, other dates on the document), return null.
- currencyCode: ISO 4217 code of the document's currency. Map symbols:
  ₹ / Rs / INR → INR; $ → USD unless prefixed (A$ → AUD, S$ → SGD, C$ → CAD);
  € → EUR; £ → GBP; ¥ → JPY or CNY by context; د.إ / AED → AED; Fr/CHF → CHF.
  Return the code for ANY world currency. If no currency is identifiable → null.
- Amounts: plain numbers, no symbols, no thousands separators. null when that
  line is not printed. NEVER compute a missing value from other values.
  - subtotalAmount: item/sub total before fees and taxes.
  - feesTotal: sum of printed platform/delivery/service/convenience/packaging fees.
  - discountTotal: printed discounts/coupons/promotions. NOT wallet or payment
    adjustments.
  - cgstAmount, sgstAmount, igstAmount: printed GST line amounts.
  - otherTaxTotal: non-GST taxes (VAT, sales tax, service tax) summed.
  - totalAmount: the FINAL payable amount BEFORE wallet credits, cashback, or
    payment splitting. Food apps: "Grand Total" / "Total Bill" before wallet
    adjustment. Ride apps: "Total Fare" / "Trip Fare" / "Amount Charged".
- categoryName: best semantic match from the allowed list below (hotel → lodging,
  ride/flight → travel, restaurant/food delivery → meals, etc.). Must be an EXACT
  string from the list, or null when no strong match.

${categoryBlock}

OUTPUT:
A single JSON object matching the response schema. Every field present; use null
for anything not clearly printed.
`;
}

function buildBankStatementSystemInstruction(matchContext: BankStatementMatchContext): string {
  const contextLines = [
    matchContext.vendorName ? `- Expected vendor or merchant: ${matchContext.vendorName}` : null,
    matchContext.transactionDate
      ? `- Expected invoice/transaction date: ${matchContext.transactionDate}`
      : null,
    matchContext.billNo ? `- Expected bill or reference number: ${matchContext.billNo}` : null,
    matchContext.categoryName ? `- Expected expense category: ${matchContext.categoryName}` : null,
    matchContext.foreignCurrencyCode && matchContext.foreignTotalAmount !== null
      ? `- Foreign invoice total for reference only: ${matchContext.foreignCurrencyCode} ${matchContext.foreignTotalAmount.toFixed(2)}`
      : null,
  ].filter((line): line is string => line !== null);

  const matchContextBlock =
    contextLines.length > 0
      ? contextLines.join("\n")
      : "- No external match hints were provided. Use the statement content only.";

  return `
ROLE:
You are a financial document reader specializing in bank statements.

GOAL:
Find the single settled INR debit/deduction that best matches the expense claim,
and report it. Do not calculate anything; report printed values only.

MATCH HINTS:
${matchContextBlock}

SELECTION RULES:
- Consider debit, withdrawal, card charge, UPI spend, or spent rows only.
- Never choose credits, refunds, reversals, chargebacks, cashback, deposits,
  opening/closing balances, or pending authorization holds.
- If several INR amounts appear, rank candidates by: vendor/merchant descriptor
  similarity, date proximity to the expected invoice date, reference/identifier
  similarity, narration relevance, and (if a foreign total hint exists)
  reasonableness of the INR amount allowing normal FX variance and bank fees.
- Prefer the final settled debit over duplicate pending lines.

OUTPUT MAPPING (single JSON object matching the response schema):
- docType: "bank_statement"
- totalAmount: the matched settled INR debit amount.
- transactionDate: the matched statement line date as YYYY-MM-DD (statements may
  print day/month/year order — "05/06/2026" means 5 June 2026); null if unclear.
- dateAsPrinted: that date exactly as printed.
- vendorName: the matched merchant descriptor, if clear.
- billNo: a transaction/reference identifier from the matched line, if clearly
  printed; else null.
- currencyCode: "INR".
- All other fields (gstNumber, subtotalAmount, feesTotal, discountTotal,
  cgstAmount, sgstAmount, igstAmount, otherTaxTotal, categoryName): null.
`;
}

export type ParsedReceiptResult = {
  billNo: string | null;
  transactionDate: string | null;
  vendorName: string | null;
  gstNumber: string | null;
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  category_name: string | null;
  confidenceScore: number;
  foreignCurrencyCode: string | null;
  foreignBasicAmount: number;
  foreignGstAmount: number;
  foreignTotalAmount: number;
};

export type ParseReceiptActionResult = {
  ok: boolean;
  data: ParsedReceiptResult | null;
  autoFillAllowed: boolean;
  message: string | null;
};

function safeParseJSON(aiResponseText: string): unknown | null {
  try {
    const cleanText = aiResponseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const normalized = cleanText.replace(/\\u(?![0-9a-fA-F]{4})/g, "");
    const match = normalized.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error("No JSON object found in AI response.");
    }

    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

type GeminiErrorShape = {
  status?: number;
  statusText?: string;
  message?: string;
  errorDetails?: unknown;
};

function asGeminiErrorShape(error: unknown): GeminiErrorShape {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  return error as GeminiErrorShape;
}

function parseRetrySeconds(input: string): number | null {
  const value = input.trim();
  const durationMatch = value.match(/^(\d+(?:\.\d+)?)s$/i);

  if (durationMatch && durationMatch[1]) {
    const parsed = Number.parseFloat(durationMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const sentenceMatch = value.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s?/i);
  if (sentenceMatch && sentenceMatch[1]) {
    const parsed = Number.parseFloat(sentenceMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function extractRetryDelaySeconds(error: unknown): number | null {
  const geminiError = asGeminiErrorShape(error);
  const details = Array.isArray(geminiError.errorDetails) ? geminiError.errorDetails : [];

  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) {
      continue;
    }
    const retryDelay = (detail as { retryDelay?: unknown }).retryDelay;
    if (typeof retryDelay !== "string") {
      continue;
    }
    const parsed = parseRetrySeconds(retryDelay);
    if (parsed !== null) {
      return parsed;
    }
  }

  if (typeof geminiError.message === "string") {
    return parseRetrySeconds(geminiError.message);
  }

  return null;
}

function isGeminiQuotaError(error: unknown): boolean {
  const geminiError = asGeminiErrorShape(error);

  if (geminiError.status === 429) {
    return true;
  }

  const lowerStatusText = (geminiError.statusText ?? "").toLowerCase();
  const lowerMessage = (geminiError.message ?? "").toLowerCase();

  return (
    lowerStatusText.includes("too many requests") ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("quota exceeded") ||
    lowerMessage.includes("rate limit")
  );
}

function isGeminiServiceUnavailableError(error: unknown): boolean {
  const geminiError = asGeminiErrorShape(error);

  if (geminiError.status === 503) {
    return true;
  }

  const lowerStatusText = (geminiError.statusText ?? "").toLowerCase();
  const lowerMessage = (geminiError.message ?? "").toLowerCase();

  return (
    lowerStatusText.includes("service unavailable") || lowerMessage.includes("service unavailable")
  );
}

function waitForMilliseconds(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function generateGeminiContentWithRetry(
  client: GoogleGenAI,
  systemInstruction: string,
  mimeType: string,
  base64Payload: string,
): Promise<{ text: string | undefined }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await client.models.generateContent({
        model: serverEnv.GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Payload,
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: EXTRACTION_RESPONSE_JSON_SCHEMA,
        },
      });
    } catch (error) {
      if (!isGeminiServiceUnavailableError(error)) {
        throw error;
      }

      lastError = error;

      if (attempt === GEMINI_MAX_ATTEMPTS) {
        break;
      }

      logger.warn("claims.parse_receipt.service_unavailable_retry", {
        attempt,
        maxAttempts: GEMINI_MAX_ATTEMPTS,
        retryDelayMs: GEMINI_RETRY_DELAY_MS,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : "Gemini service unavailable. Retrying request.",
      });

      await waitForMilliseconds(GEMINI_RETRY_DELAY_MS);
    }
  }

  throw lastError ?? new Error("Gemini service unavailable");
}

function getQuotaExceededMessage(error: unknown): string {
  const retryDelaySeconds = extractRetryDelaySeconds(error);
  const retryHint =
    retryDelaySeconds !== null
      ? ` Please retry in about ${Math.ceil(retryDelaySeconds)} seconds.`
      : " Please try again shortly.";

  return `${GEMINI_QUOTA_FALLBACK_PREFIX}${retryHint} You can still fill the details manually.`;
}

function buildParsedReceiptResult(
  extraction: GeminiExtraction,
  documentType: "invoice" | "bank_statement",
  now: Date,
): { result: ParsedReceiptResult; mathConsistent: boolean } {
  const transactionDate = normalizeTransactionDate(extraction.transactionDate, now);
  const currency = resolveCurrencyCode(extraction.currencyCode);
  const amounts = computeReceiptAmounts({
    subtotalAmount: extraction.subtotalAmount ?? null,
    feesTotal: extraction.feesTotal ?? null,
    discountTotal: extraction.discountTotal ?? null,
    cgstAmount: extraction.cgstAmount ?? null,
    sgstAmount: extraction.sgstAmount ?? null,
    igstAmount: extraction.igstAmount ?? null,
    otherTaxTotal: extraction.otherTaxTotal ?? null,
    totalAmount: extraction.totalAmount ?? null,
  });

  const base: ParsedReceiptResult = {
    billNo: extraction.billNo,
    transactionDate,
    vendorName: extraction.vendorName,
    gstNumber: extraction.gstNumber ?? null,
    basicAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    totalAmount: 0,
    category_name: extraction.categoryName ?? null,
    confidenceScore: 0,
    foreignCurrencyCode: null,
    foreignBasicAmount: 0,
    foreignGstAmount: 0,
    foreignTotalAmount: 0,
  };

  if (documentType === "bank_statement") {
    // Business rule: the matched settled INR debit lands in basicAmount;
    // totalAmount and taxes stay 0 (finance fills the rest).
    base.basicAmount = amounts.totalAmount;
    base.category_name = null;
  } else if (currency.code !== null && currency.code !== "INR") {
    // Foreign invoice: amounts live in foreign fields; local INR fields stay 0
    // (finance converts at settlement). otherTaxTotal counts as foreign tax.
    const foreignTax =
      Math.round((amounts.taxTotal + Math.max(extraction.otherTaxTotal ?? 0, 0)) * 100) / 100;
    base.foreignCurrencyCode = currency.code;
    base.foreignTotalAmount = amounts.totalAmount;
    base.foreignGstAmount = foreignTax;
    base.foreignBasicAmount = Math.max(
      Math.round((amounts.totalAmount - foreignTax) * 100) / 100,
      0,
    );
  } else {
    base.basicAmount = amounts.basicAmount;
    base.cgstAmount = amounts.cgstAmount;
    base.sgstAmount = amounts.sgstAmount;
    base.igstAmount = amounts.igstAmount;
    base.totalAmount = amounts.totalAmount;
  }

  base.confidenceScore = computeConfidenceScore({
    mathConsistent: amounts.mathConsistent,
    hasTransactionDate: transactionDate !== null,
    hasBillNo: documentType === "bank_statement" ? true : base.billNo !== null,
    hasVendorName: base.vendorName !== null,
    invalidCurrencyDetected: currency.invalidDetected,
  });

  return { result: base, mathConsistent: amounts.mathConsistent };
}

export async function parseReceiptAction(input: FormData): Promise<ParseReceiptActionResult> {
  const fileEntry = input.get("receiptFile");
  const documentType =
    input.get("documentType") === "bank_statement" ? "bank_statement" : "invoice";
  const allowedCategoryNames = documentType === "invoice" ? extractAllowedCategoryNames(input) : [];
  const geminiInstruction =
    documentType === "bank_statement"
      ? buildBankStatementSystemInstruction(extractBankStatementMatchContext(input))
      : buildInvoiceSystemInstruction(allowedCategoryNames);

  try {
    const receiptFile = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

    if (!receiptFile) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Receipt file is required.",
      };
    }

    if (receiptFile.size > MAX_FILE_SIZE_BYTES) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Receipt file exceeds 25MB.",
      };
    }

    if (!ALLOWED_UPLOAD_MIME_TYPES.has(receiptFile.type)) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Receipt file must be PDF, JPG, PNG, or WEBP.",
      };
    }

    const buffer = Buffer.from(await receiptFile.arrayBuffer());
    const client = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
    const generationResult = await generateGeminiContentWithRetry(
      client,
      geminiInstruction,
      receiptFile.type,
      buffer.toString("base64"),
    );

    const modelText = generationResult.text;
    if (!modelText || modelText.trim().length === 0) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Could not auto-read receipt. Please fill manually.",
      };
    }

    let parsedJson = safeParseJSON(modelText);
    if (!parsedJson) {
      logger.warn("claims.parse_receipt.invalid_json_payload", {
        errorName: "AIParseError",
        errorMessage: "Gemini output could not be parsed as JSON.",
      });

      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: GENERIC_PARSE_FALLBACK_MESSAGE,
      };
    }

    if (Array.isArray(parsedJson)) {
      parsedJson = parsedJson[0];
    }
    if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
      parsedJson = {};
    }

    const parsedSchemaResult = geminiExtractionSchema.safeParse(parsedJson);

    if (!parsedSchemaResult.success) {
      logger.warn("claims.parse_receipt.validation_failed", {
        errorName: parsedSchemaResult.error.name,
        errorMessage: parsedSchemaResult.error.issues[0]?.message ?? "Invalid parser output.",
      });
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: GENERIC_PARSE_FALLBACK_MESSAGE,
      };
    }

    const { result: normalized } = buildParsedReceiptResult(
      parsedSchemaResult.data,
      documentType,
      new Date(),
    );

    const hasPartialData =
      documentType === "bank_statement"
        ? normalized.basicAmount > 0 ||
          normalized.vendorName !== null ||
          normalized.transactionDate !== null ||
          normalized.billNo !== null
        : normalized.vendorName !== null ||
          normalized.totalAmount > 0 ||
          normalized.foreignTotalAmount > 0 ||
          normalized.transactionDate !== null ||
          normalized.billNo !== null;
    const hasMissingCriticalFields =
      documentType === "bank_statement"
        ? normalized.basicAmount === 0
        : (normalized.totalAmount === 0 && normalized.foreignTotalAmount === 0) ||
          normalized.transactionDate === null ||
          normalized.billNo === null;

    let autoFillAllowed: boolean;
    let message: string | null;

    if (normalized.confidenceScore >= CONFIDENCE_THRESHOLD && !hasMissingCriticalFields) {
      autoFillAllowed = true;
      message = null;
    } else if (hasPartialData) {
      autoFillAllowed = true;
      message = "Extracted partial data. Please verify and fill the missing fields manually.";
    } else {
      autoFillAllowed = false;
      message = "Low confidence parse. Please fill manually.";
    }

    return {
      ok: true,
      data: normalized,
      autoFillAllowed,
      message,
    };
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      const retryDelaySeconds = extractRetryDelaySeconds(error);
      logger.warn("claims.parse_receipt.rate_limited", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : "Gemini request failed due to rate limiting.",
        retryDelaySeconds,
      });

      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: getQuotaExceededMessage(error),
      };
    }

    if (isGeminiServiceUnavailableError(error)) {
      logger.warn("claims.parse_receipt.service_unavailable", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Gemini request failed with service unavailable.",
        maxAttempts: GEMINI_MAX_ATTEMPTS,
      });

      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: GEMINI_SERVICE_BUSY_MESSAGE,
      };
    }

    logger.error("claims.parse_receipt.failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unexpected parse receipt failure.",
    });
    return {
      ok: false,
      data: null,
      autoFillAllowed: false,
      message: GENERIC_PARSE_FALLBACK_MESSAGE,
    };
  }
}
````

Note on the confidence call: for bank statements `hasBillNo` is forced `true` because statement lines legitimately have no bill number; penalizing it would block every statement match.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/claims/parse-receipt.action.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/claims/actions/parse-receipt.ts tests/unit/claims/parse-receipt.action.test.ts
git commit -m "feat(claims): schema-enforced Gemini extraction with code-side math, dates, currency, confidence"
```

---

### Task 5: Widen currency types across form, validators, contracts

**Files:**

- Modify: `src/modules/claims/ui/new-claim-form-client.tsx:76` (type), `:911-919` (AI code validation), `:2008-2014` (dropdown)
- Modify: `src/modules/claims/validators/new-claim-schema.ts:95`
- Modify: `src/modules/claims/validators/own-edit-schema.ts:86`
- Modify: `src/modules/claims/validators/finance-edit-schema.ts:57`
- Modify: `src/core/domain/claims/contracts.ts:64,129,179,216`
- Modify: `src/modules/claims/ui/claim-full-details-grid.tsx:29`
- Modify: `src/app/(dashboard)/dashboard/claims/[id]/page.tsx:363-365`
- Modify: `src/types/database.ts:1642`

- [ ] **Step 1: Widen the form type and dropdown**

In `new-claim-form-client.tsx` line 76, change:

```ts
foreignCurrencyCode: "INR" | "USD" | "EUR" | "CHF";
```

to:

```ts
foreignCurrencyCode: string;
```

Replace lines 911–919 (the `VALID_FOREIGN_CODES` block inside `applyParsedReceiptToForm`) with:

```ts
const rawCode =
  typeof parsed.foreignCurrencyCode === "string" ? parsed.foreignCurrencyCode.toUpperCase() : null;
const foreignCurrencyCode = rawCode && isIsoCurrencyCode(rawCode) ? rawCode : null;
```

Add to the imports at the top of the file:

```ts
import {
  ISO_CURRENCY_CODES,
  PINNED_CURRENCY_CODES,
  isIsoCurrencyCode,
} from "@/core/constants/iso-currency-codes";
```

Replace the dropdown options (lines 2010–2013, the four `<option>` lines inside the existing `<FormSelect ... {...register("expense.foreignCurrencyCode")}>`) with:

```tsx
{
  PINNED_CURRENCY_CODES.map((code) => (
    <option key={code} value={code}>
      {code}
    </option>
  ));
}
<option value="" disabled>
  ──────────
</option>;
{
  ISO_CURRENCY_CODES.filter((code) => !PINNED_CURRENCY_CODES.includes(code)).map((code) => (
    <option key={code} value={code}>
      {code}
    </option>
  ));
}
```

- [ ] **Step 2: Widen the three Zod validators**

In each of `new-claim-schema.ts:95`, `own-edit-schema.ts:86`, `finance-edit-schema.ts:57`, replace:

```ts
    foreignCurrencyCode: z.enum(["INR", "USD", "EUR", "CHF"]).default("INR"),
```

with:

```ts
    foreignCurrencyCode: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine(isIsoCurrencyCode, { message: "Invalid currency code." })
      .default("INR"),
```

and add to each file's imports:

```ts
import { isIsoCurrencyCode } from "@/core/constants/iso-currency-codes";
```

The existing cross-field refinements (`foreignCurrencyCode !== "INR" ⇒ foreignBasicAmount > 0`) compare against the string "INR" and continue to work unchanged.

- [ ] **Step 3: Widen domain contracts and read-side types**

- `src/core/domain/claims/contracts.ts` lines 64, 129, 179, 216 — change each
  `foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;` to
  `foreignCurrencyCode?: string | null;`
- `src/modules/claims/ui/claim-full-details-grid.tsx:29` — same change.
- `src/app/(dashboard)/dashboard/claims/[id]/page.tsx:363-365` — replace the cast
  `(claim.expense.foreignCurrencyCode as "INR" | "USD" | "EUR" | "CHF" | null) ?? ...`
  with `claim.expense.foreignCurrencyCode ?? ...` (keep the surrounding expression).
- `src/types/database.ts:1642` — change
  `foreign_currency_code: "INR" | "USD" | "EUR" | "CHF";` to
  `foreign_currency_code: string;`
  Leave the `Constants` array at line 1778 untouched (display constant from codegen;
  verify with `npx tsc --noEmit` that nothing validates against it — if something
  does, widen that call site instead of the constant).

- [ ] **Step 4: Typecheck, lint, full unit suite**

Run: `npm run typecheck`
Expected: clean. If errors remain that reference the old 4-currency union, widen those exact sites to `string | null` the same way.

Run: `npm run lint`
Expected: clean.

Run: `npm run test:unit`
Expected: PASS. If validator tests (e.g. own-edit/finance-edit/new-claim schema tests) assert rejection of now-valid codes like "GBP", update those assertions to use a genuinely invalid code ("ZZZ") instead.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(claims): accept any ISO 4217 foreign currency across form, validators, and contracts"
```

---

### Task 6: Database migration — extend the foreign_currency_code enum

**Files:**

- Create: `supabase/migrations/20260610090000_expand_foreign_currency_codes.sql`
- Create: `supabase/rollbacks/20260610090000_expand_foreign_currency_codes_rollback.sql`

The column `expense_details.foreign_currency_code` uses Postgres enum `public.foreign_currency_code` (created in `20260518123723_20260518123552_expense_details_foreign_currency.sql`). RPC functions cast to it by name, so **extending** the enum requires zero RPC changes.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260610090000_expand_foreign_currency_codes.sql
-- Expand public.foreign_currency_code from {INR, USD, EUR, CHF} to all active
-- ISO 4217 codes. MUST stay in sync with ISO_CURRENCY_CODES in
-- src/core/constants/iso-currency-codes.ts.
-- ALTER TYPE ... ADD VALUE is allowed in a transaction on PG >= 12 as long as
-- the new values are not used in the same transaction.

DO $$
DECLARE
  code text;
BEGIN
  FOREACH code IN ARRAY ARRAY[
    'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
    'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL',
    'BSD','BTN','BWP','BYN','BZD','CAD','CDF','CLP','CNY',
    'COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP',
    'ERN','ETB','FJD','FKP','GBP','GEL','GHS','GIP','GMD',
    'GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS',
    'IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF',
    'KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL',
    'LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR',
    'MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR',
    'NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR',
    'RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD',
    'SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB',
    'TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX',
    'UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XOF',
    'XPF','YER','ZAR','ZMW','ZWG'
  ]
  LOOP
    EXECUTE format(
      'ALTER TYPE public.foreign_currency_code ADD VALUE IF NOT EXISTS %L',
      code
    );
  END LOOP;
END
$$;
```

(The array intentionally omits INR, USD, EUR, CHF — they already exist; `IF NOT EXISTS` would tolerate them anyway.)

- [ ] **Step 2: Write the rollback**

```sql
-- supabase/rollbacks/20260610090000_expand_foreign_currency_codes_rollback.sql
-- Postgres cannot drop enum values; recreate the narrow type instead.
-- SAFE ONLY when no expense_details row uses a code outside the original four —
-- the guard below aborts otherwise.

DO $$
DECLARE
  offending_count bigint;
BEGIN
  SELECT count(*)
    INTO offending_count
    FROM public.expense_details
   WHERE foreign_currency_code::text NOT IN ('INR', 'USD', 'EUR', 'CHF');

  IF offending_count > 0 THEN
    RAISE EXCEPTION
      'Cannot roll back foreign_currency_code expansion: % row(s) use expanded codes',
      offending_count;
  END IF;
END
$$;

ALTER TABLE public.expense_details
  ALTER COLUMN foreign_currency_code DROP DEFAULT;

ALTER TYPE public.foreign_currency_code RENAME TO foreign_currency_code_expanded;

CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');

ALTER TABLE public.expense_details
  ALTER COLUMN foreign_currency_code
  TYPE public.foreign_currency_code
  USING foreign_currency_code::text::public.foreign_currency_code;

ALTER TABLE public.expense_details
  ALTER COLUMN foreign_currency_code
  SET DEFAULT 'INR'::public.foreign_currency_code;

DROP TYPE public.foreign_currency_code_expanded;
```

Before finalizing the rollback, confirm the exact table name and default by checking `supabase/migrations/20260518123723_20260518123552_expense_details_foreign_currency.sql` lines 60–80 (the ADD COLUMN statement shows the table and `NOT NULL DEFAULT 'INR'`). Adjust table name if it differs from `public.expense_details`.

- [ ] **Step 3: Dry-run, then apply locally**

Run: `npm run db:migrate:dry-run`
Expected: the new migration is listed as pending, no errors.

Run: `npm run db:migrate`
Expected: applies cleanly.

Verify: ask Supabase for the enum values:

```sql
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'foreign_currency_code'
ORDER BY enumlabel;
```

Expected: ~155 labels including AED, GBP, SGD, plus the original four.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260610090000_expand_foreign_currency_codes.sql supabase/rollbacks/20260610090000_expand_foreign_currency_codes_rollback.sql
git commit -m "feat(db): expand foreign_currency_code enum to all ISO 4217 codes"
```

---

### Task 7: Eval harness over real sample documents

**Files:**

- Create: `tests/integration/receipt-parser-eval.test.ts`
- Create: `tests/fixtures/receipts/README.md`

The harness auto-skips when fixtures or the API key are missing, so CI stays green until samples are added.

- [ ] **Step 1: Write the fixtures README**

````markdown
# Receipt parser eval fixtures

Drop real sample documents here (PDF/JPG/PNG/WEBP) plus an `expected.json`
describing the ground truth. The eval test auto-skips when this folder has no
`expected.json` or when `GEMINI_API_KEY` is not set.

`expected.json` format (only assert the fields you care about):

```json
[
  {
    "file": "swiggy-dinner.jpg",
    "categoryNames": ["Meals", "Travel Domestic"],
    "expect": {
      "transactionDate": "2026-06-01",
      "totalAmount": 1365.4,
      "foreignCurrencyCode": null,
      "vendorName": "Swiggy"
    }
  },
  {
    "file": "hdfc-statement.pdf",
    "documentType": "bank_statement",
    "matchHints": { "bankStatementMatchVendorName": "Adobe" },
    "expect": { "basicAmount": 4250.75 }
  }
]
```

Run with:

```powershell
node --env-file=.env.local node_modules/jest/bin/jest.js --testPathPatterns=tests/integration/receipt-parser-eval --runInBand
```
````

- [ ] **Step 2: Write the eval test**

```ts
/** @jest-environment node */
// Live eval against real Gemini using real sample documents.
// Auto-skips when fixtures or GEMINI_API_KEY are absent.
import fs from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures", "receipts");
const EXPECTED_PATH = path.join(FIXTURES_DIR, "expected.json");
const RUNNABLE = fs.existsSync(EXPECTED_PATH) && Boolean(process.env.GEMINI_API_KEY);

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

type Sample = {
  file: string;
  documentType?: "bank_statement";
  categoryNames?: string[];
  matchHints?: Record<string, string>;
  expect: Record<string, string | number | null>;
};

const describeEval = RUNNABLE ? describe : describe.skip;

describeEval("receipt parser eval (live Gemini)", () => {
  jest.setTimeout(300_000);

  test("extracts expected fields from real sample documents", async () => {
    const samples: Sample[] = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));
    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");

    const rows: Array<Record<string, unknown>> = [];
    let checks = 0;
    let hits = 0;

    for (const sample of samples) {
      const filePath = path.join(FIXTURES_DIR, sample.file);
      const mime = MIME_BY_EXT[path.extname(sample.file).toLowerCase()];
      const buffer = fs.readFileSync(filePath);

      const formData = new FormData();
      formData.append("receiptFile", new File([buffer], sample.file, { type: mime }));
      for (const name of sample.categoryNames ?? []) {
        formData.append("expenseCategoryNames", name);
      }
      if (sample.documentType === "bank_statement") {
        formData.append("documentType", "bank_statement");
      }
      for (const [key, value] of Object.entries(sample.matchHints ?? {})) {
        formData.append(key, value);
      }

      const result = await parseReceiptAction(formData);

      for (const [field, expectedValue] of Object.entries(sample.expect)) {
        checks += 1;
        const actual = (result.data as Record<string, unknown> | null)?.[field] ?? null;
        const ok = actual === expectedValue;
        if (ok) hits += 1;
        rows.push({ file: sample.file, field, expected: expectedValue, actual, ok });
      }
    }

    // eslint-disable-next-line no-console
    console.table(rows);
    const accuracy = checks === 0 ? 1 : hits / checks;
    // eslint-disable-next-line no-console
    console.log(`Field accuracy: ${(accuracy * 100).toFixed(1)}% (${hits}/${checks})`);

    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });
});
```

- [ ] **Step 3: Verify it skips cleanly without fixtures**

Run: `npm run test:integration`
Expected: the eval suite shows as skipped, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/receipt-parser-eval.test.ts tests/fixtures/receipts/README.md
git commit -m "test(claims): live eval harness for receipt extraction over real samples"
```

---

### Task 8: Final verification sweep

**Files:** none new.

- [ ] **Step 1: Full quality gates**

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Expected: all pass. Fix anything that fails before proceeding (most likely candidates: other tests still importing `@google/generative-ai` mocks, or assertions on the 4-currency union).

- [ ] **Step 2: Live smoke test**

Start the app (`npm run dev`), open the new-claim form, upload one Swiggy/Zomato screenshot and one foreign invoice, and verify: date matches the receipt, currency detected, total/basic amounts correct, partial-data messaging appears when fields are unreadable.

- [ ] **Step 3: Run the eval once the user drops real samples**

When sample documents exist in `tests/fixtures/receipts/` with `expected.json`:

```powershell
node --env-file=.env.local node_modules/jest/bin/jest.js --testPathPatterns=tests/integration/receipt-parser-eval --runInBand
```

Expected: field accuracy ≥ 90%, with the previously-failing documents now correct.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(claims): receipt extraction overhaul verification fixes"
```
