import { AdminSoftDeleteClaimService } from "@/core/domain/admin/AdminSoftDeleteClaimService";
import type { AdminRepository } from "@/core/domain/admin/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(overrides?: Partial<AdminRepository>): AdminRepository {
  return {
    getAllClaims: jest.fn(),
    softDeleteClaim: jest.fn(async () => ({ success: true, errorMessage: null })),
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

describe("AdminSoftDeleteClaimService", () => {
  test("successfully soft-deletes an active claim", async () => {
    const repository = createRepository();
    const service = new AdminSoftDeleteClaimService({ repository, logger: createLogger() });

    const result = await service.execute({ claimId: "CLM-001", actorId: "admin-user-1" });

    expect(repository.softDeleteClaim).toHaveBeenCalledWith("CLM-001", "admin-user-1");
    expect(result.success).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  test("returns INVALID_INPUT when claimId is empty", async () => {
    const repository = createRepository();
    const service = new AdminSoftDeleteClaimService({ repository, logger: createLogger() });

    const result = await service.execute({ claimId: "", actorId: "admin-user-1" });

    expect(repository.softDeleteClaim).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_INPUT");
  });

  test("returns INVALID_INPUT when actorId is empty", async () => {
    const repository = createRepository();
    const service = new AdminSoftDeleteClaimService({ repository, logger: createLogger() });

    const result = await service.execute({ claimId: "CLM-001", actorId: "" });

    expect(repository.softDeleteClaim).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_INPUT");
  });

  test("returns DELETE_FAILED when repository returns an error", async () => {
    const logger = createLogger();
    const repository = createRepository({
      softDeleteClaim: jest.fn(async () => ({
        success: false,
        errorMessage: "Claim not found",
      })),
    });
    const service = new AdminSoftDeleteClaimService({ repository, logger });

    const result = await service.execute({ claimId: "CLM-999", actorId: "admin-user-1" });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("SOFT_DELETE_FAILED");
    expect(result.errorMessage).toBe("Claim not found");
    expect(logger.error).toHaveBeenCalled();
  });

  test("logs a warning but returns success when audit log fails", async () => {
    const logger = createLogger();
    const repository = createRepository({
      softDeleteClaim: jest.fn(async () => ({
        success: true,
        errorMessage: "Audit log write failed",
      })),
    });
    const service = new AdminSoftDeleteClaimService({ repository, logger });

    const result = await service.execute({ claimId: "CLM-001", actorId: "admin-user-1" });

    expect(result.success).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
