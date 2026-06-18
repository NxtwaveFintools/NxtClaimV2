import {
  AMOUNT_TOLERANCE,
  CONFIDENCE_FLOOR,
  compareClaim,
  rollUpVerdict,
  type ReceiptExtractionView,
  type SubmittedSnapshot,
} from "@/modules/claims/verification/comparison-engine";
import {
  normalizeBillNo,
  normalizeGstNumber,
} from "@/modules/claims/actions/receipt-normalization";

function snapshot(overrides: Partial<SubmittedSnapshot> = {}): SubmittedSnapshot {
  return {
    bill_no: "INV-001",
    transaction_date: "2026-06-10",
    total_amount: 1000,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    gst_number: null,
    vendor_name: "Swiggy",
    transaction_id: null,
    is_gst_applicable: false,
    foreign_total_amount: null,
    foreign_currency_code: null,
    ...overrides,
  };
}

function extraction(overrides: Partial<ReceiptExtractionView> = {}): ReceiptExtractionView {
  return {
    billNo: "INV-001",
    billNoRaw: "INV-001",
    transactionDate: "2026-06-10",
    dateAsPrinted: "10/06/2026",
    vendorName: "Swiggy",
    gstNumber: null,
    totalAmount: 1000,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    foreignCurrencyCode: null,
    foreignTotalAmount: 0,
    confidenceScore: 95,
    ...overrides,
  };
}

function checkFor(checks: ReturnType<typeof compareClaim>, field: string) {
  const found = checks.find((c) => c.field === field);
  if (!found) throw new Error(`no check for ${field}`);
  return found;
}

describe("normalizers", () => {
  it("normalizeBillNo strips punctuation and uppercases", () => {
    expect(normalizeBillNo("#RD-177 / 66")).toBe("RD17766");
    expect(normalizeBillNo("rd17766")).toBe("RD17766");
    expect(normalizeBillNo("   ")).toBeNull();
    expect(normalizeBillNo(null)).toBeNull();
  });

  it("normalizeGstNumber strips spaces and uppercases", () => {
    expect(normalizeGstNumber("29 abcde 1234 f1z5")).toBe("29ABCDE1234F1Z5");
    expect(normalizeGstNumber(null)).toBeNull();
  });
});

describe("total_amount tolerance boundary", () => {
  it("matches when difference == tolerance (exactly ₹1)", () => {
    const checks = compareClaim(
      snapshot({ total_amount: 1000 }),
      extraction({ totalAmount: 1001 }),
    );
    expect(checkFor(checks, "total_amount").verdict).toBe("match");
  });

  it("mismatches when difference just exceeds tolerance (₹1.01)", () => {
    const checks = compareClaim(
      snapshot({ total_amount: 1000 }),
      extraction({ totalAmount: 1001.01 }),
    );
    expect(checkFor(checks, "total_amount").verdict).toBe("mismatch");
  });

  it("matches on exact equality", () => {
    const checks = compareClaim(
      snapshot({ total_amount: 1000 }),
      extraction({ totalAmount: 1000 }),
    );
    expect(checkFor(checks, "total_amount").verdict).toBe("match");
  });

  it("tolerance constant is 1 (consistent with MATH_TOLERANCE)", () => {
    expect(AMOUNT_TOLERANCE).toBe(1);
  });
});

describe("transaction_date (receipt = exact)", () => {
  it("matches identical ISO dates", () => {
    const checks = compareClaim(snapshot(), extraction());
    expect(checkFor(checks, "transaction_date").verdict).toBe("match");
  });

  it("mismatches off-by-one day", () => {
    const checks = compareClaim(
      snapshot({ transaction_date: "2026-06-10" }),
      extraction({ transactionDate: "2026-06-11" }),
    );
    expect(checkFor(checks, "transaction_date").verdict).toBe("mismatch");
  });

  it("is unavailable when receipt date missing", () => {
    const checks = compareClaim(snapshot(), extraction({ transactionDate: null }));
    expect(checkFor(checks, "transaction_date").verdict).toBe("unavailable");
  });
});

describe("bill_no normalized match", () => {
  it("matches across punctuation/case differences", () => {
    const checks = compareClaim(
      snapshot({ bill_no: "#INV-001" }),
      extraction({ billNo: "inv 001", billNoRaw: "inv 001" }),
    );
    expect(checkFor(checks, "bill_no").verdict).toBe("match");
  });

  it("mismatches genuinely different numbers", () => {
    const checks = compareClaim(
      snapshot({ bill_no: "INV-001" }),
      extraction({ billNo: "INV-999", billNoRaw: "INV-999" }),
    );
    expect(checkFor(checks, "bill_no").verdict).toBe("mismatch");
  });
});

