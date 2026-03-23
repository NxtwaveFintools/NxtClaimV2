/** @jest-environment node */

const mockGetCurrentUser = jest.fn();
const mockGetUserSummary = jest.fn();
const mockGetActivePaymentModes = jest.fn();
const mockGetActiveExpenseCategories = jest.fn();
const mockGetActiveProducts = jest.fn();
const mockGetActiveLocations = jest.fn();
const mockExistsExpenseByCompositeKey = jest.fn();
const mockGetActiveUserIdByEmail = jest.fn();
const mockIsUserApprover1InAnyDepartment = jest.fn();
const mockActiveDepartmentsExecute = jest.fn();
const mockSubmitExecute = jest.fn();
const mockProcessL1DecisionExecute = jest.fn();
const mockProcessL2DecisionExecute = jest.fn();
const mockRevalidatePath = jest.fn();
const mockRedirect = jest.fn();
const mockStorageUpload = jest.fn();

jest.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

jest.mock("@/modules/auth/repositories/supabase-server-auth.repository", () => ({
  SupabaseServerAuthRepository: jest.fn().mockImplementation(() => ({
    getCurrentUser: mockGetCurrentUser,
  })),
}));

jest.mock("@/modules/claims/repositories/SupabaseClaimRepository", () => ({
  SupabaseClaimRepository: jest.fn().mockImplementation(() => ({
    getUserSummary: mockGetUserSummary,
    getActivePaymentModes: mockGetActivePaymentModes,
    getActiveExpenseCategories: mockGetActiveExpenseCategories,
    getActiveProducts: mockGetActiveProducts,
    getActiveLocations: mockGetActiveLocations,
    existsExpenseByCompositeKey: mockExistsExpenseByCompositeKey,
    getActiveUserIdByEmail: mockGetActiveUserIdByEmail,
    isUserApprover1InAnyDepartment: mockIsUserApprover1InAnyDepartment,
  })),
}));

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: jest.fn().mockImplementation(() => ({
    storage: {
      from: jest.fn().mockImplementation(() => ({
        upload: mockStorageUpload,
      })),
    },
  })),
}));

jest.mock("@/modules/departments/repositories/SupabaseDepartmentRepository", () => ({
  SupabaseDepartmentRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/core/domain/departments/GetActiveDepartmentsService", () => ({
  GetActiveDepartmentsService: jest.fn().mockImplementation(() => ({
    execute: mockActiveDepartmentsExecute,
  })),
}));

jest.mock("@/core/domain/claims/SubmitClaimService", () => ({
  SubmitClaimService: jest.fn().mockImplementation(() => ({
    execute: mockSubmitExecute,
  })),
}));

jest.mock("@/core/domain/claims/ProcessL1ClaimDecisionService", () => ({
  ProcessL1ClaimDecisionService: jest.fn().mockImplementation(() => ({
    execute: mockProcessL1DecisionExecute,
  })),
}));

jest.mock("@/core/domain/claims/ProcessL2ClaimDecisionService", () => ({
  ProcessL2ClaimDecisionService: jest.fn().mockImplementation(() => ({
    execute: mockProcessL2DecisionExecute,
  })),
}));

const departmentId = "22222222-2222-4222-8222-222222222222";
const hodId = "33333333-3333-4333-8333-333333333333";
const founderId = "44444444-4444-4444-8444-444444444444";
const paymentModeId = "55555555-5555-4555-8555-555555555555";

