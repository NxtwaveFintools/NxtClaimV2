import { financeEditSchema } from "@/modules/claims/validators/finance-edit-schema";

describe("financeEditSchema", () => {
  test("accepts allowlisted expense payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Correcting receipt metadata",
      approvedAmount: 120,
    });

    expect(result.success).toBe(true);
  });

  test("blocks read-only fields by rejecting unknown keys", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Correcting receipt metadata",
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
      claim_id: "00000000-0000-4000-8000-000000000000",
      submitted_at: "2026-03-15T10:00:00.000Z",
      detail_type: "expense",
    });

    expect(result.success).toBe(false);
  });

  test("accepts optional paymentModeId for finance-stage edit payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Correcting payment mode assignment",
      paymentModeId: "22222222-2222-4222-8222-222222222222",
      approvedAmount: 120,
    });

    expect(result.success).toBe(true);
  });

  test("rejects expense payload when detailId is missing", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      editReason: "Correcting receipt metadata",
      approvedAmount: 120,
    });

    expect(result.success).toBe(false);
  });

  test("accepts allowlisted advance payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "advance",
      detailId: "22222222-2222-4222-8222-222222222222",
      editReason: "Fixing usage date after review",
      approvedAmount: 500,
    });

    expect(result.success).toBe(true);
  });

  test("accepts expense payload with smallest positive basic and balanced total", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Adjusting tax split after reconciliation",
      approvedAmount: 0,
    });

    expect(result.success).toBe(true);
  });

  test("rejects payloads when editReason is missing", () => {
    const result = financeEditSchema.safeParse({
      detailType: "advance",
      detailId: "22222222-2222-4222-8222-222222222222",
      approvedAmount: 500,
    });

    expect(result.success).toBe(false);
  });

  test("rejects payloads when editReason is shorter than 5 characters", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      detailId: "11111111-1111-4111-8111-111111111111",
      editReason: "Fix",
      approvedAmount: 120,
    });

    expect(result.success).toBe(false);
  });
});
