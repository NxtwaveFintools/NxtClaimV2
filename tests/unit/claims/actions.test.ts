/** @jest-environment node */

export {};

const mockGetCurrentUser = jest.fn();
const mockGetUserSummary = jest.fn();
const mockGetActivePaymentModes = jest.fn();
const mockGetActiveExpenseCategories = jest.fn();
const mockGetActiveProducts = jest.fn();
const mockGetActiveLocations = jest.fn();
const mockGetPaymentModeById = jest.fn();
const mockExistsExpenseByCompositeKey = jest.fn();
const mockFindActiveExpenseDuplicateClaimIdByCompositeKey = jest.fn();
const mockSyncExpenseDuplicateFlags = jest.fn();
const mockGetActiveUserIdByEmail = jest.fn();
const mockIsUserApprover1InAnyDepartment = jest.fn();
const mockActiveDepartmentsExecute = jest.fn();
const mockPrepareSubmission = jest.fn();
const mockSubmitExecute = jest.fn();
const mockCreateClaimDraft = jest.fn();
const mockCreateExpenseDetailDraft = jest.fn();
const mockCreateAdvanceDetailDraft = jest.fn();
const mockUpdateExpenseDetailEvidencePaths = jest.fn();
const mockUpdateAdvanceDetailEvidencePath = jest.fn();
const mockRollbackClaimSubmissionDraft = jest.fn();
const mockCreateClaimAuditLog = jest.fn();
const mockProcessL1DecisionExecute = jest.fn();
const mockProcessL2DecisionExecute = jest.fn();
const mockUpdateByFinanceExecute = jest.fn();
const mockUpdateOwnClaimExecute = jest.fn();
const mockDeleteOwnClaimExecute = jest.fn();
const mockGetApprovalViewerContext = jest.fn();
const mockGetClaimForFinanceEdit = jest.fn();
const mockGetPendingApprovalsForL1 = jest.fn();
const mockGetClaimDetailById = jest.fn();
const mockGetClaimAuditLogs = jest.fn();
const mockGetFinanceApproverIdsForUser = jest.fn();
const mockGetViewerDepartmentIds = jest.fn();
const mockIsAdmin = jest.fn();
const mockRevalidatePath = jest.fn();
const mockRedirect = jest.fn();
const mockStorageUpload = jest.fn();
const mockStorageRemove = jest.fn();
const mockBulkRerunExtractionFailed = jest.fn();
const mockEnqueueVerificationRun = jest.fn();
const mockRerunVerification = jest.fn();
const mockOverrideVerification = jest.fn();

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
    getPaymentModeById: mockGetPaymentModeById,
    existsExpenseByCompositeKey: mockExistsExpenseByCompositeKey,
    findActiveExpenseDuplicateClaimIdByCompositeKey:
      mockFindActiveExpenseDuplicateClaimIdByCompositeKey,
    syncExpenseDuplicateFlags: mockSyncExpenseDuplicateFlags,
    getActiveUserIdByEmail: mockGetActiveUserIdByEmail,
    isUserApprover1InAnyDepartment: mockIsUserApprover1InAnyDepartment,
    createClaimDraft: mockCreateClaimDraft,
    createExpenseDetailDraft: mockCreateExpenseDetailDraft,
    createAdvanceDetailDraft: mockCreateAdvanceDetailDraft,
    updateExpenseDetailEvidencePaths: mockUpdateExpenseDetailEvidencePaths,
    updateAdvanceDetailEvidencePath: mockUpdateAdvanceDetailEvidencePath,
    rollbackClaimSubmissionDraft: mockRollbackClaimSubmissionDraft,
    createClaimAuditLog: mockCreateClaimAuditLog,
    getApprovalViewerContext: mockGetApprovalViewerContext,
    getClaimForFinanceEdit: mockGetClaimForFinanceEdit,
    getPendingApprovalsForL1: mockGetPendingApprovalsForL1,
    getClaimDetailById: mockGetClaimDetailById,
    getClaimAuditLogs: mockGetClaimAuditLogs,
    getFinanceApproverIdsForUser: mockGetFinanceApproverIdsForUser,
  })),
}));

jest.mock("@/modules/claims/repositories/SupabaseVerificationRepository", () => ({
  SupabaseVerificationRepository: jest.fn().mockImplementation(() => ({
    enqueueVerificationRun: mockEnqueueVerificationRun,
    rerunVerification: mockRerunVerification,
    overrideVerification: mockOverrideVerification,
    bulkRerunExtractionFailed: mockBulkRerunExtractionFailed,
  })),
}));