const validExpensePayload = {
  employeeName: "Alice Employee",
  employeeId: "EMP-100",
  ccEmails: "cc@example.com",
  hodName: "HOD",
  hodEmail: "hod@nxtwave.co.in",
  submissionType: "Self" as const,
  onBehalfEmail: null,
  onBehalfEmployeeCode: null,
  departmentId,
  paymentModeId,
  detailType: "expense" as const,
  expense: {
    billNo: "BILL-1",
    transactionId: "TXN-1",
    purpose: "Client meeting",
    expenseCategoryId: "66666666-6666-4666-8666-666666666666",
    productId: "77777777-7777-4777-8777-777777777777",
    locationId: "88888888-8888-4888-8888-888888888888",
    isGstApplicable: true,
    gstNumber: "GSTIN-123",
    cgstAmount: 9,
    sgstAmount: 9,
    igstAmount: 0,
    transactionDate: "2026-03-14",
    basicAmount: 100,
    totalAmount: 118,
    currencyCode: "INR",
    vendorName: "Vendor",
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

describe("claims actions", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockGetCurrentUser.mockResolvedValue({
      user: { id: "11111111-1111-4111-8111-111111111111", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });

    mockGetUserSummary.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "user@nxtwave.co.in",
        fullName: "Alice Employee",
      },
      errorMessage: null,
    });

    mockGetActivePaymentModes.mockResolvedValue({
      data: [
        { id: paymentModeId, name: "Reimbursement" },
        { id: "99999999-9999-4999-8999-999999999999", name: "Petty Cash Request" },
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Unsupported" },
      ],
      errorMessage: null,
    });

    mockGetActiveExpenseCategories.mockResolvedValue({
      data: [{ id: "cat-1", name: "Travel" }],
      errorMessage: null,
    });

    mockGetActiveProducts.mockResolvedValue({
      data: [{ id: "prod-1", name: "NxtWave" }],
      errorMessage: null,
    });

    mockGetActiveLocations.mockResolvedValue({
      data: [{ id: "loc-1", name: "Hyderabad" }],
      errorMessage: null,
    });

    mockActiveDepartmentsExecute.mockResolvedValue({
      errorCode: null,
      errorMessage: null,
      departments: [
        {
          id: departmentId,
          name: "Finance",
          isActive: true,
          hod: {
            id: hodId,
            email: "hod@nxtwave.co.in",
            fullName: "Dept HOD",
          },
          founder: {
            id: founderId,
            email: "founder@nxtwave.co.in",
            fullName: "Founder",
          },
        },
      ],
    });

    mockSubmitExecute.mockResolvedValue({
      errorCode: null,
      errorMessage: null,
      claimId: "claim-1",
    });

    mockExistsExpenseByCompositeKey.mockResolvedValue({
      exists: false,
      errorMessage: null,
    });

    mockGetActiveUserIdByEmail.mockResolvedValue({
      data: "77777777-7777-4777-8777-777777777777",
      errorMessage: null,
    });

    mockIsUserApprover1InAnyDepartment.mockResolvedValue({
      isApprover1: false,
      errorMessage: null,
    });

    mockStorageUpload.mockResolvedValue({
      data: { path: "expenses/user/receipt.pdf" },
      error: null,
    });

    mockProcessL1DecisionExecute.mockResolvedValue({
      ok: true,
      errorMessage: null,
    });

    mockProcessL2DecisionExecute.mockResolvedValue({
      ok: true,
      errorMessage: null,
    });
  });

  test("getClaimFormHydrationAction returns user hydration and filtered payment modes", async () => {
    const { getClaimFormHydrationAction } = await import("@/modules/claims/actions");

    const result = await getClaimFormHydrationAction();

    expect(result.errorMessage).toBeNull();
    expect(result.data?.currentUser).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@nxtwave.co.in",
      name: "Alice Employee",
      isGlobalHod: false,
    });
    expect(result.data?.options.paymentModes).toEqual([
      { id: paymentModeId, name: "Reimbursement", detailType: "expense" },
      {
        id: "99999999-9999-4999-8999-999999999999",
        name: "Petty Cash Request",
        detailType: "advance",
      },
    ]);
  });

  test("getClaimFormHydrationAction falls back to auth user when user summary is missing", async () => {
    mockGetUserSummary.mockResolvedValueOnce({
      data: null,
      errorMessage: null,
    });

    const { getClaimFormHydrationAction } = await import("@/modules/claims/actions");
    const result = await getClaimFormHydrationAction();

    expect(result.errorMessage).toBeNull();
    expect(result.data?.currentUser).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@nxtwave.co.in",
      name: "user@nxtwave.co.in",
      isGlobalHod: false,
    });
  });

  test("submitClaimAction rejects invalid payload", async () => {
    const { submitClaimAction } = await import("@/modules/claims/actions");

    const result = await submitClaimAction({});

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Validation failed.");
    expect(result.fieldErrors).toBeDefined();
  });

  test("submitClaimAction returns unauthorized when current user missing", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ user: null, errorMessage: "Unauthorized session." });
    const { submitClaimAction } = await import("@/modules/claims/actions");

    const result = await submitClaimAction(validExpensePayload);

    expect(result).toEqual({ ok: false, message: "Unauthorized session." });
  });

  test("submitClaimAction rejects inactive or missing department", async () => {
    mockActiveDepartmentsExecute.mockResolvedValueOnce({
      errorCode: null,
      errorMessage: null,
      departments: [],
    });

    const { submitClaimAction } = await import("@/modules/claims/actions");
    const result = await submitClaimAction(validExpensePayload);

    expect(result).toEqual({
      ok: false,
      message: "Selected department is invalid or inactive.",
    });
  });

  test("submitClaimAction forwards submitter and detail payload to the submit service", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({
      user: { id: hodId, email: "hod@nxtwave.co.in" },
      errorMessage: null,
    });

    const { submitClaimAction } = await import("@/modules/claims/actions");
    const result = await submitClaimAction(validExpensePayload);

    expect(result).toEqual({ ok: true, claimId: "claim-1" });
    expect(mockSubmitExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        submittedBy: hodId,
        onBehalfOfId: null,
        detailType: "expense",
      }),
    );
  });

  test("submitClaimAction surfaces service errors", async () => {
    mockSubmitExecute.mockResolvedValueOnce({
      errorCode: "CREATE_FAILED",
      errorMessage: "Database error",
      claimId: null,
    });

    const { submitClaimAction } = await import("@/modules/claims/actions");
    const result = await submitClaimAction(validExpensePayload);

    expect(result).toEqual({ ok: false, message: "Database error" });
  });

  test("submitClaimAction returns duplicate transaction error", async () => {
    mockExistsExpenseByCompositeKey.mockResolvedValueOnce({
      exists: true,
      errorMessage: null,
    });

    const { submitClaimAction } = await import("@/modules/claims/actions");
    const result = await submitClaimAction(validExpensePayload);

    expect(result).toEqual({
      ok: false,
      errorCode: "DUPLICATE_TRANSACTION",
      message: "A claim with this exact Bill No, Date, and Amount already exists.",
    });
  });

  test("submitClaimAction uploads advance supporting document to petty_cash_requests path", async () => {
    const { submitClaimAction } = await import("@/modules/claims/actions");

    const formData = new FormData();
    formData.append("employeeName", "Alice Employee");
    formData.append("employeeId", "EMP-100");
    formData.append("hodName", "Dept HOD");
    formData.append("hodEmail", "hod@nxtwave.co.in");
    formData.append("submissionType", "Self");
    formData.append("departmentId", departmentId);
    formData.append("paymentModeId", "99999999-9999-4999-8999-999999999999");
    formData.append("detailType", "advance");
    formData.append("advance.requestedAmount", "500");
    formData.append("advance.budgetMonth", "3");
    formData.append("advance.budgetYear", "2026");
    formData.append("advance.expectedUsageDate", "");
    formData.append("advance.purpose", "Team snacks and local expenses");
    formData.append("advance.receiptFileName", "supporting.pdf");
    formData.append("advance.receiptFileBase64", "dGVzdA==");
    formData.append("advance.productId", "");
    formData.append("advance.locationId", "");
    formData.append("advance.remarks", "");

    const result = await submitClaimAction(formData);

    expect(result).toEqual({ ok: true, claimId: "claim-1" });
    expect(mockStorageUpload).toHaveBeenCalled();
    const firstUploadPath = mockStorageUpload.mock.calls[0]?.[0] as string;
    expect(firstUploadPath).toMatch(/^petty_cash_requests\/11111111-1111-4111-8111-111111111111\//);
  });

  test("approveClaimAction routes claim for finance and revalidates list", async () => {
    const { approveClaimAction } = await import("@/modules/claims/actions");

    const result = await approveClaimAction({ claimId: "11111111-1111-4111-8111-111111111111" });

    expect(result).toEqual({ ok: true });
    expect(mockProcessL1DecisionExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "approve",
      rejectionReason: undefined,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
  });

  test("rejectClaimAction redirects to approvals view when requested", async () => {
    const { rejectClaimAction } = await import("@/modules/claims/actions");

    await rejectClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      redirectToApprovalsView: true,
      rejectionReason: "Invalid bill metadata",
    });

    expect(mockProcessL1DecisionExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "reject",
      rejectionReason: "Invalid bill metadata",
    });
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard/my-claims?view=approvals");
  });

  test("approveFinanceAction transitions finance authorization stage", async () => {
    const { approveFinanceAction } = await import("@/modules/claims/actions");

    const result = await approveFinanceAction({ claimId: "11111111-1111-4111-8111-111111111111" });

    expect(result).toEqual({ ok: true });
    expect(mockProcessL2DecisionExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "approve",
      rejectionReason: undefined,
    });
  });

  test("markPaymentDoneAction triggers finance execution completion", async () => {
    const { markPaymentDoneAction } = await import("@/modules/claims/actions");

    const result = await markPaymentDoneAction({ claimId: "11111111-1111-4111-8111-111111111111" });

    expect(result).toEqual({ ok: true });
    expect(mockProcessL2DecisionExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "mark-paid",
      rejectionReason: undefined,
    });
  });

  test("rejectFinanceAction sends rejection reason to finance decision service", async () => {
    const { rejectFinanceAction } = await import("@/modules/claims/actions");

    const result = await rejectFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      rejectionReason: "Claim amount mismatch",
    });

    expect(result).toEqual({ ok: true });
    expect(mockProcessL2DecisionExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "reject",
      rejectionReason: "Claim amount mismatch",
    });
  });
});
