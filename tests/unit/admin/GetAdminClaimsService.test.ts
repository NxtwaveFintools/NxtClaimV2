import { GetAdminClaimsService } from "@/core/domain/admin/GetAdminClaimsService";
import type { AdminRepository, AdminClaimRecord } from "@/core/domain/admin/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const SAMPLE_CLAIM: AdminClaimRecord = {
  claimId: "CLM-001",
  employeeName: "Alice",
  employeeId: "EMP-001",
  departmentName: "Engineering",
  typeOfClaim: "Expense",
  amount: 5000,
  status: "Submitted - Awaiting HOD approval",
  submittedOn: "2026-03-14T10:00:00.000Z",
  hodActionDate: null,
  financeActionDate: null,
  detailType: "expense",
  submissionType: "Self",
  isActive: true,
  departmentId: "dept-1",
};

function createRepository(overrides?: Partial<AdminRepository>): AdminRepository {
  return {
    getAllClaims: jest.fn(async () => ({
      data: { data: [SAMPLE_CLAIM], nextCursor: null, hasNextPage: false },
      errorMessage: null,
    })),
    softDeleteClaim: jest.fn(),
    getMasterDataItems: jest.fn(),
    createMasterDataItem: jest.fn(),
    updateMasterDataItem: jest.fn(),
    getDepartmentsWithActors: jest.fn(),
    updateDepartmentActors: jest.fn(),
    updateDepartmentActorsByEmail: jest.fn(),
    getFinanceApprovers: jest.fn(),
    createFinanceApprover: jest.fn(),
    updateFinanceApprover: jest.fn(),
    getAllUsers: jest.fn(),
    updateUserRole: jest.fn(),
    getAdmins: jest.fn(),
    addAdminByEmail: jest.fn(),
    removeAdmin: jest.fn(),
    addFinanceApproverByEmail: jest.fn(),
    getDepartmentViewers: jest.fn(),
    addDepartmentViewerByEmail: jest.fn(),
    removeDepartmentViewer: jest.fn(),
    ...overrides,
  };
}

describe("GetAdminClaimsService", () => {
  test("returns paginated claims without user-scoping", async () => {
    const repository = createRepository();
    const service = new GetAdminClaimsService({ repository, logger: createLogger() });

    const result = await service.execute({
      filters: {},
      pagination: { cursor: null, limit: 10 },
    });

    expect(repository.getAllClaims).toHaveBeenCalledWith({}, { cursor: null, limit: 10 });
    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(result.data?.data).toHaveLength(1);
    expect(result.data?.data[0].claimId).toBe("CLM-001");
  });

  test("passes filters to repository", async () => {
    const repository = createRepository();
    const service = new GetAdminClaimsService({ repository, logger: createLogger() });

    await service.execute({
      filters: {
        departmentId: "dept-1",
        searchQuery: "alice",
        submittedFrom: "2026-03-01",
        submittedTo: "2026-03-31",
        minAmount: 100,
        maxAmount: 1000,
      },
      pagination: { cursor: "cursor-1", limit: 5 },
    });

    expect(repository.getAllClaims).toHaveBeenCalledWith(
      {
        departmentId: "dept-1",
        searchQuery: "alice",
        submittedFrom: "2026-03-01",
        submittedTo: "2026-03-31",
        minAmount: 100,
        maxAmount: 1000,
      },
      { cursor: "cursor-1", limit: 5 },
    );
  });

  test("returns pagination metadata", async () => {
    const repository = createRepository({
      getAllClaims: jest.fn(async () => ({
        data: { data: [SAMPLE_CLAIM], nextCursor: "next-1", hasNextPage: true },
        errorMessage: null,
      })),
    });
    const service = new GetAdminClaimsService({ repository, logger: createLogger() });

    const result = await service.execute({
      filters: {},
      pagination: { cursor: null, limit: 10 },
    });

    expect(result.data?.hasNextPage).toBe(true);
    expect(result.data?.nextCursor).toBe("next-1");
  });

  test("returns FETCH_FAILED error code when repository fails", async () => {
    const logger = createLogger();
    const repository = createRepository({
      getAllClaims: jest.fn(async () => ({
        data: null,
        errorMessage: "DB connection failed",
      })),
    });
    const service = new GetAdminClaimsService({ repository, logger });

    const result = await service.execute({
      filters: {},
      pagination: { cursor: null, limit: 10 },
    });

    expect(result.data).toBeNull();
    expect(result.errorCode).toBe("FETCH_FAILED");
    expect(result.errorMessage).toBe("DB connection failed");
    expect(logger.error).toHaveBeenCalled();
  });
});
