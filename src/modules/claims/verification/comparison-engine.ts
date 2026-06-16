import {
  normalizeBillNo,
  normalizeGstNumber,
} from "@/modules/claims/actions/receipt-normalization";

// ---------------------------------------------------------------------------
// Deterministic per-field comparison for finance verification (Lane 1: receipt
// vs submitted values). No ML scoring — every verdict traces to a named rule.
//
//   submitted snapshot ─┐
//                       ├─► compareClaim ─► per-field FieldCheck[] ─► rollUpVerdict ─► OverallVerdict
//   receipt extraction ─┘        │                                         │
//                                │  hard fields: amount/date/bill_no/GST    │ any HARD mismatch ........ mismatch
//                                │  soft fields: gst_number/vendor/currency │ else any SOFT signal ..... needs_review
//                                                                           │ else ..................... verified
//
// Vendor is fuzzy-only: it can never produce a hard mismatch and never alone
// downgrades the badge below `verified`.
// ---------------------------------------------------------------------------

/** ±1 rupee, consistent with the extractor's internal MATH_TOLERANCE. */
export const AMOUNT_TOLERANCE = 1;
/** Below this overall extraction confidence (0–100) the run is a soft signal. */
export const CONFIDENCE_FLOOR = 60;

export type FieldVerdict = "match" | "mismatch" | "fuzzy_match" | "unavailable";
export type Hardness = "hard" | "soft";
export type OverallVerdict =
  | "verified"
  | "mismatch"
  | "needs_review"
  | "extraction_failed"
  | "no_document";

export type FieldCheck = {
  field: string;
  submittedValue: string | null;
  extractedRaw: string | null;
  extractedNormalized: string | null;
  verdict: FieldVerdict;
  hardness: Hardness;
  confidence: number | null;
  toleranceApplied: string | null;
  mismatchReason: string | null;
};

/** Compared fields as captured in submitted_values_snapshot (see SQL builder). */
export type SubmittedSnapshot = {
  bill_no: string | null;
  transaction_date: string | null;
  total_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  gst_number: string | null;
  vendor_name: string | null;
  transaction_id: string | null;
  is_gst_applicable: boolean;
  foreign_total_amount: number | null;
  foreign_currency_code: string | null;
};

/** Extraction projected for comparison: normalized values + raw-as-printed for evidence. */
export type ReceiptExtractionView = {
  billNo: string | null;
  billNoRaw: string | null;
  transactionDate: string | null;
  dateAsPrinted: string | null;
  vendorName: string | null;
  gstNumber: string | null;
  totalAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  foreignCurrencyCode: string | null;
  foreignTotalAmount: number;
  confidenceScore: number;
};

function moneyString(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}

function amountsMatch(submitted: number, extracted: number): boolean {
  return Math.abs(submitted - extracted) <= AMOUNT_TOLERANCE;
}

function compareAmountField(
  field: string,
  submitted: number | null,
  extracted: number,
  confidence: number,
): FieldCheck {
  const base: FieldCheck = {
    field,
    submittedValue: moneyString(submitted),
    extractedRaw: moneyString(extracted),
    extractedNormalized: moneyString(extracted),
    verdict: "unavailable",
    hardness: "hard",
    confidence,
    toleranceApplied: `±${AMOUNT_TOLERANCE}`,
    mismatchReason: null,
  };

  if (submitted === null) {
    return base;
  }
  if (amountsMatch(submitted, extracted)) {
    return { ...base, verdict: "match" };
  }
  return {
    ...base,
    verdict: "mismatch",
    mismatchReason: `submitted ${moneyString(submitted)} vs receipt ${moneyString(extracted)} (>₹${AMOUNT_TOLERANCE})`,
  };
}

