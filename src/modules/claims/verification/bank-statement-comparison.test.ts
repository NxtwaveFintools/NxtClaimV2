import {
  BANK_DATE_TOLERANCE_DAYS,
  compareBankStatement,
  rollUpVerdict,
  type BankStatementView,
  type FieldCheck,
  type SubmittedSnapshot,
} from "@/modules/claims/verification/comparison-engine";

// Lane 2 — bank statement vs submitted amount/date.

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

function bank(overrides: Partial<BankStatementView> = {}): BankStatementView {
  return {
    matchedAmount: 1000,
    statementDate: "2026-06-10",
    dateAsPrinted: "10/06/2026",
    reference: null,
    description: "SWIGGY",
    confidenceScore: 90,
    ...overrides,
  };
}

function checkFor(checks: FieldCheck[], field: string): FieldCheck {
  const found = checks.find((c) => c.field === field);
  if (!found) throw new Error(`no check for ${field}`);
  return found;
}

describe("compareBankStatement — amount", () => {
  it("matches within ±1 rupee, all on the bank_statement lane", () => {
    const checks = compareBankStatement(
      snapshot({ total_amount: 1000 }),
      bank({ matchedAmount: 1001 }),
    );
    const amt = checkFor(checks, "statement_amount");
    expect(amt.verdict).toBe("match");
    expect(amt.lane).toBe("bank_statement");
    expect(amt.hardness).toBe("hard");
  });

  it("mismatches just beyond tolerance", () => {
    const checks = compareBankStatement(
      snapshot({ total_amount: 1000 }),
      bank({ matchedAmount: 1001.01 }),
    );
    expect(checkFor(checks, "statement_amount").verdict).toBe("mismatch");
  });

  it("reports unavailable (not mismatch) when no transaction matched", () => {
    const checks = compareBankStatement(
      snapshot({ total_amount: 1000 }),
      bank({ matchedAmount: 0 }),
    );
    const amt = checkFor(checks, "statement_amount");
    expect(amt.verdict).toBe("unavailable");
    expect(amt.mismatchReason).toMatch(/no matching/i);
  });
});

describe("compareBankStatement — date (±1 day settlement lag)", () => {
  it("constant is 1 day", () => {
    expect(BANK_DATE_TOLERANCE_DAYS).toBe(1);
  });

  it("matches when statement settles 1 day after the invoice date", () => {
    const checks = compareBankStatement(
      snapshot({ transaction_date: "2026-06-10" }),
      bank({ statementDate: "2026-06-11" }),
    );
    expect(checkFor(checks, "statement_date").verdict).toBe("match");
  });

  it("mismatches when more than 1 day apart", () => {
    const checks = compareBankStatement(
      snapshot({ transaction_date: "2026-06-10" }),
      bank({ statementDate: "2026-06-13" }),
    );
    expect(checkFor(checks, "statement_date").verdict).toBe("mismatch");
  });

  it("unavailable when the statement date can't be parsed", () => {
    const checks = compareBankStatement(snapshot(), bank({ statementDate: null }));
    expect(checkFor(checks, "statement_date").verdict).toBe("unavailable");
  });
});

describe("compareBankStatement — reference (soft, optional)", () => {
  it("is omitted when either side has no reference", () => {
    const checks = compareBankStatement(
      snapshot({ transaction_id: null }),
      bank({ reference: "UPI123" }),
    );
    expect(checks.find((c) => c.field === "statement_reference")).toBeUndefined();
  });

  it("matches normalized references and is soft", () => {
    const checks = compareBankStatement(
      snapshot({ transaction_id: "UPI-123" }),
      bank({ reference: "upi 123" }),
    );
    const ref = checkFor(checks, "statement_reference");
    expect(ref.verdict).toBe("match");
    expect(ref.hardness).toBe("soft");
  });
});

describe("rollUpVerdict — combined lanes", () => {
  it("receipt clean + statement amount mismatch → statement_mismatch", () => {
    // emulate clean receipt checks (none mismatching) + a statement amount mismatch
    const statementChecks = compareBankStatement(
      snapshot({ total_amount: 1000 }),
      bank({ matchedAmount: 9999 }),
    );
    expect(rollUpVerdict(statementChecks, 90)).toBe("statement_mismatch");
  });

  it("receipt HARD mismatch outranks a statement mismatch → mismatch", () => {
    const receiptMismatch: FieldCheck = {
      field: "total_amount",
      lane: "receipt",
      submittedValue: "1000.00",
      extractedRaw: "5000.00",
      extractedNormalized: "5000.00",
      verdict: "mismatch",
      hardness: "hard",
      confidence: 90,
      toleranceApplied: "±1",
      mismatchReason: "x",
    };
    const statementChecks = compareBankStatement(
      snapshot({ total_amount: 1000 }),
      bank({ matchedAmount: 9999 }),
    );
    expect(rollUpVerdict([receiptMismatch, ...statementChecks], 90)).toBe("mismatch");
  });

  it("both lanes clean → verified", () => {
    const statementChecks = compareBankStatement(snapshot(), bank());
    expect(rollUpVerdict(statementChecks, 90)).toBe("verified");
  });

  it("statement unavailable (no match) does not force a mismatch", () => {
    const statementChecks = compareBankStatement(snapshot(), bank({ matchedAmount: 0 }));
    // unavailable amount + matching date → not a hard mismatch
    expect(rollUpVerdict(statementChecks, 90)).toBe("verified");
  });
});
