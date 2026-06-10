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
