import { ownEditSchema } from "@/modules/claims/validators/own-edit-schema";

describe("ownEditSchema", () => {
  test("accepts expense payload without editReason", () => {
    const result = ownEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      locationId: "44444444-4444-4444-8444-444444444444",
      transactionDate: "2026-03-14",
      isGstApplicable: true,
      gstNumber: "36ABCDE1234F1Z5",
      vendorName: "Vendor",
      basicAmount: 100,
      cgstAmount: 9,
      sgstAmount: 9,
      igstAmount: 0,
      totalAmount: 118,
      purpose: "Client meeting",
      productId: "55555555-5555-4555-8555-555555555555",
      peopleInvolved: "Alice",
      remarks: "Updated notes",
      receiptFile: null,
      bankStatementFile: null,
    });

    expect(result.success).toBe(true);
  });

  test("rejects unknown finance-only fields", () => {
    const result = ownEditSchema.safeParse({
      detailType: "advance",
      detailId: "22222222-2222-4222-8222-222222222222",
      purpose: "Travel advance",
      requestedAmount: 500,
      expectedUsageDate: "2026-03-20",
      productId: null,
      locationId: null,
      remarks: "Advance remarks",
      receiptFile: null,
      editReason: "Should not be provided in own-edit payload",
    });

    expect(result.success).toBe(false);
  });
});
