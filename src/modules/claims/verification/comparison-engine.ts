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
/** Foreign-currency amount tolerance: relative (±1 unit is huge on a $23 invoice). */
export const FOREIGN_AMOUNT_TOLERANCE_PCT = 0.01;
/** Below this overall extraction confidence (0–100) the run is a soft signal. */
export const CONFIDENCE_FLOOR = 60;

/**
 * Per-currency INR-per-unit FX reconciliation bands (foreign claims only).
 * Effective 2026-06-17, owner: finance. Bands MUST be set from the real
 * total_amount/foreign_total_amount distribution per pair — USD and EUR are set.
 * Unknown currency → no band → needs_review (never a hard mismatch).
 */
export const FX_BANDS: Record<string, [number, number]> = {
  USD: [92, 98],
  EUR: [105, 111],
};

const SENTINELS = new Set(["", "-", "n/a", "na", "none", "null"]);

/** App-wide "not provided" sentinels → null, so they never match or mismatch. */
export function normalizeSentinel(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return SENTINELS.has(trimmed.toLowerCase()) ? null : trimmed;
}

export type FieldVerdict = "match" | "mismatch" | "fuzzy_match" | "unavailable";
export type Hardness = "hard" | "soft";
export type Lane = "receipt" | "bank_statement";
export type OverallVerdict =
  | "verified"
  | "mismatch"
  | "statement_mismatch"
  | "needs_review"
  | "extraction_failed"
  | "no_document";

/** Bank statement settlement lag tolerance: submitted date vs statement date. */
export const BANK_DATE_TOLERANCE_DAYS = 1;

