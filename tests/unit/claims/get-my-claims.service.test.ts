import { GetMyClaimsService } from "@/core/domain/claims/GetMyClaimsService";
import type { ClaimRepository, MyClaimRecord } from "@/core/domain/claims/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(overrides?: Partial<ClaimRepository>): ClaimRepository {
  const defaultRows: MyClaimRecord[] = [
    {
      id: "claim-expense-1",
      employeeId: "EMP-100",
      onBehalfEmail: null,
      departmentName: "Finance",
      paymentModeName: "Reimbursement",
      submissionType: "Self",
      status: "Submitted - Awaiting HOD approval",
      submittedAt: "2026-03-14T10:00:00.000Z",
      expenseTotalAmount: 118,
      advanceRequestedAmount: null,
    },
    {
      id: "claim-advance-1",
      employeeId: "EMP-200",
      onBehalfEmail: "delegate@nxtwave.co.in",
      departmentName: "Operations",
      paymentModeName: "Petty Cash Request",
      submissionType: "On Behalf",
      status: "HOD approved - Awaiting finance approval",
      submittedAt: "2026-03-13T10:00:00.000Z",
      expenseTotalAmount: null,
      advanceRequestedAmount: 500,
    },
  ];

  return {
    getActivePaymentModes: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveDepartments: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveExpenseCategories: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveProducts: jest.fn(async () => ({ data: [], errorMessage: null })),
    getActiveLocations: jest.fn(async () => ({ data: [], errorMessage: null })),
    getUserSummary: jest.fn(async () => ({ data: null, errorMessage: null })),
    existsExpenseByReceiptFileHash: jest.fn(async () => ({ exists: false, errorMessage: null })),
    existsExpenseByCompositeKey: jest.fn(async () => ({ exists: false, errorMessage: null })),
    getPaymentModeById: jest.fn(async () => ({ data: null, errorMessage: null })),
    getDepartmentApprovers: jest.fn(async () => ({ data: null, errorMessage: null })),
    getActiveUserIdByEmail: jest.fn(async () => ({ data: null, errorMessage: null })),
    isUserApprover1InAnyDepartment: jest.fn(async () => ({
      isApprover1: false,
      errorMessage: null,
    })),
    createClaimWithDetail: jest.fn(async () => ({ claimId: null, errorMessage: null })),
    getMyClaims: jest.fn(async () => ({ data: defaultRows, errorMessage: null })),
    ...overrides,
  };
}

describe("GetMyClaimsService", () => {
  test("maps expense and advance amounts into a single totalAmount field", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new GetMyClaimsService({ repository, logger });

    const result = await service.execute({ userId: "user-1" });

    expect(result.errorMessage).toBeNull();
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0]).toMatchObject({
      claimId: "claim-expense-1",
      employee: "EMP-100",
      totalAmount: 118,
      department: "Finance",
      status: "Submitted",
    });
    expect(result.claims[1]).toMatchObject({
      claimId: "claim-advance-1",
      employee: "delegate@nxtwave.co.in",
      totalAmount: 500,
      department: "Operations",
      status: "Pending",
    });
  });

  test("returns empty list and errorMessage when repository fails", async () => {
    const repository = createRepository({
      getMyClaims: jest.fn(async () => ({ data: [], errorMessage: "db failed" })),
    });
    const logger = createLogger();
    const service = new GetMyClaimsService({ repository, logger });

    const result = await service.execute({ userId: "user-1" });

    expect(result).toEqual({ claims: [], errorMessage: "db failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.get_my_claims_failed",
      expect.objectContaining({ userId: "user-1", errorMessage: "db failed" }),
    );
  });
});