describe("GST gating", () => {
  it("skips GST amount checks entirely when is_gst_applicable=false", () => {
    const checks = compareClaim(snapshot({ is_gst_applicable: false }), extraction());
    expect(checks.find((c) => c.field === "cgst_amount")).toBeUndefined();
    expect(checks.find((c) => c.field === "sgst_amount")).toBeUndefined();
    expect(checks.find((c) => c.field === "igst_amount")).toBeUndefined();
  });

  it("runs GST amount checks when is_gst_applicable=true", () => {
    const checks = compareClaim(
      snapshot({ is_gst_applicable: true, cgst_amount: 90, sgst_amount: 90 }),
      extraction({ cgstAmount: 90, sgstAmount: 90 }),
    );
    expect(checkFor(checks, "cgst_amount").verdict).toBe("match");
    expect(checkFor(checks, "sgst_amount").verdict).toBe("match");
  });

  it("GST amount within ±1 matches; beyond mismatches", () => {
    const okChecks = compareClaim(
      snapshot({ is_gst_applicable: true, cgst_amount: 90 }),
      extraction({ cgstAmount: 91 }),
    );
    expect(checkFor(okChecks, "cgst_amount").verdict).toBe("match");

    const badChecks = compareClaim(
      snapshot({ is_gst_applicable: true, cgst_amount: 90 }),
      extraction({ cgstAmount: 95 }),
    );
    expect(checkFor(badChecks, "cgst_amount").verdict).toBe("mismatch");
  });
});

describe("gst_number (soft, normalized exact)", () => {
  it("matches with spacing differences", () => {
    const checks = compareClaim(
      snapshot({ gst_number: "29ABCDE1234F1Z5" }),
      extraction({ gstNumber: "29 ABCDE 1234 F1Z5" }),
    );
    const c = checkFor(checks, "gst_number");
    expect(c.verdict).toBe("match");
    expect(c.hardness).toBe("soft");
  });

  it("differs → soft mismatch (drives needs_review, not mismatch)", () => {
    const checks = compareClaim(
      snapshot({ gst_number: "29ABCDE1234F1Z5" }),
      extraction({ gstNumber: "27ZZZZZ9999Z9Z9" }),
    );
    const c = checkFor(checks, "gst_number");
    expect(c.verdict).toBe("mismatch");
    expect(c.hardness).toBe("soft");
  });
});

describe("vendor (fuzzy, never hard mismatch)", () => {
  it("exact/contains → match", () => {
    const checks = compareClaim(
      snapshot({ vendor_name: "Swiggy" }),
      extraction({ vendorName: "Swiggy Limited" }),
    );
    expect(checkFor(checks, "vendor_name").verdict).toBe("match");
  });

  it("totally different vendor → fuzzy_match, NOT mismatch", () => {
    const checks = compareClaim(
      snapshot({ vendor_name: "Swiggy" }),
      extraction({ vendorName: "Reliance Digital" }),
    );
    const c = checkFor(checks, "vendor_name");
    expect(c.verdict).toBe("fuzzy_match");
    expect(c.hardness).toBe("soft");
  });
});

// A foreign claim: USD invoice $100, INR total drives the implied rate.
function foreignSnapshot(
  rateInr: number,
  over: Partial<SubmittedSnapshot> = {},
): SubmittedSnapshot {
  return snapshot({
    foreign_currency_code: "USD",
    foreign_total_amount: 100,
    total_amount: rateInr * 100, // implied rate = rateInr
    ...over,
  });
}
function foreignExtraction(over: Partial<ReceiptExtractionView> = {}): ReceiptExtractionView {
  return extraction({
    foreignCurrencyCode: "USD",
    foreignTotalAmount: 100,
    totalAmount: 0,
    ...over,
  });
}