export type FieldCheck = {
  field: string;
  lane: Lane;
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
  hardness: Hardness = "hard",
): FieldCheck {
  const base: FieldCheck = {
    field,
    lane: "receipt",
    submittedValue: moneyString(submitted),
    extractedRaw: moneyString(extracted),
    extractedNormalized: moneyString(extracted),
    verdict: "unavailable",
    hardness,
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
  const submittedNorm = normalizeBillNo(normalizeSentinel(submitted));
  const extractedNorm = normalizeBillNo(normalizeSentinel(extracted.billNo));
  const base: FieldCheck = {
    field: "bill_no",
    lane: "receipt",
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
    lane: "receipt",
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
  const submittedNorm = normalizeGstNumber(normalizeSentinel(submitted));
  const extractedNorm = normalizeGstNumber(normalizeSentinel(extracted.gstNumber));
  const base: FieldCheck = {
    field: "gst_number",
    lane: "receipt",
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
    lane: "receipt",
    submittedValue: submitted,
    extractedRaw: extracted.vendorName,
    extractedNormalized: extracted.vendorName,
    verdict: "unavailable",
    hardness: "soft",
    confidence: extracted.confidenceScore,
    toleranceApplied: "fuzzy",
    mismatchReason: null,
  };

  const submittedClean = normalizeSentinel(submitted);
  const extractedClean = normalizeSentinel(extracted.vendorName);
  if (!submittedClean || !extractedClean) {
    return base;
  }

  const a = submittedClean.toLowerCase();
  const b = extractedClean.toLowerCase();
  if (a === b || a.includes(b) || b.includes(a)) {
    return { ...base, verdict: "match" };
  }

  // Token overlap → fuzzy match; otherwise still fuzzy (never a hard mismatch).
  const aTokens = new Set(vendorTokens(submittedClean));
  const bTokens = vendorTokens(extractedClean);
  const overlap = bTokens.some((t) => aTokens.has(t));
  return {
    ...base,
    verdict: "fuzzy_match",
    mismatchReason: overlap ? null : `vendor "${submittedClean}" vs receipt "${extractedClean}"`,
  };
}

/** A claim is foreign when it carries a non-INR currency and a positive foreign total. */
function isForeignClaim(submitted: SubmittedSnapshot): boolean {
  return (
    submitted.foreign_currency_code !== null &&
    submitted.foreign_currency_code !== "INR" &&
    (submitted.foreign_total_amount ?? 0) > 0
  );
}

/** Foreign amounts match within a relative tolerance (±1%), with a tiny absolute floor. */
function foreignAmountsMatch(submitted: number, extracted: number): boolean {
  const tol = Math.max(Math.abs(submitted) * FOREIGN_AMOUNT_TOLERANCE_PCT, 0.5);
  return Math.abs(submitted - extracted) <= tol;
}

/** HARD: foreign invoice total (submitted foreign) vs receipt-extracted foreign amount. */
function compareForeignAmount(
  submitted: SubmittedSnapshot,
  extracted: ReceiptExtractionView,
): FieldCheck {
  const sub = submitted.foreign_total_amount;
  const ext = extracted.foreignTotalAmount;
  const base: FieldCheck = {
    field: "total_amount",
    lane: "receipt",
    submittedValue: moneyString(sub),
    extractedRaw: moneyString(ext),
    extractedNormalized: moneyString(ext),
    verdict: "unavailable",
    hardness: "hard",
    confidence: extracted.confidenceScore,
    toleranceApplied: `±${FOREIGN_AMOUNT_TOLERANCE_PCT * 100}% (${submitted.foreign_currency_code})`,
    mismatchReason: null,
  };
  if (sub === null || !(ext > 0)) {
    return base; // nothing reliable to compare
  }
  if (foreignAmountsMatch(sub, ext)) {
    return { ...base, verdict: "match" };
  }
  return {
    ...base,
    verdict: "mismatch",
    mismatchReason: `submitted ${moneyString(sub)} vs receipt ${moneyString(ext)} ${submitted.foreign_currency_code}`,
  };
}

/** SOFT: receipt currency disagrees with the claimed foreign currency. */
function compareReceiptCurrency(
  submitted: SubmittedSnapshot,
  extracted: ReceiptExtractionView,
): FieldCheck | null {
  const sub = submitted.foreign_currency_code;
  const ext = extracted.foreignCurrencyCode;
  if (ext === null || ext === sub) {
    return null; // receipt currency unknown or agrees — nothing to flag
  }
  return {
    field: "currency_mismatch",
    lane: "receipt",
    submittedValue: sub ?? "INR",
    extractedRaw: ext,
    extractedNormalized: ext,
    verdict: "fuzzy_match",
    hardness: "soft",
    confidence: extracted.confidenceScore,
    toleranceApplied: "no FX conversion",
    mismatchReason: `receipt currency ${ext} differs from claimed ${sub ?? "INR"}`,
  };
}

/**
 * SOFT FX reconciliation (foreign claims): implied INR-per-unit rate must sit in the
 * per-currency band. INR_source = the submitted INR total (the bank lane separately
 * hard-checks submitted INR vs the statement debit, so an in-band rate + a passing bank
 * lane together mean the statement-backed rate is also in band). Submitted-only is weaker
 * evidence — out of band or unknown currency → needs_review, never a hard mismatch.
 */
function compareFxReconciliation(
  submitted: SubmittedSnapshot,
  extracted: ReceiptExtractionView,
): FieldCheck {
  const code = submitted.foreign_currency_code ?? "";
  const foreign = submitted.foreign_total_amount ?? 0;
  const inr = submitted.total_amount ?? 0;
  const band = FX_BANDS[code];
  const base: FieldCheck = {
    field: "fx_reconciliation",
    lane: "receipt",
    submittedValue: `${moneyString(inr)} INR / ${moneyString(foreign)} ${code}`,
    extractedRaw: null,
    extractedNormalized: null,
    verdict: "unavailable",
    hardness: "soft",
    confidence: extracted.confidenceScore,
    toleranceApplied: band ? `${code} ${band[0]}–${band[1]} INR/unit` : `${code} (no band)`,
    mismatchReason: null,
  };
  if (!(foreign > 0)) {
    return { ...base, mismatchReason: "no foreign amount — cannot reconcile" }; // ÷0 guard
  }
  const rate = Math.round((inr / foreign) * 100) / 100;
  if (!band) {
    return { ...base, mismatchReason: `implied rate ${rate} — no band for ${code}, needs review` };
  }
  if (rate >= band[0] && rate <= band[1]) {
    return { ...base, verdict: "match" };
  }
  return {
    ...base,
    verdict: "fuzzy_match",
    mismatchReason: `implied rate ${rate} outside ${code} band ${band[0]}–${band[1]}`,
  };
}

/**
 * Build the full per-field check list for a successful extraction.
 *
 *   hard: amount (currency-aware), date, bill_no
 *   soft: gst_number, GST components, vendor, currency_mismatch, fx_reconciliation
 * GST component checks only run when the claim is GST-applicable.
 */
export function compareClaim(
  submitted: SubmittedSnapshot,
  extracted: ReceiptExtractionView,
): FieldCheck[] {
  const foreign = isForeignClaim(submitted);

  const checks: FieldCheck[] = [
    foreign
      ? compareForeignAmount(submitted, extracted)
      : compareAmountField(
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

  // GST components are SOFT (hard set = amount/date/invoice only).
  if (submitted.is_gst_applicable) {
    checks.push(
      compareAmountField(
        "cgst_amount",
        submitted.cgst_amount,
        extracted.cgstAmount,
        extracted.confidenceScore,
        "soft",
      ),
      compareAmountField(
        "sgst_amount",
        submitted.sgst_amount,
        extracted.sgstAmount,
        extracted.confidenceScore,
        "soft",
      ),
      compareAmountField(
        "igst_amount",
        submitted.igst_amount,
        extracted.igstAmount,
        extracted.confidenceScore,
        "soft",
      ),
    );
  }

  if (foreign) {
    const currencyMismatch = compareReceiptCurrency(submitted, extracted);
    if (currencyMismatch) {
      checks.push(currencyMismatch);
    }
    checks.push(compareFxReconciliation(submitted, extracted));
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Lane 2 — bank statement vs submitted amount/date.
//
// The bank-statement extractor (Gemini, documentType="bank_statement") is given
// the submitted values as match context and returns the single best-matching
// settled debit. We then confirm that matched row agrees with what was submitted.
// No FX in v1.1 — amounts compared in document currency.
// ---------------------------------------------------------------------------

/** The matched bank-statement transaction, projected for comparison. */
export type BankStatementView = {
  matchedAmount: number; // settled debit amount of the matched row (0 = no match found)
  statementDate: string | null; // YYYY-MM-DD of the matched row
  dateAsPrinted: string | null;
  reference: string | null; // transaction/UPI reference on the matched row
  description: string | null; // merchant descriptor on the matched row
  confidenceScore: number;
};

function parseIsoDate(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function datesWithinDays(a: string | null, b: string | null, days: number): boolean | null {
  const ta = parseIsoDate(a);
  const tb = parseIsoDate(b);
  if (ta === null || tb === null) return null; // can't compare
  return Math.abs(ta - tb) <= days * 24 * 60 * 60 * 1000;
}

/**
 * Compare the submitted claim against the matched bank-statement row.
 * Amount and date are HARD (drive `statement_mismatch`); reference is soft.
 * When no transaction matched (matchedAmount <= 0), report `unavailable`, not a
 * mismatch — the statement may simply not contain a clear settled debit.
 */
export function compareBankStatement(
  submitted: SubmittedSnapshot,
  bank: BankStatementView,
): FieldCheck[] {
  const noMatch = !(bank.matchedAmount > 0);

  const amountCheck: FieldCheck = {
    field: "statement_amount",
    lane: "bank_statement",
    submittedValue: moneyString(submitted.total_amount),
    extractedRaw: noMatch ? null : moneyString(bank.matchedAmount),
    extractedNormalized: noMatch ? null : moneyString(bank.matchedAmount),
    verdict: "unavailable",
    hardness: "hard",
    confidence: bank.confidenceScore,
    toleranceApplied: `±${AMOUNT_TOLERANCE}`,
    mismatchReason: noMatch ? "no matching settled debit found in statement" : null,
  };
  if (!noMatch && submitted.total_amount !== null) {
    amountCheck.verdict = amountsMatch(submitted.total_amount, bank.matchedAmount)
      ? "match"
      : "mismatch";
    if (amountCheck.verdict === "mismatch") {
      amountCheck.mismatchReason = `submitted ${moneyString(submitted.total_amount)} vs statement ${moneyString(bank.matchedAmount)}`;
    }
  }

  const within = datesWithinDays(
    submitted.transaction_date,
    bank.statementDate,
    BANK_DATE_TOLERANCE_DAYS,
  );
  const dateCheck: FieldCheck = {
    field: "statement_date",
    lane: "bank_statement",
    submittedValue: submitted.transaction_date,
    extractedRaw: bank.dateAsPrinted,
    extractedNormalized: bank.statementDate,
    verdict: within === null ? "unavailable" : within ? "match" : "mismatch",
    hardness: "hard",
    confidence: bank.confidenceScore,
    toleranceApplied: `±${BANK_DATE_TOLERANCE_DAYS} day (settlement lag)`,
    mismatchReason:
      within === false
        ? `submitted ${submitted.transaction_date} vs statement ${bank.statementDate} (>${BANK_DATE_TOLERANCE_DAYS}d)`
        : null,
  };

  const checks: FieldCheck[] = [amountCheck, dateCheck];

  // Transaction reference is a secondary (soft) signal, only when both present.
  if (submitted.transaction_id && bank.reference) {
    const subRef = normalizeBillNo(submitted.transaction_id);
    const stmtRef = normalizeBillNo(bank.reference);
    checks.push({
      field: "statement_reference",
      lane: "bank_statement",
      submittedValue: submitted.transaction_id,
      extractedRaw: bank.reference,
      extractedNormalized: stmtRef,
      verdict: subRef && stmtRef ? (subRef === stmtRef ? "match" : "mismatch") : "unavailable",
      hardness: "soft",
      confidence: bank.confidenceScore,
      toleranceApplied: "normalized",
      mismatchReason:
        subRef && stmtRef && subRef !== stmtRef ? "reference differs from statement" : null,
    });
  }

  return checks;
}

/**
 * Tiered roll-up across BOTH lanes (pass receipt + statement checks together):
 *   receipt HARD mismatch              → mismatch          (paying the wrong amount)
 *   else statement HARD mismatch       → statement_mismatch (receipt ok, bank disagrees)
 *   else any soft signal               → needs_review
 *     (low overall confidence, a soft-field mismatch, or a fuzzy_match carrying
 *      a reason such as a currency disagreement)
 *   else                               → verified
 * Vendor fuzzy_match WITHOUT a reason never triggers needs_review.
 */
export function rollUpVerdict(checks: FieldCheck[], confidenceScore: number): OverallVerdict {
  const receiptHardMismatch = checks.some(
    (c) => c.lane === "receipt" && c.hardness === "hard" && c.verdict === "mismatch",
  );
  if (receiptHardMismatch) {
    return "mismatch";
  }

  const statementHardMismatch = checks.some(
    (c) => c.lane === "bank_statement" && c.hardness === "hard" && c.verdict === "mismatch",
  );
  if (statementHardMismatch) {
    return "statement_mismatch";
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
