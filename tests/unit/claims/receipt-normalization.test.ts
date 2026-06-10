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
