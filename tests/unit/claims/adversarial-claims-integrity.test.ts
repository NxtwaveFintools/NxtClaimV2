import { SubmitClaimService } from "@/core/domain/claims/SubmitClaimService";
import { GetWalletSummaryService } from "@/core/domain/dashboard/GetWalletSummaryService";
import { ProcessL2ClaimDecisionService } from "@/core/domain/claims/ProcessL2ClaimDecisionService";
import type { ClaimRepository } from "@/core/domain/claims/contracts";
import type { DashboardRepository } from "@/core/domain/dashboard/contracts";

const submitterId = "11111111-1111-1111-1111-111111111111";
const departmentApprover1Id = "44444444-4444-4444-4444-444444444444";
const departmentApprover2Id = "88888888-8888-8888-8888-888888888888";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const baseExpenseInput = {
  submissionType: "Self" as const,
  detailType: "expense" as const,
  submittedBy: submitterId,
  onBehalfOfId: null,
  employeeId: "EMP-ADV-1001",
  ccEmails: null,
  onBehalfEmail: null,
  onBehalfEmployeeCode: null,
  departmentId: "22222222-2222-2222-2222-222222222222",
  paymentModeId: "33333333-3333-3333-3333-333333333333",
  assignedL2ApproverId: null,
  expense: {
    billNo: "BILL-ADV-1",
    transactionId: "TXN-ADV-1",
    purpose: "Adversarial integrity probe",
    expenseCategoryId: "55555555-5555-5555-5555-555555555555",
    productId: "77777777-7777-7777-7777-777777777777",
    locationId: "66666666-6666-6666-6666-666666666666",
    isGstApplicable: true,
    gstNumber: "GST-ADV-123",
    cgstAmount: 9,
    sgstAmount: 9,
    igstAmount: 0,
    transactionDate: "2026-03-14",
    basicAmount: 100,
    currencyCode: "INR",
    vendorName: null,
    receiptFilePath: "expenses/11111111-1111-1111-1111-111111111111/adv_bill.pdf",
    bankStatementFilePath: null,
    peopleInvolved: null,
    remarks: null,
  },
};

function createClaimRepository(overrides?: Partial<ClaimRepository>): ClaimRepository {
  const repository: ClaimRepository = {
    getActivePaymentModes: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveDepartments: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveExpenseCategories: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveProducts: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveLocations: jest.fn(async () => ({ data: [], errorMessage: null })),
    getUserSummary: jest.fn(async () => ({
      data: {
        id: baseExpenseInput.submittedBy,
        email: "user@nxtwave.co.in",
        fullName: "User",
      },
      errorMessage: null,
    })),
    existsExpenseByCompositeKey: jest.fn(async () => ({ exists: false, errorMessage: null })),
    getPaymentModeById: jest.fn(async () => ({
      data: { id: baseExpenseInput.paymentModeId, name: "Reimbursement", isActive: true },
      errorMessage: null,
    })),
    getDepartmentApprovers: jest.fn(async () => ({
      data: {
        approver1Id: departmentApprover1Id,
        approver2Id: departmentApprover2Id,
      },
      errorMessage: null,
    })),
    getActiveUserIdByEmail: jest.fn(async () => ({ data: null, errorMessage: null })),
    isUserApprover1InAnyDepartment: jest.fn(async () => ({
      isApprover1: false,
      errorMessage: null,
    })),
    createClaimWithDetail: jest.fn(async () => ({
      claimId: "CLAIM-ADV-TEST-20260317-0001",
      errorMessage: null,
    })),
    createClaimAuditLog: jest.fn(async () => ({ errorMessage: null })),
    getClaimAuditLogs: jest.fn(async () => ({ data: [], errorMessage: null })),
    getClaimForFinanceEdit: jest.fn(async () => ({ data: null, errorMessage: null })),
    updateClaimDetailsByFinance: jest.fn(async () => ({ errorMessage: null })),
    getMyClaims: jest.fn(async () => ({ data: [], errorMessage: null })),
    getMyClaimsPaginated: jest.fn(async () => ({
      data: [],
      nextCursor: null,
      hasNextPage: false,
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

describe("Adversarial Service Integrity", () => {
  test("SubmitClaimService must reject negative monetary payloads", async () => {
    const repository = createClaimRepository();
    const service = new SubmitClaimService({ repository, logger: createLogger() });

    const result = await service.execute({
      ...baseExpenseInput,
      expense: {
        ...baseExpenseInput.expense,
        basicAmount: -100,
      },
    });

    expect(result.claimId).toBeNull();
    expect(repository.createClaimWithDetail).not.toHaveBeenCalled();
  });

  test("SubmitClaimService accepts valid expense amounts without client total field", async () => {
    const repository = createClaimRepository();
    const service = new SubmitClaimService({ repository, logger: createLogger() });

    const result = await service.execute({
      ...baseExpenseInput,
      expense: {
        ...baseExpenseInput.expense,
        basicAmount: 100,
        cgstAmount: 9,
        sgstAmount: 9,
        igstAmount: 0,
      },
    });

    expect(result.errorMessage).toBeNull();
    expect(result.claimId).not.toBeNull();
    expect(repository.createClaimWithDetail).toHaveBeenCalledTimes(1);
  });

  test("GetWalletSummaryService must reject negative ledger inputs", async () => {
    const repository: DashboardRepository = {
      getWalletTotals: jest.fn(async () => ({
        data: {
          totalPettyCashReceived: -100,
          totalPettyCashSpent: 50,
          totalReimbursements: 20,
          pettyCashBalance: -130,
        },
        errorMessage: null,
      })),
    };

    const service = new GetWalletSummaryService({ repository, logger: createLogger() });
    const result = await service.execute("user-adversarial");

    expect(result.errorMessage).not.toBeNull();
    expect(result.data).toBeNull();
  });

  test("ProcessL2ClaimDecisionService must block standard employee finance approval attempts", async () => {
    const repository = {
      getClaimForL2Decision: jest.fn(async () => ({
        data: {
          id: "claim-adv-1",
          status: "HOD approved - Awaiting finance approval" as const,
          assignedL2ApproverId: "finance-owner-id",
        },
        errorMessage: null,
      })),
      getFinanceApproverIdsForUser: jest.fn(async () => ({
        data: [],
        errorMessage: null,
      })),
      updateClaimL2Decision: jest.fn(async () => ({ errorMessage: null })),
    };

    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-adv-1",
      actorUserId: "standard-employee-id",
      decision: "approve",
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("You are not authorized to process this finance decision.");
    expect(repository.updateClaimL2Decision).not.toHaveBeenCalled();
  });
});
