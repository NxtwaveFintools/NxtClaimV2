import { newClaimSubmitSchema } from "@/modules/claims/validators/new-claim-schema";

const validExpensePayload = {
  employeeName: "Alice Employee",
  employeeId: "EMP-100",
  ccEmails: undefined,
  hodName: "Dept HOD",
  hodEmail: "hod@nxtwave.co.in",
  submissionType: "Self" as const,
  onBehalfEmail: null,
  onBehalfEmployeeCode: null,
  departmentId: "11111111-1111-4111-8111-111111111111",
  paymentModeId: "22222222-2222-4222-8222-222222222222",
  detailType: "expense" as const,
  expense: {
    billNo: "BILL-1",
    transactionId: "TXN-1",
    purpose: "Travel",
    expenseCategoryId: "33333333-3333-4333-8333-333333333333",
    productId: "44444444-4444-4444-8444-444444444444",
    locationId: "55555555-5555-4555-8555-555555555555",
    isGstApplicable: true,
    gstNumber: "GST-1",
    cgstAmount: 9,
    sgstAmount: 9,
    igstAmount: 0,
    transactionDate: "2026-03-14",
    basicAmount: 100,
    totalAmount: 118,
    currencyCode: "INR",
    vendorName: null,
    receiptFileName: "receipt.pdf",
    receiptFileType: "application/pdf",
    receiptFileBase64: "dGVzdA==",
    bankStatementFileName: null,
    bankStatementFileType: null,
    bankStatementFileBase64: null,
    peopleInvolved: null,
    remarks: null,
  },
  advance: {
    requestedAmount: 500,
    budgetMonth: 3,
    budgetYear: 2026,
    expectedUsageDate: "2026-03-20",
    purpose: "Advance",
    productId: null,
    locationId: null,
    remarks: null,
  },
};

describe("newClaimSubmitSchema", () => {
  test("rejects missing employee ID", () => {
    const parsed = newClaimSubmitSchema.safeParse({
      ...validExpensePayload,
      employeeId: "",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.employeeId).toContain("Employee ID is required");
    }
  });

  test("requires GST number when GST is applicable", () => {
    const parsed = newClaimSubmitSchema.safeParse({
      ...validExpensePayload,
      expense: {
        ...validExpensePayload.expense,
        gstNumber: null,
      },
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => issue.message);
      expect(issues).toContain("GST number is required when GST is applicable.");
    }
  });

  test("accepts provided total amount metadata", () => {
    const parsed = newClaimSubmitSchema.safeParse({
      ...validExpensePayload,
      expense: {
        ...validExpensePayload.expense,
        totalAmount: 130,
      },
    });

    expect(parsed.success).toBe(true);
  });

  test("accepts a valid expense submission", () => {
    const parsed = newClaimSubmitSchema.safeParse(validExpensePayload);
    expect(parsed.success).toBe(true);
  });

  test("accepts bank statement metadata without base64 content", () => {
    const parsed = newClaimSubmitSchema.safeParse({
      ...validExpensePayload,
      expense: {
        ...validExpensePayload.expense,
        bankStatementFileName: "bank-statement.pdf",
        bankStatementFileType: "application/pdf",
        bankStatementFileBase64: null,
      },
    });

    expect(parsed.success).toBe(true);
  });

  test("accepts advance without expected usage date", () => {
    const parsed = newClaimSubmitSchema.safeParse({
      ...validExpensePayload,
      detailType: "advance",
      paymentModeId: "99999999-9999-4999-8999-999999999999",
      advance: {
        ...validExpensePayload.advance,
        expectedUsageDate: null,
      },
    });

    expect(parsed.success).toBe(true);
  });

  test("normalizes empty optional text fields to N/A", () => {
    const parsed = newClaimSubmitSchema.safeParse({
      ...validExpensePayload,
      detailType: "advance",
      paymentModeId: "99999999-9999-4999-8999-999999999999",
      advance: {
        ...validExpensePayload.advance,
        purpose: "   ",
        remarks: null,
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.onBehalfEmail).toBe("N/A");
      expect(parsed.data.onBehalfEmployeeCode).toBe("N/A");
      expect(parsed.data.advance?.purpose).toBe("N/A");
      expect(parsed.data.advance?.remarks).toBe("N/A");
    }
  });
});
