import { ManageDepartmentViewersService } from "@/core/domain/admin/ManageDepartmentViewersService";
import type { AdminRepository, DepartmentViewerAdminRecord } from "@/core/domain/admin/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const SAMPLE_VIEWER: DepartmentViewerAdminRecord = {
  id: "viewer-1",
  userId: "user-abc",
  email: "alice@example.com",
  fullName: "Alice Smith",
  departmentId: "dept-1",
  departmentName: "Engineering",
  isActive: true,
  createdAt: "2026-03-28T10:00:00.000Z",
};

function createRepository(
  overrides?: Partial<
    Pick<
      AdminRepository,
      "getDepartmentViewers" | "addDepartmentViewerByEmail" | "removeDepartmentViewer"
    >
  >,
): AdminRepository {
  return {
    // Department viewer methods (under test)
    getDepartmentViewers: jest.fn(async () => ({
      data: [SAMPLE_VIEWER],
      errorMessage: null,
    })),
    addDepartmentViewerByEmail: jest.fn(async () => ({
      data: SAMPLE_VIEWER,
      errorMessage: null,
    })),
    removeDepartmentViewer: jest.fn(async () => ({
      success: true,
      errorMessage: null,
    })),

    // Stubs for the rest of AdminRepository (not used by this service)
    getAllClaims: jest.fn(),
    getClaimOverrideSummary: jest.fn(),
    forceUpdateClaimStatus: jest.fn(),
    softDeleteClaim: jest.fn(),
    getMasterDataItems: jest.fn(),
    createMasterDataItem: jest.fn(),
    updateMasterDataItem: jest.fn(),
    getDepartmentsWithActors: jest.fn(),
    updateDepartmentActors: jest.fn(),
    updateDepartmentActorsByEmail: jest.fn(),
    getFinanceApprovers: jest.fn(),
    createFinanceApprover: jest.fn(),
    addFinanceApproverByEmail: jest.fn(),
    updateFinanceApprover: jest.fn(),
    getAllUsers: jest.fn(),
    updateUserRole: jest.fn(),
    getAdmins: jest.fn(),
    addAdminByEmail: jest.fn(),
    removeAdmin: jest.fn(),
    ...overrides,
  } as AdminRepository;
}

describe("ManageDepartmentViewersService", () => {
  describe("getDepartmentViewers", () => {
    it("returns all viewers on success", async () => {
      const repository = createRepository();
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.getDepartmentViewers();

      expect(result.data).toEqual([SAMPLE_VIEWER]);
      expect(result.errorCode).toBeNull();
      expect(result.errorMessage).toBeNull();
    });

    it("returns error when fetch fails", async () => {
      const repository = createRepository({
        getDepartmentViewers: jest.fn(async () => ({
          data: [],
          errorMessage: "DB timeout",
        })),
      });
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.getDepartmentViewers();

      expect(result.data).toEqual([]);
      expect(result.errorCode).toBe("FETCH_FAILED");
      expect(result.errorMessage).toBe("DB timeout");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("addViewerByEmail", () => {
    it("adds a viewer successfully", async () => {
      const repository = createRepository();
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.addViewerByEmail("dept-1", "alice@example.com");

      expect(result.data).toEqual(SAMPLE_VIEWER);
      expect(result.errorCode).toBeNull();
      expect(repository.addDepartmentViewerByEmail).toHaveBeenCalledWith(
        "dept-1",
        "alice@example.com",
      );
    });

    it("rejects empty department ID", async () => {
      const repository = createRepository();
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.addViewerByEmail("", "alice@example.com");

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("INVALID_INPUT");
      expect(repository.addDepartmentViewerByEmail).not.toHaveBeenCalled();
    });

    it("rejects invalid email", async () => {
      const repository = createRepository();
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.addViewerByEmail("dept-1", "not-an-email");

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("INVALID_INPUT");
      expect(repository.addDepartmentViewerByEmail).not.toHaveBeenCalled();
    });

    it("returns error when repository fails", async () => {
      const repository = createRepository({
        addDepartmentViewerByEmail: jest.fn(async () => ({
          data: null,
          errorMessage: "User not found.",
        })),
      });
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.addViewerByEmail("dept-1", "unknown@example.com");

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("ADD_FAILED");
      expect(result.errorMessage).toBe("User not found.");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("removeViewer", () => {
    it("removes a viewer successfully", async () => {
      const repository = createRepository();
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.removeViewer("viewer-1");

      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
      expect(repository.removeDepartmentViewer).toHaveBeenCalledWith("viewer-1");
    });

    it("rejects empty viewer ID", async () => {
      const repository = createRepository();
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.removeViewer("");

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_INPUT");
      expect(repository.removeDepartmentViewer).not.toHaveBeenCalled();
    });

    it("returns error when repository fails", async () => {
      const repository = createRepository({
        removeDepartmentViewer: jest.fn(async () => ({
          success: false,
          errorMessage: "Record not found",
        })),
      });
      const logger = createLogger();
      const service = new ManageDepartmentViewersService({ repository, logger });

      const result = await service.removeViewer("viewer-999");

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("REMOVE_FAILED");
      expect(result.errorMessage).toBe("Record not found");
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