function compareBillNo(submitted: string | null, extracted: ReceiptExtractionView): FieldCheck {
  const submittedNorm = normalizeBillNo(submitted);
  const extractedNorm = normalizeBillNo(extracted.billNo);
  const base: FieldCheck = {
    field: "bill_no",
    submittedValue: submitted,
    extractedRaw: extracted.billNoRaw ?? extracted.billNo,
    extractedNormalized: extractedNorm,
    verdict: "unavailable",
    hardness: "hard",
    confidence: extracted.confidenceScore,
    toleranceApplied: "normalized (case/punctuation-insensitive)",
    mismatchReason: null,
  };

  if (submittedNorm === null || extractedNorm === null) {
    return base; // nothing to compare against
  }
  if (submittedNorm === extractedNorm) {
    return { ...base, verdict: "match" };
  }
  return {
    ...base,
    verdict: "mismatch",
    mismatchReason: `bill no "${submitted}" does not match receipt "${extracted.billNoRaw ?? extracted.billNo}"`,
  };
}

function compareDate(submitted: string | null, extracted: ReceiptExtractionView): FieldCheck {
  const base: FieldCheck = {
    field: "transaction_date",
    submittedValue: submitted,
    extractedRaw: extracted.dateAsPrinted,
    extractedNormalized: extracted.transactionDate,
    verdict: "unavailable",
    hardness: "hard",
    confidence: extracted.confidenceScore,
    toleranceApplied: "exact (receipt)",
    mismatchReason: null,
  };

  if (submitted === null || extracted.transactionDate === null) {
    return base;
  }
  if (submitted === extracted.transactionDate) {
    return { ...base, verdict: "match" };
  }
  return {
    ...base,
    verdict: "mismatch",
    mismatchReason: `date ${submitted} does not match receipt ${extracted.transactionDate}`,
  };
}

function compareGstNumber(submitted: string | null, extracted: ReceiptExtractionView): FieldCheck {
  const submittedNorm = normalizeGstNumber(submitted);
  const extractedNorm = normalizeGstNumber(extracted.gstNumber);
  const base: FieldCheck = {
    field: "gst_number",
    submittedValue: submitted,
    extractedRaw: extracted.gstNumber,
    extractedNormalized: extractedNorm,
    verdict: "unavailable",
    hardness: "soft",
    confidence: extracted.confidenceScore,
    toleranceApplied: "normalized exact",
    mismatchReason: null,
  };

  if (submittedNorm === null || extractedNorm === null) {
    return base;
  }
  if (submittedNorm === extractedNorm) {
    return { ...base, verdict: "match" };
  }
  return {
    ...base,
    verdict: "mismatch",
    mismatchReason: `GST number differs from receipt`,
  };
}

function vendorTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Vendor is fuzzy-only: never a hard mismatch. Returns match | fuzzy_match | unavailable. */
function compareVendor(submitted: string | null, extracted: ReceiptExtractionView): FieldCheck {
  const base: FieldCheck = {
    field: "vendor_name",
    submittedValue: submitted,
    extractedRaw: extracted.vendorName,
    extractedNormalized: extracted.vendorName,
    verdict: "unavailable",
    hardness: "soft",
    confidence: extracted.confidenceScore,
    toleranceApplied: "fuzzy",
    mismatchReason: null,
  };

  if (!submitted || !extracted.vendorName) {
    return base;
  }

  const a = submitted.trim().toLowerCase();
  const b = extracted.vendorName.trim().toLowerCase();
  if (a === b || a.includes(b) || b.includes(a)) {
    return { ...base, verdict: "match" };
  }

  // Token overlap → fuzzy match; otherwise still fuzzy (never a hard mismatch).
  const aTokens = new Set(vendorTokens(submitted));
  const bTokens = vendorTokens(extracted.vendorName);
  const overlap = bTokens.some((t) => aTokens.has(t));
  return {
    ...base,
    verdict: "fuzzy_match",
    mismatchReason: overlap ? null : `vendor "${submitted}" vs receipt "${extracted.vendorName}"`,
  };
}

/**
 * Foreign-currency check: v1 does NO FX conversion. If the submitted claim and
 * the receipt disagree on whether/which foreign currency applies, that is a soft
 * needs-review signal, not a hard mismatch.
 */
