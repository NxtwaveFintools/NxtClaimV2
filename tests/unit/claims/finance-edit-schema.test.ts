import { financeEditSchema } from "@/modules/claims/validators/finance-edit-schema";

describe("financeEditSchema", () => {
  test("accepts allowlisted expense payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      locationId: "44444444-4444-4444-8444-444444444444",
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: "Vendor",
      basicAmount: 120,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      totalAmount: 120,
      purpose: "Client travel",
      productId: "55555555-5555-4555-8555-555555555555",
      peopleInvolved: null,
      remarks: "Updated by finance",
      receiptFile: null,
      bankStatementFile: null,
    });

    expect(result.success).toBe(true);
  });

  test("blocks read-only fields by rejecting unknown keys", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      locationId: "44444444-4444-4444-8444-444444444444",
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: "Vendor",
      basicAmount: 120,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      totalAmount: 141.6,
      purpose: "Client travel",
      productId: null,
      peopleInvolved: null,
      remarks: null,
      receiptFile: null,
      bankStatementFile: null,
      departmentId: "11111111-1111-4111-8111-111111111111",
      paymentModeId: "22222222-2222-4222-8222-222222222222",
      claim_id: "00000000-0000-4000-8000-000000000000",
      submitted_at: "2026-03-15T10:00:00.000Z",
      detail_type: "expense",
    });

    expect(result.success).toBe(false);
  });

  test("accepts allowlisted advance payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "advance",
      purpose: "Petty cash correction",
      requestedAmount: 500,
      expectedUsageDate: "2026-03-20",
      productId: null,
      locationId: null,
      remarks: "Advance remarks",
      receiptFile: null,
    });

    expect(result.success).toBe(true);
  });
});
