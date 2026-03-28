import { GetDepartmentViewClaimsService } from "@/core/domain/claims/GetDepartmentViewClaimsService";
import type {
  DepartmentViewerClaimRecord,
  DepartmentViewerDepartment,
  DepartmentViewerRepository,
} from "@/core/domain/claims/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const SAMPLE_DEPARTMENTS: DepartmentViewerDepartment[] = [
  { id: "dept-1", name: "Engineering" },
  { id: "dept-2", name: "Operations" },
];

const SAMPLE_CLAIMS: DepartmentViewerClaimRecord[] = [
  {
    claimId: "EXP-001",
    employeeName: "Alice Smith",
    employeeId: "EMP-100",
    departmentName: "Engineering",
    typeOfClaim: "Reimbursement",
    amount: 5000,
    status: "Submitted - Awaiting HOD approval",
    submittedOn: "2026-03-14T10:00:00.000Z",
    hodActionDate: null,
    financeActionDate: null,
    detailType: "expense",
    submissionType: "Self",
    departmentId: "dept-1",
  },
  {
    claimId: "ADV-002",
    employeeName: "Bob Jones",
    employeeId: "EMP-200",
    departmentName: "Operations",
    typeOfClaim: "Petty Cash Request",
    amount: 1500,
    status: "HOD approved - Awaiting finance approval",
    submittedOn: "2026-03-13T10:00:00.000Z",
    hodActionDate: "2026-03-14T09:00:00.000Z",
    financeActionDate: null,
    detailType: "advance",
    submissionType: "On Behalf",
    departmentId: "dept-2",
  },
];

function createRepository(
  overrides?: Partial<DepartmentViewerRepository>,
): DepartmentViewerRepository {
  return {
    getViewerDepartments: jest.fn(async () => ({
      data: SAMPLE_DEPARTMENTS,
      errorMessage: null,
    })),
    getClaims: jest.fn(async () => ({
      data: { data: SAMPLE_CLAIMS, nextCursor: null, hasNextPage: false },
      errorMessage: null,
    })),
    ...overrides,
  };
}

describe("GetDepartmentViewClaimsService", () => {
  const defaultInput = {
    userId: "user-abc",
    filters: {},
    pagination: { cursor: null, limit: 25 },
  };

  it("returns empty result when user has zero assigned departments", async () => {
    const repository = createRepository({
      getViewerDepartments: jest.fn(async () => ({
        data: [],
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new GetDepartmentViewClaimsService({ repository, logger });

    const result = await service.execute(defaultInput);

    expect(result.data).toEqual({ data: [], nextCursor: null, hasNextPage: false });
    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    // getClaims should NOT be called when there are no departments
    expect(repository.getClaims).not.toHaveBeenCalled();
  });

  it("fetches claims for a single assigned department without filters", async () => {
    const singleDept = [SAMPLE_DEPARTMENTS[0]];
    const repository = createRepository({
      getViewerDepartments: jest.fn(async () => ({
        data: singleDept,
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new GetDepartmentViewClaimsService({ repository, logger });

    const result = await service.execute(defaultInput);

    expect(result.errorCode).toBeNull();
    expect(result.data).not.toBeNull();
    expect(repository.getClaims).toHaveBeenCalledWith(
      ["dept-1"],
      defaultInput.filters,
      defaultInput.pagination,
    );
  });

  it("fetches claims for multiple departments with status filter", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new GetDepartmentViewClaimsService({ repository, logger });

    const filters = { status: ["Submitted - Awaiting HOD approval" as const] };
    const input = { ...defaultInput, filters };

    const result = await service.execute(input);

    expect(result.errorCode).toBeNull();
    expect(result.data).not.toBeNull();
    expect(repository.getViewerDepartments).toHaveBeenCalledWith("user-abc");
    expect(repository.getClaims).toHaveBeenCalledWith(
      ["dept-1", "dept-2"],
      filters,
      defaultInput.pagination,
    );
  });

  it("returns error when getViewerDepartments fails", async () => {
    const repository = createRepository({
      getViewerDepartments: jest.fn(async () => ({
        data: [],
        errorMessage: "DB connection failed",
      })),
    });
    const logger = createLogger();
    const service = new GetDepartmentViewClaimsService({ repository, logger });

    const result = await service.execute(defaultInput);

    expect(result.data).toBeNull();
    expect(result.errorCode).toBe("FETCH_DEPARTMENTS_FAILED");
    expect(result.errorMessage).toBe("DB connection failed");
    expect(logger.error).toHaveBeenCalled();
    expect(repository.getClaims).not.toHaveBeenCalled();
  });

  it("returns error when getClaims fails", async () => {
    const repository = createRepository({
      getClaims: jest.fn(async () => ({
        data: null,
        errorMessage: "Query timeout",
      })),
    });
    const logger = createLogger();
    const service = new GetDepartmentViewClaimsService({ repository, logger });

    const result = await service.execute(defaultInput);

    expect(result.data).toBeNull();
    expect(result.errorCode).toBe("FETCH_CLAIMS_FAILED");
    expect(result.errorMessage).toBe("Query timeout");
    expect(logger.error).toHaveBeenCalled();
  });
});
