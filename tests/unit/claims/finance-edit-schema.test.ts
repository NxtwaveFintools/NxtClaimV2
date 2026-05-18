import { financeEditSchema } from "@/modules/claims/validators/finance-edit-schema";

describe("financeEditSchema", () => {
  test("accepts expense payload with finance-editable metadata", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Correcting receipt metadata",
      paymentModeId: "22222222-2222-4222-8222-222222222222",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      productId: "22222222-2222-4222-8222-222222222222",
      locationId: "44444444-4444-4444-8444-444444444444",
      locationType: "Out Station",
      locationDetails: "Chennai branch",
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: "Vendor",
      purpose: "Client travel",
      peopleInvolved: null,
      remarks: null,
      receiptFilePath: "expenses/user/new-receipt.pdf",
      bankStatementFilePath: "expenses/user/new-bank.pdf",
      totalAmount: 120,
    });

    expect(result.success).toBe(true);
  });

  test("rejects read-only amount fields even when metadata is present", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Correcting receipt metadata",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      productId: null,
      locationId: "44444444-4444-4444-8444-444444444444",
      locationType: null,
      locationDetails: null,
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: "Vendor",
      purpose: "Client travel",
      peopleInvolved: null,
      remarks: null,
      basicAmount: 120,
      totalAmount: 141.6,
    });

    expect(result.success).toBe(false);
  });

  test("accepts required paymentModeId for finance-stage edit payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Correcting payment mode assignment",
      paymentModeId: "22222222-2222-4222-8222-222222222222",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      productId: null,
      locationId: "44444444-4444-4444-8444-444444444444",
      locationType: null,
      locationDetails: null,
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: null,
      purpose: "Client travel",
      peopleInvolved: null,
      remarks: null,
      totalAmount: 120,
    });

    expect(result.success).toBe(true);
  });

  test("rejects expense payload when detailId is missing", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      editReason: "Correcting receipt metadata",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      productId: null,
      locationId: "44444444-4444-4444-8444-444444444444",
      locationType: null,
      locationDetails: null,
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: null,
      purpose: "Client travel",
      peopleInvolved: null,
      remarks: null,
      totalAmount: 120,
    });

    expect(result.success).toBe(false);
  });

  test("accepts allowlisted advance payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "advance",
      detailId: "22222222-2222-4222-8222-222222222222",
      editReason: "Fixing usage date after review",
      paymentModeId: "33333333-3333-4333-8333-333333333333",
      purpose: "Conference travel advance",
      expectedUsageDate: "2026-04-05",
      productId: "33333333-3333-4333-8333-333333333333",
      locationId: "44444444-4444-4444-8444-444444444444",
      remarks: null,
      supportingDocumentPath: "petty_cash_requests/user/supporting.pdf",
      totalAmount: 500,
    });

    expect(result.success).toBe(true);
  });

  test("requires location details when location type is out station", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Adjusting tax split after reconciliation",
      paymentModeId: "22222222-2222-4222-8222-222222222222",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      productId: null,
      locationId: "44444444-4444-4444-8444-444444444444",
      locationType: "Out Station",
      locationDetails: null,
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: null,
      purpose: "Client travel",
      peopleInvolved: null,
      remarks: null,
      totalAmount: 0,
    });

    expect(result.success).toBe(false);
  });

  test("rejects payloads when editReason is missing", () => {
    const result = financeEditSchema.safeParse({
      detailType: "advance",
      detailId: "22222222-2222-4222-8222-222222222222",
      paymentModeId: "33333333-3333-4333-8333-333333333333",
      purpose: "Conference travel advance",
      expectedUsageDate: "2026-04-05",
      productId: null,
      locationId: null,
      remarks: null,
      totalAmount: 500,
    });

    expect(result.success).toBe(false);
  });

  test("rejects payloads when editReason is shorter than 5 characters", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Fix",
      paymentModeId: "22222222-2222-4222-8222-222222222222",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      productId: null,
      locationId: "44444444-4444-4444-8444-444444444444",
      locationType: null,
      locationDetails: null,
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: null,
      purpose: "Client travel",
      peopleInvolved: null,
      remarks: null,
      totalAmount: 120,
    });

    expect(result.success).toBe(false);
  });

  test("rejects payloads when paymentModeId is missing", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Correcting receipt metadata",
      billNo: "BILL-100",
      expenseCategoryId: "33333333-3333-4333-8333-333333333333",
      productId: null,
      locationId: "44444444-4444-4444-8444-444444444444",
      locationType: null,
      locationDetails: null,
      transactionDate: "2026-03-14",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: null,
      purpose: "Client travel",
      peopleInvolved: null,
      remarks: null,
      totalAmount: 120,
    });

    expect(result.success).toBe(false);
  });
});