function compareCurrency(
  submitted: SubmittedSnapshot,
  extracted: ReceiptExtractionView,
): FieldCheck | null {
  const submittedCode = submitted.foreign_currency_code;
  const extractedCode = extracted.foreignCurrencyCode;
  const submittedIsForeign = submittedCode !== null && submittedCode !== "INR";
  const extractedIsForeign = extractedCode !== null && extractedCode !== "INR";

  if (!submittedIsForeign && !extractedIsForeign) {
    return null; // both INR — nothing to flag
  }

  const base: FieldCheck = {
    field: "foreign_currency_code",
    submittedValue: submittedCode,
    extractedRaw: extractedCode,
    extractedNormalized: extractedCode,
    verdict: "unavailable",
    hardness: "soft",
    confidence: extracted.confidenceScore,
    toleranceApplied: "document currency, no FX (v1)",
    mismatchReason: null,
  };

  if (submittedIsForeign && extractedIsForeign && submittedCode === extractedCode) {
    // Same currency: compare the foreign total in document currency.
    return {
      ...base,
      verdict: amountsMatch(submitted.foreign_total_amount ?? 0, extracted.foreignTotalAmount)
        ? "match"
        : "fuzzy_match",
      mismatchReason: amountsMatch(
        submitted.foreign_total_amount ?? 0,
        extracted.foreignTotalAmount,
      )
        ? null
        : `foreign total ${moneyString(submitted.foreign_total_amount)} vs receipt ${moneyString(extracted.foreignTotalAmount)}`,
    };
  }

  return {
    ...base,
    verdict: "fuzzy_match",
    mismatchReason: `currency disagreement: submitted ${submittedCode ?? "INR"} vs receipt ${extractedCode ?? "INR"} (needs review — no FX in v1)`,
  };
}

/**
 * Build the full per-field check list for a successful extraction.
 * GST amount checks only run when the claim is GST-applicable.
 */
export function compareClaim(
  submitted: SubmittedSnapshot,
  extracted: ReceiptExtractionView,
): FieldCheck[] {
  const checks: FieldCheck[] = [
    compareAmountField(
      "total_amount",
      submitted.total_amount,
      extracted.totalAmount,
      extracted.confidenceScore,
    ),
    compareDate(submitted.transaction_date, extracted),
    compareBillNo(submitted.bill_no, extracted),
    compareGstNumber(submitted.gst_number, extracted),
    compareVendor(submitted.vendor_name, extracted),
  ];

  if (submitted.is_gst_applicable) {
    checks.push(
      compareAmountField(
        "cgst_amount",
        submitted.cgst_amount,
        extracted.cgstAmount,
        extracted.confidenceScore,
      ),
      compareAmountField(
        "sgst_amount",
        submitted.sgst_amount,
        extracted.sgstAmount,
        extracted.confidenceScore,
      ),
      compareAmountField(
        "igst_amount",
        submitted.igst_amount,
        extracted.igstAmount,
        extracted.confidenceScore,
      ),
    );
  }

  const currencyCheck = compareCurrency(submitted, extracted);
  if (currencyCheck) {
    checks.push(currencyCheck);
  }

  return checks;
}

/**
 * Tiered roll-up:
 *   any HARD field mismatch            → mismatch
 *   else any soft signal               → needs_review
 *     (low overall confidence, a soft-field mismatch, or a fuzzy_match carrying
 *      a reason such as a currency disagreement)
 *   else                               → verified
 * Vendor fuzzy_match WITHOUT a reason never triggers needs_review.
 */
export function rollUpVerdict(checks: FieldCheck[], confidenceScore: number): OverallVerdict {
  const hasHardMismatch = checks.some((c) => c.hardness === "hard" && c.verdict === "mismatch");
  if (hasHardMismatch) {
    return "mismatch";
  }

  const lowConfidence = confidenceScore < CONFIDENCE_FLOOR;
  const softSignal = checks.some(
    (c) =>
      (c.hardness === "soft" && c.verdict === "mismatch") ||
      (c.verdict === "fuzzy_match" && c.field !== "vendor_name" && c.mismatchReason !== null),
  );

  if (lowConfidence || softSignal) {
    return "needs_review";
  }
  return "verified";
}
