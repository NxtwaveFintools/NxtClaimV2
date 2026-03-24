import { financeEditSchema } from "@/modules/claims/validators/finance-edit-schema";

describe("financeEditSchema", () => {
  test("accepts allowlisted expense payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      billNo: "BILL-100",
      vendorName: "Vendor",
      basicAmount: 120,
      purpose: "Client travel",
      productId: "11111111-1111-4111-8111-111111111111",
      remarks: "Updated by finance",
      receiptFile: null,
    });

    expect(result.success).toBe(true);
  });

  test("blocks read-only fields by rejecting unknown keys", () => {
    const result = financeEditSchema.safeParse({
      detailType: "expense",
      billNo: "BILL-100",
      vendorName: "Vendor",
      basicAmount: 120,
      totalAmount: 141.6,
      purpose: "Client travel",
      productId: null,
      remarks: null,
      receiptFile: null,
      claim_id: "00000000-0000-4000-8000-000000000000",
      transaction_date: "2026-03-15",
      department_id: "00000000-0000-4000-8000-000000000001",
      payment_mode_id: "00000000-0000-4000-8000-000000000002",
      submitted_at: "2026-03-15T10:00:00.000Z",
      detail_type: "expense",
    });

    expect(result.success).toBe(false);
  });

  test("accepts allowlisted advance payload", () => {
    const result = financeEditSchema.safeParse({
      detailType: "advance",
      purpose: "Petty cash correction",
      productId: null,
      remarks: "Advance remarks",
      receiptFile: null,
    });

    expect(result.success).toBe(true);
  });
});