jest.mock("@/modules/claims/server/is-department-viewer", () => ({
  getViewerDepartmentIds: (...args: unknown[]) => mockGetViewerDepartmentIds(...args),
}));

jest.mock("@/modules/admin/server/is-admin", () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}));

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: jest.fn().mockImplementation(() => ({
    storage: {
      from: jest.fn().mockImplementation(() => ({
        upload: mockStorageUpload,
        remove: mockStorageRemove,
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
    prepareSubmission: mockPrepareSubmission,
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

jest.mock("@/core/domain/claims/UpdateClaimByFinanceService", () => ({
  UpdateClaimByFinanceService: jest.fn().mockImplementation(() => ({
    execute: mockUpdateByFinanceExecute,
  })),
}));

jest.mock("@/core/domain/claims/UpdateOwnClaimService", () => ({
  UpdateOwnClaimService: jest.fn().mockImplementation(() => ({
    execute: mockUpdateOwnClaimExecute,
  })),
}));

jest.mock("@/core/domain/claims/DeleteOwnClaimService", () => ({
  DeleteOwnClaimService: jest.fn().mockImplementation(() => ({
    execute: mockDeleteOwnClaimExecute,
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
    totalAmount: 500,
    budgetMonth: 3,
    budgetYear: 2026,
    expectedUsageDate: "2026-03-20",
    purpose: "Advance",
    productId: null,
    locationId: null,
    remarks: null,
  },
};

const quickViewClaim = {
  id: "claim-1",
  employeeId: "EMP-100",
  departmentId,
  paymentModeId,
  submissionType: "Self" as const,
  detailType: "expense" as const,
  onBehalfOfId: null,
  onBehalfEmail: null,
  onBehalfEmployeeCode: null,
  status: "Submitted - Awaiting HOD approval" as const,
  rejectionReason: null,
  submittedAt: "2026-04-15",
  departmentName: "Finance",
  paymentModeName: "Reimbursement",
  assignedL1ApproverId: hodId,
  assignedL2ApproverId: null,
  submittedBy: "11111111-1111-4111-8111-111111111111",
  submitter: "Alice Employee",
  submitterName: "Alice Employee",
  submitterEmail: "user@nxtwave.co.in",
  beneficiaryName: null,
  beneficiaryEmail: null,
  expense: {
    id: "expense-1",
    billNo: "BILL-1",
    purpose: "Client meeting",
    expenseCategoryId: "66666666-6666-4666-8666-666666666666",
    expenseCategoryName: "Travel",
    productId: "77777777-7777-4777-8777-777777777777",
    productName: "NxtWave",
    locationId: "88888888-8888-4888-8888-888888888888",
    locationName: "Hyderabad",
    locationType: null,
    locationDetails: null,
    transactionDate: "2026-03-14",
    isGstApplicable: true,
    gstNumber: "GSTIN-123",
    basicAmount: 100,
    cgstAmount: 9,
    sgstAmount: 9,
    igstAmount: 0,
    totalAmount: 118,
    vendorName: "Vendor",
    peopleInvolved: null,
    remarks: null,
    aiMetadata: {
      edited_fields: {
        total_amount: {
          original: 113,
        },
      },
    },
    receiptFilePath: null,
    bankStatementFilePath: null,
  },
  advance: null,
};

function createValidExpenseEditFormData(): FormData {
  const formData = new FormData();
  formData.append("detailType", "expense");
  formData.append("detailId", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  formData.append("editReason", "Test edit");
  formData.append("paymentModeId", paymentModeId);
  formData.append("billNo", "BILL-NEW-1");
  formData.append("expenseCategoryId", "66666666-6666-4666-8666-666666666666");
  formData.append("productId", "77777777-7777-4777-8777-777777777777");
  formData.append("locationId", "88888888-8888-4888-8888-888888888888");
  formData.append("locationType", "Out Station");
  formData.append("locationDetails", "Chennai branch office");
  formData.append("transactionDate", "2026-03-22");
  formData.append("isGstApplicable", "true");
  formData.append("gstNumber", "GSTIN-999");
  formData.append("vendorName", "Vendor X");
  formData.append("basicAmount", "100");
  formData.append("cgstAmount", "9");
  formData.append("sgstAmount", "9");
  formData.append("igstAmount", "0");
  formData.append("totalAmount", "118");
  formData.append("foreignCurrencyCode", "INR");
  formData.append("purpose", "Updated purpose");
  formData.append("peopleInvolved", "Alice");
  formData.append("remarks", "Updated remarks");
  return formData;
}

function createValidOwnExpenseEditFormData(): FormData {
  const formData = createValidExpenseEditFormData();
  formData.delete("editReason");
  formData.delete("paymentModeId");
  return formData;
}

describe("claims actions", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();

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

    mockGetPaymentModeById.mockResolvedValue({
      data: {
        id: paymentModeId,
        name: "Reimbursement",
        isActive: true,
      },
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
          approver1: {
            id: hodId,
            email: "hod@nxtwave.co.in",
            fullName: "Dept HOD",
          },
          approver2: {
            id: founderId,
            email: "founder@nxtwave.co.in",
            fullName: "Founder",
          },
        },
      ],
    });

    mockPrepareSubmission.mockImplementation(async (input) => ({
      preparedSubmission: {
        claim: {
          id: "claim-1",
          status: "Submitted - Awaiting HOD approval",
          submissionType: input.submissionType,
          detailType: input.detailType,
          submittedBy: input.submittedBy,
          onBehalfOfId: input.onBehalfOfId ?? input.submittedBy,
          employeeId: input.employeeId,
          ccEmails: input.ccEmails,
          onBehalfEmail: input.onBehalfEmail,
          onBehalfEmployeeCode: input.onBehalfEmployeeCode,
          departmentId: input.departmentId,
          paymentModeId: input.paymentModeId,
          assignedL1ApproverId: hodId,
          assignedL2ApproverId: input.assignedL2ApproverId,
        },
        expense:
          input.detailType === "expense" && input.expense
            ? {
                claimId: "claim-1",
                ...input.expense,
              }
            : undefined,
        advance:
          input.detailType === "advance" && input.advance
            ? {
                claimId: "claim-1",
                ...input.advance,
              }
            : undefined,
      },
      errorCode: null,
      errorMessage: null,
    }));

    mockSubmitExecute.mockResolvedValue({
      errorCode: null,
      errorMessage: null,
      claimId: "claim-1",
    });

    mockCreateClaimDraft.mockResolvedValue({
      claimId: "claim-1",
      errorMessage: null,
    });

    mockCreateExpenseDetailDraft.mockResolvedValue({
      detailId: "expense-detail-1",
      errorMessage: null,
    });

    mockCreateAdvanceDetailDraft.mockResolvedValue({
      detailId: "advance-detail-1",
      errorMessage: null,
    });

    mockUpdateExpenseDetailEvidencePaths.mockResolvedValue({
      errorMessage: null,
    });

    mockUpdateAdvanceDetailEvidencePath.mockResolvedValue({
      errorMessage: null,
    });

    mockRollbackClaimSubmissionDraft.mockResolvedValue({
      errorMessage: null,
    });

    mockCreateClaimAuditLog.mockResolvedValue({
      errorMessage: null,
    });

    mockExistsExpenseByCompositeKey.mockResolvedValue({
      exists: false,
      errorMessage: null,
    });

    mockFindActiveExpenseDuplicateClaimIdByCompositeKey.mockResolvedValue({
      claimId: null,
      errorMessage: null,
    });

    mockSyncExpenseDuplicateFlags.mockResolvedValue({
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

    mockGetApprovalViewerContext.mockResolvedValue({
      data: { isHod: false, isFounder: false, isFinance: true },
      errorMessage: null,
    });

    mockGetClaimForFinanceEdit.mockResolvedValue({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "HOD approved - Awaiting finance approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });

    mockGetPendingApprovalsForL1.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasNextPage: false,
      errorMessage: null,
    });

    mockGetClaimDetailById.mockResolvedValue({
      data: quickViewClaim,
      errorMessage: null,
    });

    mockGetClaimAuditLogs.mockResolvedValue({
      data: [],
      errorMessage: null,
    });

    mockGetFinanceApproverIdsForUser.mockResolvedValue({
      data: [],
      errorMessage: null,
    });

    mockGetViewerDepartmentIds.mockResolvedValue([]);
    mockIsAdmin.mockResolvedValue(false);

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

    mockUpdateByFinanceExecute.mockResolvedValue({
      ok: true,
      errorMessage: null,
    });

    mockUpdateOwnClaimExecute.mockResolvedValue({
      ok: true,
      errorMessage: null,
    });

    mockDeleteOwnClaimExecute.mockResolvedValue({
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
      isGlobalApprover1: false,
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
      isGlobalApprover1: false,
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
    expect(mockPrepareSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        submittedBy: hodId,
        onBehalfOfId: null,
        detailType: "expense",
      }),
    );
  });

  test("submitClaimAction forwards expense aiMetadata when provided", async () => {
    const { submitClaimAction } = await import("@/modules/claims/actions");

    const result = await submitClaimAction({
      ...validExpensePayload,
      expense: {
        ...validExpensePayload.expense,
        aiMetadata: {
          edited_fields: {
            total_amount: {
              original: 113,
            },
          },
        },
      },
    });

    expect(result).toEqual({ ok: true, claimId: "claim-1" });
    expect(mockPrepareSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        expense: expect.objectContaining({
          aiMetadata: {
            edited_fields: {
              total_amount: {
                original: 113,
              },
            },
          },
        }),
      }),
    );
  });

  test("submitClaimAction surfaces service errors", async () => {
    mockCreateClaimDraft.mockResolvedValueOnce({
      claimId: null,
      errorMessage: "Database error",
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
    formData.append("advance.totalAmount", "500");
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
    expect(firstUploadPath).toMatch(
      /^petty_cash_requests\/11111111-1111-4111-8111-111111111111\/claim-1_supporting_v[a-z0-9]+\.pdf$/,
    );
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
      allowResubmission: undefined,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
  });

  test("rejectClaimAction redirects to approvals view when requested", async () => {
    const { rejectClaimAction } = await import("@/modules/claims/actions");

    await rejectClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      redirectToApprovalsView: true,
      rejectionReason: "Invalid bill metadata",
      allowResubmission: true,
    });

    expect(mockProcessL1DecisionExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "reject",
      rejectionReason: "Invalid bill metadata",
      allowResubmission: true,
    });
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard/my-claims?view=approvals");
  });

  test("approveClaimAction redirects to sanitized returnTo path when provided", async () => {
    const { approveClaimAction } = await import("@/modules/claims/actions");

    await approveClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      returnTo: "/dashboard/my-claims?status=Submitted+-+Awaiting+HOD+approval",
    });

    expect(mockRedirect).toHaveBeenCalledWith(
      "/dashboard/my-claims?status=Submitted+-+Awaiting+HOD+approval",
    );
  });

  test("rejectClaimAction ignores unsafe returnTo and falls back to approvals view", async () => {
    const { rejectClaimAction } = await import("@/modules/claims/actions");

    await rejectClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      returnTo: "https://example.com/steal",
      redirectToApprovalsView: true,
      rejectionReason: "Invalid bill metadata",
      allowResubmission: true,
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
      allowResubmission: undefined,
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
      allowResubmission: undefined,
    });
  });

  test("deleteClaimAction delegates to delete service and revalidates", async () => {
    const { deleteClaimAction } = await import("@/modules/claims/actions");

    const result = await deleteClaimAction("11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({ ok: true });
    expect(mockDeleteOwnClaimExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/claims");
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/dashboard/claims/11111111-1111-4111-8111-111111111111",
    );
  });

  test("deleteClaimAction returns unauthorized when current user is missing", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ user: null, errorMessage: "Unauthorized session." });
    const { deleteClaimAction } = await import("@/modules/claims/actions");

    const result = await deleteClaimAction("11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({ ok: false, message: "Unauthorized session." });
    expect(mockDeleteOwnClaimExecute).not.toHaveBeenCalled();
  });

  test("deleteClaimAction surfaces service errors", async () => {
    mockDeleteOwnClaimExecute.mockResolvedValueOnce({
      ok: false,
      errorMessage:
        "Only claims awaiting HOD approval or rejected with resubmission allowed can be deleted.",
    });
    const { deleteClaimAction } = await import("@/modules/claims/actions");

    const result = await deleteClaimAction("11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({
      ok: false,
      message:
        "Only claims awaiting HOD approval or rejected with resubmission allowed can be deleted.",
    });
  });

  test("rejectFinanceAction sends rejection reason to finance decision service", async () => {
    const { rejectFinanceAction } = await import("@/modules/claims/actions");

    const result = await rejectFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      rejectionReason: "Claim amount mismatch",
      allowResubmission: false,
    });

    expect(result).toEqual({ ok: true });
    expect(mockProcessL2DecisionExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "reject",
      rejectionReason: "Claim amount mismatch",
      allowResubmission: false,
    });
  });

  test("updateOwnClaimAction forwards validated expense payload without editReason", async () => {
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });

    const { updateOwnClaimAction } = await import("@/modules/claims/actions");
    const result = await updateOwnClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData: createValidOwnExpenseEditFormData(),
    });

    expect(result).toEqual({ ok: true, message: "Claim details updated." });
    expect(mockUpdateOwnClaimExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      payload: expect.objectContaining({
        detailType: "expense",
        detailId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    });

    const forwardedPayload = mockUpdateOwnClaimExecute.mock.calls[0]?.[0]?.payload;
    expect(forwardedPayload).not.toHaveProperty("editReason");
  });

  test("updateOwnClaimAction rejects routing field mutation attempts", async () => {
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });

    const { updateOwnClaimAction } = await import("@/modules/claims/actions");
    const formData = createValidOwnExpenseEditFormData();
    formData.append("paymentModeId", "99999999-9999-4999-8999-999999999999");

    const result = await updateOwnClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({
      ok: false,
      message: "Routing context fields cannot be edited for an existing claim.",
    });
    expect(mockUpdateOwnClaimExecute).not.toHaveBeenCalled();
  });

  test("updateOwnClaimAction deletes superseded receipt only after DB update succeeds", async () => {
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });

    const { updateOwnClaimAction } = await import("@/modules/claims/actions");
    const formData = createValidOwnExpenseEditFormData();
    formData.append(
      "receiptFile",
      new File(["updated"], "replacement.pdf", { type: "application/pdf" }),
    );

    const result = await updateOwnClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: true, message: "Claim details updated." });
    const forwardedPayload = mockUpdateOwnClaimExecute.mock.calls[0]?.[0]?.payload;
    expect(forwardedPayload.receiptFilePath).toMatch(
      /^expenses\/11111111-1111-4111-8111-111111111111\/11111111-1111-4111-8111-111111111111_receipt_v[a-z0-9]+\.pdf$/,
    );
    expect(mockStorageRemove).toHaveBeenCalledWith(["expenses/old_receipt.pdf"]);
    expect(mockUpdateOwnClaimExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockStorageRemove.mock.invocationCallOrder[0],
    );
  });

  test("updateOwnClaimAction does not update DB or delete old receipt when upload fails", async () => {
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });
    mockStorageUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "upload failed" },
    });

    const { updateOwnClaimAction } = await import("@/modules/claims/actions");
    const formData = createValidOwnExpenseEditFormData();
    formData.append(
      "receiptFile",
      new File(["updated"], "replacement.pdf", { type: "application/pdf" }),
    );

    const result = await updateOwnClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: false, message: "upload failed" });
    expect(mockUpdateOwnClaimExecute).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalledWith(["expenses/old_receipt.pdf"]);
  });

  test("updateOwnClaimAction cleans up new upload when DB update fails and keeps old receipt", async () => {
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });
    mockUpdateOwnClaimExecute.mockResolvedValueOnce({
      ok: false,
      errorMessage: "DB failed",
    });

    const { updateOwnClaimAction } = await import("@/modules/claims/actions");
    const formData = createValidOwnExpenseEditFormData();
    formData.append(
      "receiptFile",
      new File(["updated"], "replacement.pdf", { type: "application/pdf" }),
    );

    const result = await updateOwnClaimAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: false, message: "DB failed" });
    const removeCalls = mockStorageRemove.mock.calls.map((call) => call[0]);
    expect(removeCalls).toContainEqual([
      expect.stringMatching(
        /^expenses\/11111111-1111-4111-8111-111111111111\/11111111-1111-4111-8111-111111111111_receipt_v[a-z0-9]+\.pdf$/,
      ),
    ]);
    expect(removeCalls).not.toContainEqual(["expenses/old_receipt.pdf"]);
  });

  test("updateClaimByFinanceAction uploads replacement receipt and deletes superseded file after DB success", async () => {
    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");
    const formData = createValidExpenseEditFormData();
    formData.append(
      "receiptFile",
      new File(["updated"], "replacement.pdf", { type: "application/pdf" }),
    );

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: true, message: "Claim details updated." });
    const forwardedPayload = mockUpdateByFinanceExecute.mock.calls[0]?.[0]?.payload;
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    expect(forwardedPayload.receiptFilePath).toMatch(
      /^expenses\/11111111-1111-4111-8111-111111111111\/11111111-1111-4111-8111-111111111111_receipt_v[a-z0-9]+\.pdf$/,
    );
    expect(mockStorageRemove).toHaveBeenCalledWith(["expenses/old_receipt.pdf"]);
    expect(mockUpdateByFinanceExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockStorageRemove.mock.invocationCallOrder[0],
    );
  });

  test("updateClaimByFinanceAction surfaces upload failures before DB mutation", async () => {
    mockStorageUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "upload failed" },
    });

    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");
    const formData = createValidExpenseEditFormData();
    formData.append(
      "receiptFile",
      new File(["updated"], "replacement.pdf", { type: "application/pdf" }),
    );

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: false, message: "upload failed" });
    expect(mockUpdateByFinanceExecute).not.toHaveBeenCalled();
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });

  test("updateClaimByFinanceAction cleans up new uploads when DB update fails", async () => {
    mockUpdateByFinanceExecute.mockResolvedValueOnce({
      ok: false,
      errorMessage: "DB failed",
    });

    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");
    const formData = createValidExpenseEditFormData();
    formData.append(
      "receiptFile",
      new File(["updated"], "replacement.pdf", { type: "application/pdf" }),
    );

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: false, message: "DB failed" });
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const removeCalls = mockStorageRemove.mock.calls.map((call) => call[0]);
    expect(removeCalls).toContainEqual([
      expect.stringMatching(
        /^expenses\/11111111-1111-4111-8111-111111111111\/11111111-1111-4111-8111-111111111111_receipt_v[a-z0-9]+\.pdf$/,
      ),
    ]);
    expect(removeCalls).not.toContainEqual(["expenses/old_receipt.pdf"]);
  });

  test("updateClaimByFinanceAction forwards finance-editable metadata including component amounts", async () => {
    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");

    const formData = createValidExpenseEditFormData();

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: true, message: "Claim details updated." });
    expect(mockUpdateByFinanceExecute).toHaveBeenCalledWith({
      claimId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      payload: {
        detailType: "expense",
        detailId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        editReason: "Test edit",
        paymentModeId,
        billNo: "BILL-NEW-1",
        expenseCategoryId: "66666666-6666-4666-8666-666666666666",
        productId: "77777777-7777-4777-8777-777777777777",
        locationId: "88888888-8888-4888-8888-888888888888",
        locationType: "Out Station",
        locationDetails: "Chennai branch office",
        transactionDate: "2026-03-22",
        purpose: "Updated purpose",
        isGstApplicable: true,
        gstNumber: "GSTIN-999",
        vendorName: "Vendor X",
        peopleInvolved: "Alice",
        remarks: "Updated remarks",
        receiptFilePath: "expenses/old_receipt.pdf",
        bankStatementFilePath: "expenses/old_bank.pdf",
        basicAmount: 100,
        cgstAmount: 9,
        sgstAmount: 9,
        igstAmount: 0,
        totalAmount: 118,
        foreignCurrencyCode: "INR",
        foreignBasicAmount: null,
        foreignGstAmount: null,
        foreignTotalAmount: null,
      },
    });
    const forwardedPayload = mockUpdateByFinanceExecute.mock.calls[0]?.[0]?.payload;
    // Component amounts are now finance-editable (commit 8fbcc3d added GST fields
    // to the schema; commit 2c35287 added a DB BEFORE trigger that recomputes
    // total_amount from them). The legacy columns stay excluded.
    expect(forwardedPayload).not.toHaveProperty("departmentId");
    expect(forwardedPayload).not.toHaveProperty("requestedTotalAmount");
    expect(forwardedPayload).not.toHaveProperty("approvedAmount");
    expect(forwardedPayload.bankStatementFilePath).toBe("expenses/old_bank.pdf");
  });

  test("updateClaimByFinanceAction intercepts duplicate before save and returns claimId for Finance user", async () => {
    mockFindActiveExpenseDuplicateClaimIdByCompositeKey.mockResolvedValueOnce({
      claimId: "CLAIM-EXISTING-1",
      errorMessage: null,
    });

    mockUpdateByFinanceExecute.mockRejectedValueOnce({
      code: "23505",
      message: 'duplicate key value violates unique constraint "uq_expense_details_active_bill"',
      details: "Key (bill_no, transaction_date, total_amount) already exists.",
    });

    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData: createValidExpenseEditFormData(),
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Duplicate Alert: A claim with this exact Bill Number, Amount, and Date already exists in Claim #CLAIM-EXISTING-1. Update blocked.",
      duplicateClaimId: "CLAIM-EXISTING-1",
    });
    expect(mockUpdateByFinanceExecute).not.toHaveBeenCalled();
  });

  test("updateClaimByFinanceAction keeps duplicate message generic for non-finance pre-HOD edits", async () => {
    mockGetApprovalViewerContext.mockResolvedValueOnce({
      data: { isHod: false, isFounder: false, isFinance: false },
      errorMessage: null,
    });
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });
    mockFindActiveExpenseDuplicateClaimIdByCompositeKey.mockResolvedValueOnce({
      claimId: "CLAIM-EXISTING-1",
      errorMessage: null,
    });
    mockUpdateByFinanceExecute.mockRejectedValueOnce({
      code: "23505",
      message: 'duplicate key value violates unique constraint "uq_expense_details_active_bill"',
      details: "Key (bill_no, transaction_date, total_amount) already exists.",
    });

    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData: createValidExpenseEditFormData(),
    });

    expect(result).toEqual({
      ok: false,
      message: "A claim with this exact Bill No, Date, and Amount already exists.",
    });
    expect(mockFindActiveExpenseDuplicateClaimIdByCompositeKey).not.toHaveBeenCalled();
  });

  test("updateClaimByFinanceAction rethrows non-duplicate unexpected errors", async () => {
    mockUpdateByFinanceExecute.mockRejectedValueOnce(new Error("database timeout"));

    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");

    await expect(
      updateClaimByFinanceAction({
        claimId: "11111111-1111-4111-8111-111111111111",
        formData: createValidExpenseEditFormData(),
      }),
    ).rejects.toThrow("database timeout");
  });

  test("updateClaimByFinanceAction blocks non-finance users at finance stage", async () => {
    mockGetApprovalViewerContext.mockResolvedValueOnce({
      data: { isHod: true, isFounder: false, isFinance: false },
      errorMessage: null,
    });
    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData: createValidExpenseEditFormData(),
    });

    expect(result).toEqual({
      ok: false,
      message: "You are not authorized to edit this claim.",
    });
    expect(mockUpdateByFinanceExecute).not.toHaveBeenCalled();
  });

  test("updateClaimByFinanceAction allows submitter in pre-HOD stage", async () => {
    mockGetApprovalViewerContext.mockResolvedValueOnce({
      data: { isHod: false, isFounder: false, isFinance: false },
      errorMessage: null,
    });
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });

    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData: createValidExpenseEditFormData(),
    });

    expect(result).toEqual({ ok: true, message: "Claim details updated." });
    expect(mockUpdateByFinanceExecute).toHaveBeenCalled();
  });

  test("updateClaimByFinanceAction allows finance-stage payment mode correction", async () => {
    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");
    const formData = createValidExpenseEditFormData();
    formData.set("paymentModeId", "99999999-9999-4999-8999-999999999999");

    mockGetPaymentModeById.mockResolvedValueOnce({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        name: "Petty Cash",
        isActive: true,
      },
      errorMessage: null,
    });

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: true, message: "Claim details updated." });
    expect(mockUpdateByFinanceExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          paymentModeId: "99999999-9999-4999-8999-999999999999",
        }),
      }),
    );
  });

  test("updateClaimByFinanceAction blocks payment mode correction outside finance stage", async () => {
    mockGetApprovalViewerContext.mockResolvedValueOnce({
      data: { isHod: false, isFounder: false, isFinance: false },
      errorMessage: null,
    });
    mockGetClaimForFinanceEdit.mockResolvedValueOnce({
      data: {
        id: "claim-1",
        detailType: "expense",
        status: "Submitted - Awaiting HOD approval",
        submittedBy: "11111111-1111-4111-8111-111111111111",
        assignedL1ApproverId: "33333333-3333-4333-8333-333333333333",
        paymentModeId,
        expenseReceiptFilePath: "expenses/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    });

    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");
    const formData = createValidExpenseEditFormData();
    formData.set("paymentModeId", "99999999-9999-4999-8999-999999999999");

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({
      ok: false,
      message: "Routing context fields cannot be edited for an existing claim.",
    });
    expect(mockUpdateByFinanceExecute).not.toHaveBeenCalled();
  });

  test("updateClaimByFinanceAction allows corporate card payment mode correction for expense claims", async () => {
    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");
    const formData = createValidExpenseEditFormData();
    formData.set("paymentModeId", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    mockGetPaymentModeById.mockResolvedValueOnce({
      data: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Corporate Card",
        isActive: true,
      },
      errorMessage: null,
    });

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({ ok: true, message: "Claim details updated." });
    expect(mockUpdateByFinanceExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          paymentModeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        }),
      }),
    );
  });

  test("updateClaimByFinanceAction rejects routing field mutation attempts", async () => {
    const { updateClaimByFinanceAction } = await import("@/modules/claims/actions");
    const formData = createValidExpenseEditFormData();
    formData.append("departmentId", departmentId);

    const result = await updateClaimByFinanceAction({
      claimId: "11111111-1111-4111-8111-111111111111",
      formData,
    });

    expect(result).toEqual({
      ok: false,
      message: "Routing context fields cannot be edited for an existing claim.",
    });
    expect(mockUpdateByFinanceExecute).not.toHaveBeenCalled();
  });

  test("bulkApproveL1 resolves global selection via cursor pages and approves claims", async () => {
    mockGetPendingApprovalsForL1
      .mockResolvedValueOnce({
        data: [{ id: "claim-1" }],
        nextCursor: "cursor-1",
        hasNextPage: true,
        errorMessage: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: "claim-2" }],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: null,
      });

    const { bulkApproveL1 } = await import("@/modules/claims/actions");

    const result = await bulkApproveL1({
      claimIds: [],
      isGlobalSelect: true,
      filters: { submissionType: "Self" },
    });

    expect(result).toEqual({
      ok: true,
      message: "2 claim(s) approved.",
      processedCount: 2,
    });
    expect(mockGetPendingApprovalsForL1).toHaveBeenNthCalledWith(
      1,
      "11111111-1111-4111-8111-111111111111",
      null,
      200,
      { submissionType: "Self" },
    );
    expect(mockGetPendingApprovalsForL1).toHaveBeenNthCalledWith(
      2,
      "11111111-1111-4111-8111-111111111111",
      "cursor-1",
      200,
      { submissionType: "Self" },
    );
    expect(mockProcessL1DecisionExecute).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "approve",
      rejectionReason: undefined,
      allowResubmission: undefined,
    });
    expect(mockProcessL1DecisionExecute).toHaveBeenCalledWith({
      claimId: "claim-2",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "approve",
      rejectionReason: undefined,
      allowResubmission: undefined,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
  });

  test("bulkRejectL1 reports skipped claims when some decisions fail", async () => {
    mockProcessL1DecisionExecute
      .mockResolvedValueOnce({ ok: true, errorMessage: null })
      .mockResolvedValueOnce({ ok: false, errorMessage: "Claim not pending" });

    const { bulkRejectL1 } = await import("@/modules/claims/actions");

    const result = await bulkRejectL1({
      claimIds: [" claim-1 ", "claim-2", "claim-1"],
      isGlobalSelect: false,
      rejectionReason: "Needs correction",
      allowResubmission: true,
    });

    expect(result).toEqual({
      ok: true,
      message: "1 claim(s) rejected. 1 claim(s) skipped.",
      processedCount: 1,
    });
    expect(mockProcessL1DecisionExecute).toHaveBeenNthCalledWith(1, {
      claimId: "claim-1",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "reject",
      rejectionReason: "Needs correction",
      allowResubmission: true,
    });
    expect(mockProcessL1DecisionExecute).toHaveBeenNthCalledWith(2, {
      claimId: "claim-2",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      decision: "reject",
      rejectionReason: "Needs correction",
      allowResubmission: true,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
  });
});

