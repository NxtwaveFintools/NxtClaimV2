import { CreateDepartmentService } from "@/core/domain/admin/CreateDepartmentService";
import type { AdminRepository, CreatedDepartmentRecord } from "@/core/domain/admin/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const SAMPLE_DEPARTMENT: CreatedDepartmentRecord = {
  id: "dept-1",
  name: "Engineering",
  hodUserId: "hod-1",
  founderUserId: "founder-1",
  isActive: true,
};

function createRepository(overrides?: Partial<AdminRepository>): AdminRepository {
  return {
    getAllClaims: jest.fn(),
    getClaimOverrideSummary: jest.fn(),
    forceUpdateClaimStatus: jest.fn(),
    forceUpdatePaymentMode: jest.fn(),
    softDeleteClaim: jest.fn(),
    getMasterDataItems: jest.fn(),
    createMasterDataItem: jest.fn(),
    updateMasterDataItem: jest.fn(),
    getDepartmentsWithActors: jest.fn(),
    updateDepartmentActors: jest.fn(),
    updateDepartmentActorsByEmail: jest.fn(),
    createDepartmentWithActorsByEmail: jest.fn(async () => ({
      data: SAMPLE_DEPARTMENT,
      errorMessage: null,
    })),
    getFinanceApprovers: jest.fn(),
    createFinanceApprover: jest.fn(),
    addFinanceApproverByEmail: jest.fn(),
    updateFinanceApprover: jest.fn(),
    getAllUsers: jest.fn(),
    updateUserRole: jest.fn(),
    getAdmins: jest.fn(),
    addAdminByEmail: jest.fn(),
    removeAdmin: jest.fn(),
    getDepartmentViewers: jest.fn(),
    addDepartmentViewerByEmail: jest.fn(),
    removeDepartmentViewer: jest.fn(),
    ...overrides,
  };
}

describe("CreateDepartmentService", () => {
  test("returns INVALID_INPUT for empty name", async () => {
    const repository = createRepository();
    const service = new CreateDepartmentService({ repository, logger: createLogger() });

    const result = await service.createDepartment({
      name: "  ",
      hodEmail: "hod@nxtwave.co.in",
      founderEmail: "founder@nxtwave.co.in",
    });

    expect(result.errorCode).toBe("INVALID_INPUT");
    expect(repository.createDepartmentWithActorsByEmail).not.toHaveBeenCalled();
  });

  test("returns INVALID_INPUT for invalid emails", async () => {
    const repository = createRepository();
    const service = new CreateDepartmentService({ repository, logger: createLogger() });

    const invalidHod = await service.createDepartment({
      name: "Engineering",
      hodEmail: "bad",
      founderEmail: "founder@nxtwave.co.in",
    });

    const invalidFounder = await service.createDepartment({
      name: "Engineering",
      hodEmail: "hod@nxtwave.co.in",
      founderEmail: "",
    });

    expect(invalidHod.errorCode).toBe("INVALID_INPUT");
    expect(invalidFounder.errorCode).toBe("INVALID_INPUT");
    expect(repository.createDepartmentWithActorsByEmail).not.toHaveBeenCalled();
  });

  test("returns SAME_APPROVER when emails match", async () => {
    const repository = createRepository();
    const service = new CreateDepartmentService({ repository, logger: createLogger() });

    const result = await service.createDepartment({
      name: "Engineering",
      hodEmail: "same@nxtwave.co.in",
      founderEmail: "same@nxtwave.co.in",
    });

    expect(result.errorCode).toBe("SAME_APPROVER");
    expect(result.errorMessage).toBe("HOD and Founder cannot be the same person.");
    expect(repository.createDepartmentWithActorsByEmail).not.toHaveBeenCalled();
  });

  test("returns CREATE_FAILED when repository fails", async () => {
    const repository = createRepository({
      createDepartmentWithActorsByEmail: jest.fn(async () => ({
        data: null,
        errorMessage: "duplicate key value",
      })),
    });
    const service = new CreateDepartmentService({ repository, logger: createLogger() });

    const result = await service.createDepartment({
      name: "Engineering",
      hodEmail: "hod@nxtwave.co.in",
      founderEmail: "founder@nxtwave.co.in",
    });

    expect(result.errorCode).toBe("CREATE_FAILED");
    expect(result.errorMessage).toBe("duplicate key value");
  });

  test("calls repository with normalized payload and returns data", async () => {
    const repository = createRepository();
    const service = new CreateDepartmentService({ repository, logger: createLogger() });

    const result = await service.createDepartment({
      name: "  Engineering  ",
      hodEmail: "HOD@Nxtwave.co.in ",
      founderEmail: " Founder@Nxtwave.co.in",
    });

    expect(repository.createDepartmentWithActorsByEmail).toHaveBeenCalledWith({
      name: "Engineering",
      hodEmail: "hod@nxtwave.co.in",
      founderEmail: "founder@nxtwave.co.in",
    });
    expect(result.errorCode).toBeNull();
    expect(result.data).toEqual(SAMPLE_DEPARTMENT);
  });
});
