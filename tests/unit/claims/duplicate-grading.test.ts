import { describe, expect, it } from "@jest/globals";
import { gradeDuplicateArms } from "@/modules/claims/verification/duplicate-grading";

describe("gradeDuplicateArms", () => {
  it("surfaces invoice and amount+date matches independently (different peers)", () => {
    const rows = [
      { claim_id: "C-INV", match_kind: "invoice_match" },
      { claim_id: "C-AMT", match_kind: "amount_date_match" },
    ];
    const result = gradeDuplicateArms(rows, {
      invoiceUnavailable: false,
      amountDateAvailable: true,
    });
    expect(result.invoice).toEqual({ status: "match", claimIds: ["C-INV"] });
    expect(result.amountDate).toEqual({ status: "match", claimIds: ["C-AMT"] });
  });

  it("invoice read-failure marks invoice unavailable but still grades amount+date", () => {
    const rows = [{ claim_id: "C-AMT", match_kind: "amount_date_match" }];
    const result = gradeDuplicateArms(rows, {
      invoiceUnavailable: true,
      amountDateAvailable: true,
    });
    expect(result.invoice).toEqual({ status: "unavailable", claimIds: [] });
    expect(result.amountDate).toEqual({ status: "match", claimIds: ["C-AMT"] });
  });

  it("no rows → both arms none when both inputs available", () => {
    const result = gradeDuplicateArms([], { invoiceUnavailable: false, amountDateAvailable: true });
    expect(result.invoice).toEqual({ status: "none", claimIds: [] });
    expect(result.amountDate).toEqual({ status: "none", claimIds: [] });
  });

  it("missing date/amount marks amount+date unavailable", () => {
    const result = gradeDuplicateArms([], {
      invoiceUnavailable: false,
      amountDateAvailable: false,
    });
    expect(result.amountDate).toEqual({ status: "unavailable", claimIds: [] });
  });

  it("collapses multiple invoice rows into one claimIds list", () => {
    const rows = [
      { claim_id: "C-1", match_kind: "invoice_match" },
      { claim_id: "C-2", match_kind: "invoice_match" },
    ];
    const result = gradeDuplicateArms(rows, {
      invoiceUnavailable: false,
      amountDateAvailable: true,
    });
    expect(result.invoice.claimIds).toEqual(["C-1", "C-2"]);
  });
});
