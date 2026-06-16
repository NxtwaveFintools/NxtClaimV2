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

describe("foreign currency (no FX in v1)", () => {
  it("no currency check when both INR", () => {
    const checks = compareClaim(snapshot(), extraction());
    expect(checks.find((c) => c.field === "foreign_currency_code")).toBeUndefined();
  });

  it("currency disagreement → fuzzy_match carrying a reason (needs review)", () => {
    const checks = compareClaim(
      snapshot({ foreign_currency_code: "USD", foreign_total_amount: 100 }),
      extraction({ foreignCurrencyCode: null }),
    );
    const c = checkFor(checks, "foreign_currency_code");
    expect(c.verdict).toBe("fuzzy_match");
    expect(c.mismatchReason).not.toBeNull();
  });

  it("same foreign currency, matching total → match", () => {
    const checks = compareClaim(
      snapshot({ foreign_currency_code: "USD", foreign_total_amount: 100 }),
      extraction({ foreignCurrencyCode: "USD", foreignTotalAmount: 100 }),
    );
    expect(checkFor(checks, "foreign_currency_code").verdict).toBe("match");
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
