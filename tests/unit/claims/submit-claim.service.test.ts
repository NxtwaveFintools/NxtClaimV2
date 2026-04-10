import { SubmitClaimService } from "@/core/domain/claims/SubmitClaimService";
import type { ClaimRepository } from "@/core/domain/claims/contracts";

const submitterId = "11111111-1111-1111-1111-111111111111";
const departmentApprover1Id = "44444444-4444-4444-4444-444444444444";
const departmentApprover2Id = "88888888-8888-8888-8888-888888888888";

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const baseInput = {
  submissionType: "Self" as const,
  detailType: "expense" as const,
  submittedBy: submitterId,
  onBehalfOfId: null,
  employeeId: "EMP-1001",
  ccEmails: null,
  onBehalfEmail: null,
  onBehalfEmployeeCode: null,
  departmentId: "22222222-2222-2222-2222-222222222222",
  paymentModeId: "33333333-3333-3333-3333-333333333333",
  assignedL2ApproverId: null,
  expense: {
    billNo: "BILL-1",
    transactionId: "TXN-1",
    purpose: "Client visit",
    expenseCategoryId: "55555555-5555-5555-5555-555555555555",
    productId: "77777777-7777-7777-7777-777777777777",
    locationId: "66666666-6666-6666-6666-666666666666",
    locationType: null,
    locationDetails: null,
    isGstApplicable: false,
    gstNumber: null,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    transactionDate: "2026-03-14",
    basicAmount: 100,
    totalAmount: 100,
    currencyCode: "INR",
    vendorName: null,
    receiptFilePath: "expenses/11111111-1111-1111-1111-111111111111/100_bill.pdf",
    bankStatementFilePath: null,
    peopleInvolved: null,
    remarks: null,
  },
};

function createRepository(overrides?: Partial<ClaimRepository>): ClaimRepository {
  const repository: ClaimRepository = {
    getActivePaymentModes: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveDepartments: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveExpenseCategories: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveProducts: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveLocations: jest.fn(async () => ({ data: [], errorMessage: null })),
    getUserSummary: jest.fn(async () => ({
      data: {
        id: baseInput.submittedBy,
        email: "user@nxtwave.co.in",
        fullName: "User",
      },
      errorMessage: null,
    })),
    existsExpenseByCompositeKey: jest.fn(async () => ({ exists: false, errorMessage: null })),
    getPaymentModeById: jest.fn(async () => ({
      data: { id: baseInput.paymentModeId, name: "Reimbursement", isActive: true },
      errorMessage: null,
    })),
    getDepartmentApprovers: jest.fn(async () => ({
      data: {
        approver1Id: departmentApprover1Id,
        approver2Id: departmentApprover2Id,
      },
      errorMessage: null,
    })),
    getActiveUserIdByEmail: jest.fn(async () => ({
      data: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      errorMessage: null,
    })),
    isUserApprover1InAnyDepartment: jest.fn(async (userId: string) => ({
      isApprover1: userId === departmentApprover1Id,
      errorMessage: null,
    })),
    createClaimWithDetail: jest.fn(async () => ({
      claimId: "77777777-7777-7777-7777-777777777777",
      errorMessage: null,
    })),
    createClaimAuditLog: jest.fn(async () => ({ errorMessage: null })),
    getClaimAuditLogs: jest.fn(async () => ({ data: [], errorMessage: null })),
    getClaimForFinanceEdit: jest.fn(async () => ({ data: null, errorMessage: null })),
    getClaimForSubmitterDelete: jest.fn(async () => ({ data: null, errorMessage: null })),
    softDeleteClaimBySubmitter: jest.fn(async () => ({ success: true, errorMessage: null })),
    updateClaimDetailsByFinance: jest.fn(async () => ({ errorMessage: null })),
    getMyClaims: jest.fn(async () => ({ data: [], errorMessage: null })),
    getMyClaimsPaginated: jest.fn(async () => ({
      data: [],
      totalCount: 0,
      errorMessage: null,
    })),
    getApprovalViewerContext: jest.fn(async () => ({
      data: { isHod: false, isFounder: false, isFinance: false },
      errorMessage: null,
    })),
    getPendingApprovalsForL1: jest.fn(async () => ({
      data: [],
      nextCursor: null,
      hasNextPage: false,
      errorMessage: null,
    })),
    getPendingApprovalsForFinance: jest.fn(async () => ({
      data: [],
      nextCursor: null,
      hasNextPage: false,
      errorMessage: null,
    })),
    getClaimsForExport: jest.fn(async () => ({ data: [], errorMessage: null })),
    getClaimListDetails: jest.fn(async () => ({ data: {}, errorMessage: null })),
    getClaimEvidenceSignedUrl: jest.fn(async () => ({ data: null, errorMessage: null })),
  };

  return { ...repository, ...(overrides ?? {}) };
}