describe("bulkRerunExtractionFailedAction", () => {
  beforeEach(() => {
    mockRevalidatePath.mockClear();
    mockGetCurrentUser.mockResolvedValue({
      user: { id: "user-1", email: "fin@nxtwave.co.in" },
      errorMessage: null,
    });
    mockGetFinanceApproverIdsForUser.mockResolvedValue({
      data: ["approver-1"],
      errorMessage: null,
    });
    mockBulkRerunExtractionFailed.mockResolvedValue({ data: 7, errorMessage: null });
  });

  test("rejects unauthenticated sessions", async () => {
    mockGetCurrentUser.mockResolvedValue({ user: null, errorMessage: "No session." });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result.ok).toBe(false);
    expect(mockBulkRerunExtractionFailed).not.toHaveBeenCalled();
  });

  test("rejects non finance approvers", async () => {
    mockGetFinanceApproverIdsForUser.mockResolvedValue({ data: [], errorMessage: null });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result).toEqual({
      ok: false,
      message: "Only finance approvers can re-run AI verification.",
    });
    expect(mockBulkRerunExtractionFailed).not.toHaveBeenCalled();
  });

  test("re-queues via the repository and returns the count for approvers", async () => {
    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(mockBulkRerunExtractionFailed).toHaveBeenCalledWith({ actorId: "user-1" });
    expect(result).toEqual({ ok: true, count: 7 });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims", "page");
  });

  test("surfaces repository errors", async () => {
    mockBulkRerunExtractionFailed.mockResolvedValue({
      data: null,
      errorMessage: "rpc exploded",
    });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result).toEqual({ ok: false, message: "rpc exploded" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  test("returns count 0 when nothing matched", async () => {
    mockBulkRerunExtractionFailed.mockResolvedValue({ data: 0, errorMessage: null });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result).toEqual({ ok: true, count: 0 });
  });
});