describe("FX reconciliation (foreign claims)", () => {
  it("INR claim has no FX or currency checks", () => {
    const checks = compareClaim(snapshot(), extraction());
    expect(checks.find((c) => c.field === "fx_reconciliation")).toBeUndefined();
    expect(checks.find((c) => c.field === "currency_mismatch")).toBeUndefined();
  });

  it("foreign amount is the HARD total_amount check (foreign vs receipt foreign)", () => {
    const ok = compareClaim(foreignSnapshot(95), foreignExtraction({ foreignTotalAmount: 100 }));
    const amt = checkFor(ok, "total_amount");
    expect(amt.verdict).toBe("match");
    expect(amt.hardness).toBe("hard");

    const bad = compareClaim(foreignSnapshot(95), foreignExtraction({ foreignTotalAmount: 130 }));
    expect(checkFor(bad, "total_amount").verdict).toBe("mismatch"); // >1%
  });

  it("FX band boundaries for USD (92–98)", () => {
    const rate = (r: number) =>
      checkFor(compareClaim(foreignSnapshot(r), foreignExtraction()), "fx_reconciliation").verdict;
    expect(rate(91.9)).toBe("fuzzy_match"); // below band
    expect(rate(92.0)).toBe("match");
    expect(rate(98.0)).toBe("match");
    expect(rate(98.1)).toBe("fuzzy_match"); // above band
  });

  it("the grounding claim (92.88) reconciles in-band", () => {
    const checks = compareClaim(foreignSnapshot(92.88), foreignExtraction());
    expect(checkFor(checks, "fx_reconciliation").verdict).toBe("match");
  });

  it("unknown currency has no band → fx unavailable (drives needs_review)", () => {
    const checks = compareClaim(
      foreignSnapshot(50, { foreign_currency_code: "AUD" }),
      foreignExtraction({ foreignCurrencyCode: "AUD" }),
    );
    const fx = checkFor(checks, "fx_reconciliation");
    expect(fx.verdict).toBe("unavailable");
    expect(fx.mismatchReason).toMatch(/no band/i);
  });

  it("receipt currency disagreeing with the claim → soft currency_mismatch", () => {
    const checks = compareClaim(
      foreignSnapshot(95),
      foreignExtraction({ foreignCurrencyCode: "EUR" }),
    );
    const cm = checkFor(checks, "currency_mismatch");
    expect(cm.verdict).toBe("fuzzy_match");
    expect(cm.hardness).toBe("soft");
  });

  it("÷0 guard: foreign currency set but zero foreign amount is treated as INR (no crash, no FX)", () => {
    const checks = compareClaim(
      snapshot({ foreign_currency_code: "USD", foreign_total_amount: 0, total_amount: 1000 }),
      extraction({ totalAmount: 1000 }),
    );
    expect(checks.find((c) => c.field === "fx_reconciliation")).toBeUndefined();
    expect(checkFor(checks, "total_amount").verdict).toBe("match"); // INR path
  });

  it("foreign in-band + amounts match → verified", () => {
    const checks = compareClaim(foreignSnapshot(95), foreignExtraction());
    expect(rollUpVerdict(checks, 95)).toBe("verified");
  });

  it("foreign out-of-band → needs_review (never hard mismatch)", () => {
    const checks = compareClaim(foreignSnapshot(120), foreignExtraction());
    expect(rollUpVerdict(checks, 95)).toBe("needs_review");
  });
});

describe("sentinels never produce a hard signal", () => {
  it('bill_no "N/A" on either side → unavailable, not mismatch', () => {
    const subNa = compareClaim(snapshot({ bill_no: "N/A" }), extraction({ billNo: "INV-9" }));
    expect(checkFor(subNa, "bill_no").verdict).toBe("unavailable");
    const extNa = compareClaim(
      snapshot({ bill_no: "INV-1" }),
      extraction({ billNo: "N/A", billNoRaw: "N/A" }),
    );
    expect(checkFor(extNa, "bill_no").verdict).toBe("unavailable");
  });

  it("gst_number blank/sentinel → unavailable", () => {
    const checks = compareClaim(
      snapshot({ gst_number: "-" }),
      extraction({ gstNumber: "29ABCDE1234F1Z5" }),
    );
    expect(checkFor(checks, "gst_number").verdict).toBe("unavailable");
  });
});

describe("GST demotion regression — GST is soft, not hard", () => {
  it("a GST component mismatch alone → needs_review, NOT mismatch", () => {
    const checks = compareClaim(
      snapshot({ is_gst_applicable: true, cgst_amount: 90 }),
      extraction({ cgstAmount: 500 }),
    );
    expect(checkFor(checks, "cgst_amount").hardness).toBe("soft");
    expect(rollUpVerdict(checks, 95)).toBe("needs_review");
  });
});

describe("rollUpVerdict — tiered truth table", () => {
  it("all clean → verified", () => {
    const checks = compareClaim(snapshot(), extraction());
    expect(rollUpVerdict(checks, 95)).toBe("verified");
  });

  it("hard field mismatch → mismatch", () => {
    const checks = compareClaim(
      snapshot({ total_amount: 1000 }),
      extraction({ totalAmount: 5000 }),
    );
    expect(rollUpVerdict(checks, 95)).toBe("mismatch");
  });

  it("only soft signal (gst_number differs) → needs_review", () => {
    const checks = compareClaim(
      snapshot({ gst_number: "29ABCDE1234F1Z5" }),
      extraction({ gstNumber: "27ZZZZZ9999Z9Z9" }),
    );
    expect(rollUpVerdict(checks, 95)).toBe("needs_review");
  });

  it("low overall confidence alone → needs_review", () => {
    const checks = compareClaim(snapshot(), extraction({ confidenceScore: CONFIDENCE_FLOOR - 1 }));
    expect(rollUpVerdict(checks, CONFIDENCE_FLOOR - 1)).toBe("needs_review");
  });

  it("vendor fuzzy mismatch alone NEVER downgrades below verified", () => {
    const checks = compareClaim(
      snapshot({ vendor_name: "Swiggy" }),
      extraction({ vendorName: "Reliance Digital" }),
    );
    expect(rollUpVerdict(checks, 95)).toBe("verified");
  });

  it("hard mismatch dominates a simultaneous soft signal", () => {
    const checks = compareClaim(
      snapshot({ total_amount: 1000, gst_number: "29ABCDE1234F1Z5" }),
      extraction({ totalAmount: 5000, gstNumber: "27ZZZZZ9999Z9Z9" }),
    );
    expect(rollUpVerdict(checks, 95)).toBe("mismatch");
  });
});
