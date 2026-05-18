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
      totalAmount: 500,
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

describe("ownEditSchema — foreign currency validation", () => {
  const baseExpense = {
    detailType: "expense",
    detailId: "11111111-1111-4111-8111-111111111111",
    billNo: "BILL-100",
    expenseCategoryId: "33333333-3333-4333-8333-333333333333",
    locationId: "44444444-4444-4444-8444-444444444444",
    transactionDate: "2026-03-14",
    isGstApplicable: false,
    gstNumber: null,
    vendorName: "Vendor",
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    purpose: "Client meeting",
    productId: null,
    peopleInvolved: null,
    remarks: null,
    receiptFile: null,
    bankStatementFile: null,
  };

  test("foreign-currency claim with basicAmount=0 and foreignBasicAmount>0 passes", () => {
    const result = ownEditSchema.safeParse({
      ...baseExpense,
      basicAmount: 0,
      foreignCurrencyCode: "USD",
      foreignBasicAmount: 99.5,
    });

    expect(result.success).toBe(true);
  });

  test("INR claim with basicAmount=0 fails", () => {
    const result = ownEditSchema.safeParse({
      ...baseExpense,
      basicAmount: 0,
      foreignCurrencyCode: "INR",
    });

    expect(result.success).toBe(false);
    expect(
      result.success === false &&
        result.error.issues.some((i) => i.message === "Basic amount must be greater than zero"),
    ).toBe(true);
  });

  test("foreign-currency claim with foreignBasicAmount=0 fails", () => {
    const result = ownEditSchema.safeParse({
      ...baseExpense,
      basicAmount: 0,
      foreignCurrencyCode: "USD",
      foreignBasicAmount: 0,
    });

    expect(result.success).toBe(false);
    expect(
      result.success === false &&
        result.error.issues.some(
          (i) => i.message === "Foreign basic amount is required for non-INR currencies.",
        ),
    ).toBe(true);
  });
});