describe("SubmitClaimService", () => {
  test("submits an expense claim successfully", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    const result = await service.execute(baseInput);

    expect(result.errorCode).toBeNull();
    expect(result.claimId).toBe("77777777-7777-7777-7777-777777777777");
    expect(repository.createClaimWithDetail).toHaveBeenCalledTimes(1);
  });

  test("accepts petty cash payment mode as expense", async () => {
    const repository = createRepository({
      getPaymentModeById: jest.fn(async () => ({
        data: { id: baseInput.paymentModeId, name: "Petty Cash", isActive: true },
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    const result = await service.execute(baseInput);

    expect(result.errorCode).toBeNull();
    expect(result.claimId).toBe("77777777-7777-7777-7777-777777777777");
    expect(repository.createClaimWithDetail).toHaveBeenCalledTimes(1);
    const createClaimPayload = (repository.createClaimWithDetail as jest.Mock).mock
      .calls[0]?.[0] as {
      claim_id?: string;
    };
    expect(createClaimPayload.claim_id).toMatch(/^CLAIM-/);
  });

  test("generates EA prefix for petty cash request advances", async () => {
    const repository = createRepository({
      getPaymentModeById: jest.fn(async () => ({
        data: { id: baseInput.paymentModeId, name: "Petty Cash Request", isActive: true },
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    const result = await service.execute({
      ...baseInput,
      detailType: "advance",
      advance: {
        requestedAmount: 500,
        budgetMonth: 3,
        budgetYear: 2026,
        expectedUsageDate: "2026-03-25",
        purpose: "Field activation",
        supportingDocumentPath: "advances/11111111-1111-1111-1111-111111111111/support.pdf",
        productId: baseInput.expense.productId,
        locationId: baseInput.expense.locationId,
        remarks: null,
      },
    });

    expect(result.errorCode).toBeNull();
    expect(repository.createClaimWithDetail).toHaveBeenCalledTimes(1);
    const createClaimPayload = (repository.createClaimWithDetail as jest.Mock).mock
      .calls[0]?.[0] as {
      claim_id?: string;
    };
    expect(createClaimPayload.claim_id).toMatch(/^EA-/);
  });

  test("keeps CLAIM prefix for bulk petty cash request advances", async () => {
    const repository = createRepository({
      getPaymentModeById: jest.fn(async () => ({
        data: { id: baseInput.paymentModeId, name: "Bulk Petty Cash Request", isActive: true },
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    const result = await service.execute({
      ...baseInput,
      detailType: "advance",
      advance: {
        requestedAmount: 500,
        budgetMonth: 3,
        budgetYear: 2026,
        expectedUsageDate: "2026-03-25",
        purpose: "Bulk event float",
        supportingDocumentPath: "advances/11111111-1111-1111-1111-111111111111/bulk.pdf",
        productId: baseInput.expense.productId,
        locationId: baseInput.expense.locationId,
        remarks: null,
      },
    });

    expect(result.errorCode).toBeNull();
    expect(repository.createClaimWithDetail).toHaveBeenCalledTimes(1);
    const createClaimPayload = (repository.createClaimWithDetail as jest.Mock).mock
      .calls[0]?.[0] as {
      claim_id?: string;
    };
    expect(createClaimPayload.claim_id).toMatch(/^CLAIM-/);
  });

  test("Should assign Department approver_1 when a standard employee submits", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    await service.execute({
      ...baseInput,
      submittedBy: submitterId,
    });

    expect(repository.createClaimWithDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_l1_approver_id: departmentApprover1Id,
        initial_status: "Submitted - Awaiting HOD approval",
      }),
    );
  });

  test("Routes to Founder when an HOD submits their own claim directly.", async () => {
    const repository = createRepository({
      isUserApprover1InAnyDepartment: jest.fn(async () => ({
        isApprover1: true,
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    await service.execute({
      ...baseInput,
      submittedBy: departmentApprover1Id,
    });

    expect(repository.createClaimWithDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_l1_approver_id: departmentApprover2Id,
        initial_status: "Submitted - Awaiting HOD approval",
      }),
    );
  });

  test("Should escalate and assign Department approver_2 when submitter is HOD in another department", async () => {
    const crossDepartmentHodId = "99999999-9999-9999-9999-999999999999";
    const repository = createRepository({
      isUserApprover1InAnyDepartment: jest.fn(async () => ({
        isApprover1: true,
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    await service.execute({
      ...baseInput,
      submittedBy: crossDepartmentHodId,
    });

    expect(repository.createClaimWithDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_l1_approver_id: departmentApprover2Id,
        initial_status: "Submitted - Awaiting HOD approval",
      }),
    );
  });

  test("rejects detail type mismatch against payment mode", async () => {
    const repository = createRepository({
      getPaymentModeById: jest.fn(async () => ({
        data: { id: baseInput.paymentModeId, name: "Petty Cash Request", isActive: true },
        errorMessage: null,
      })),
    });

    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });
    const result = await service.execute(baseInput);

    expect(result.errorCode).toBe("DETAIL_TYPE_MISMATCH");
    expect(repository.createClaimWithDetail).not.toHaveBeenCalled();
  });

  test("requires on behalf fields for on behalf submission", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    const result = await service.execute({
      ...baseInput,
      submissionType: "On Behalf",
      onBehalfEmail: null,
      onBehalfEmployeeCode: null,
    });

    expect(result.errorCode).toBe("ON_BEHALF_DETAILS_REQUIRED");
    expect(repository.getPaymentModeById).not.toHaveBeenCalled();
  });

  test("Routes to Founder when an employee submits on behalf of an HOD.", async () => {
    const beneficiaryHodId = departmentApprover1Id;
    const repository = createRepository({
      getActiveUserIdByEmail: jest.fn(async () => ({
        data: beneficiaryHodId,
        errorMessage: null,
      })),
      isUserApprover1InAnyDepartment: jest.fn(async (userId: string) => ({
        isApprover1: userId === beneficiaryHodId,
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    await service.execute({
      ...baseInput,
      submissionType: "On Behalf",
      onBehalfEmail: "hod@nxtwave.co.in",
      onBehalfEmployeeCode: "EMP-HOD-100",
      onBehalfOfId: beneficiaryHodId,
      submittedBy: submitterId,
    });

    expect(repository.createClaimWithDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        on_behalf_of_id: beneficiaryHodId,
        assigned_l1_approver_id: departmentApprover2Id,
        initial_status: "Submitted - Awaiting HOD approval",
      }),
    );
  });

  test("Routes to Founder when a normal user submits On Behalf of HOD X to Department Y (Cross-Department Proxy)", async () => {
    const crossDepartmentHodId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const repository = createRepository({
      isUserApprover1InAnyDepartment: jest.fn(async (userId: string) => ({
        isApprover1: userId === crossDepartmentHodId,
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    await service.execute({
      ...baseInput,
      submissionType: "On Behalf",
      onBehalfEmail: "hod-cross-dept@nxtwave.co.in",
      onBehalfEmployeeCode: "EMP-HOD-X",
      onBehalfOfId: crossDepartmentHodId,
      submittedBy: submitterId,
    });

    expect(repository.isUserApprover1InAnyDepartment).toHaveBeenCalledWith(crossDepartmentHodId);
    expect(repository.createClaimWithDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        on_behalf_of_id: crossDepartmentHodId,
        assigned_l1_approver_id: departmentApprover2Id,
        initial_status: "Submitted - Awaiting HOD approval",
      }),
    );
  });

  test("routes proxy submission for founder beneficiary to department approver_2", async () => {
    const beneficiaryFounderId = departmentApprover2Id;
    const repository = createRepository({
      getActiveUserIdByEmail: jest.fn(async () => ({
        data: beneficiaryFounderId,
        errorMessage: null,
      })),
      isUserApprover1InAnyDepartment: jest.fn(async () => ({
        isApprover1: false,
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    await service.execute({
      ...baseInput,
      submissionType: "On Behalf",
      onBehalfEmail: "founder@nxtwave.co.in",
      onBehalfEmployeeCode: "EMP-FND-200",
      onBehalfOfId: beneficiaryFounderId,
      submittedBy: submitterId,
    });

    expect(repository.createClaimWithDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        on_behalf_of_id: beneficiaryFounderId,
        assigned_l1_approver_id: departmentApprover2Id,
        initial_status: "Submitted - Awaiting HOD approval",
      }),
    );
  });

  test("returns INVALID_PAYMENT_MODE when mode is inactive", async () => {
    const repository = createRepository({
      getPaymentModeById: jest.fn(async () => ({
        data: { id: baseInput.paymentModeId, name: "Reimbursement", isActive: false },
        errorMessage: null,
      })),
    });
    const service = new SubmitClaimService({ repository, logger: createLogger() });

    const result = await service.execute(baseInput);

    expect(result).toEqual({
      claimId: null,
      errorCode: "INVALID_PAYMENT_MODE",
      errorMessage: "Payment mode not found or inactive.",
    });
    expect(repository.createClaimWithDetail).not.toHaveBeenCalled();
  });

  test("returns PAYMENT_MODE_NOT_SUPPORTED for unknown mode", async () => {
    const repository = createRepository({
      getPaymentModeById: jest.fn(async () => ({
        data: { id: baseInput.paymentModeId, name: "Custom Mode", isActive: true },
        errorMessage: null,
      })),
    });
    const service = new SubmitClaimService({ repository, logger: createLogger() });

    const result = await service.execute(baseInput);

    expect(result.errorCode).toBe("PAYMENT_MODE_NOT_SUPPORTED");
    expect(result.errorMessage).toContain("Custom Mode");
    expect(repository.createClaimWithDetail).not.toHaveBeenCalled();
  });

  test("returns BENEFICIARY_RESOLUTION_FAILED when on-behalf beneficiary cannot be resolved", async () => {
    const repository = createRepository({
      getActiveUserIdByEmail: jest.fn(async () => ({
        data: null,
        errorMessage: null,
      })),
    });
    const service = new SubmitClaimService({ repository, logger: createLogger() });

    const result = await service.execute({
      ...baseInput,
      submissionType: "On Behalf",
      onBehalfOfId: null,
      onBehalfEmail: "missing@nxtwave.co.in",
      onBehalfEmployeeCode: "EMP-MISSING",
    });

    expect(result).toEqual({
      claimId: null,
      errorCode: "BENEFICIARY_RESOLUTION_FAILED",
      errorMessage: "Unable to resolve or provision on-behalf beneficiary.",
    });
  });

  test("returns DEPARTMENT_ROUTING_MISSING when department has no configured approver", async () => {
    const repository = createRepository({
      getDepartmentApprovers: jest.fn(async () => ({
        data: { approver1Id: null, approver2Id: null },
        errorMessage: null,
      })),
    });
    const service = new SubmitClaimService({ repository, logger: createLogger() });

    const result = await service.execute(baseInput);

    expect(result.errorCode).toBe("DEPARTMENT_ROUTING_MISSING");
    expect(result.errorMessage).toBe("Department approver routing is not configured.");
    expect(repository.createClaimWithDetail).not.toHaveBeenCalled();
  });

  test("returns CLAIM_SUBMISSION_FAILED and logs when create claim fails", async () => {
    const repository = createRepository({
      createClaimWithDetail: jest.fn(async () => ({
        claimId: null,
        errorMessage: "insert failed",
      })),
    });
    const logger = createLogger();
    const service = new SubmitClaimService({ repository, logger });

    const result = await service.execute(baseInput);

    expect(result).toEqual({
      claimId: null,
      errorCode: "CLAIM_SUBMISSION_FAILED",
      errorMessage: "insert failed",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.submit.failed",
      expect.objectContaining({
        paymentModeId: baseInput.paymentModeId,
        detailType: "expense",
        errorMessage: "insert failed",
      }),
    );
  });
});
