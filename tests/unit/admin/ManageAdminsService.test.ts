import { ManageAdminsService } from "@/core/domain/admin/ManageAdminsService";
import type {
  AdminRepository,
  AdminRecord,
  AdminUserRecord,
  AdminCursorPaginatedResult,
} from "@/core/domain/admin/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const SAMPLE_ADMIN: AdminRecord = {
  id: "admin-rec-1",
  userId: "user-admin-1",
  email: "alice@example.com",
  fullName: "Alice Admin",
  createdAt: "2026-03-14T10:00:00.000Z",
  provisionalEmail: null,
};

const SAMPLE_USER: AdminUserRecord = {
  id: "user-1",
  fullName: "Bob Employee",
  email: "bob@example.com",
  role: "employee",
  isActive: true,
  createdAt: "2026-03-14T10:00:00.000Z",
};

const PAGINATED_USERS: AdminCursorPaginatedResult<AdminUserRecord> = {
  data: [SAMPLE_USER],
  nextCursor: null,
  hasNextPage: false,
};

function createRepository(overrides?: Partial<AdminRepository>): AdminRepository {
  const baseRepository: AdminRepository = {
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
    updateFinanceApprover: jest.fn(),
    addFinanceApproverByEmail: jest.fn(),
    getAllUsers: jest.fn(async () => ({ data: PAGINATED_USERS, errorMessage: null })),
    updateUserRole: jest.fn(async () => ({ success: true, errorMessage: null })),
    getAdmins: jest.fn(async () => ({ data: [SAMPLE_ADMIN], errorMessage: null })),
    addAdminByEmail: jest.fn(async () => ({ data: SAMPLE_ADMIN, errorMessage: null })),
    removeAdmin: jest.fn(async () => ({ success: true, errorMessage: null })),
    getDepartmentViewers: jest.fn(async () => ({ data: [], errorMessage: null })),
    addDepartmentViewerByEmail: jest.fn(async () => ({ data: null, errorMessage: null })),
    removeDepartmentViewer: jest.fn(async () => ({ success: true, errorMessage: null })),
  };

  return { ...baseRepository, ...overrides } as AdminRepository;
}

describe("ManageAdminsService", () => {
  describe("getAllUsers", () => {
    test("returns paginated users from repository", async () => {
      const repository = createRepository();
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.getAllUsers({ cursor: null, limit: 20 });

      expect(repository.getAllUsers).toHaveBeenCalledWith({ cursor: null, limit: 20 });
      expect(result.errorCode).toBeNull();
      expect(result.data?.data).toHaveLength(1);
      expect(result.data?.data[0].id).toBe("user-1");
    });

    test("returns null and FETCH_FAILED on repo error", async () => {
      const repository = createRepository({
        getAllUsers: jest.fn(async () => ({
          data: null,
          errorMessage: "Users fetch failed",
        })),
      });
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.getAllUsers({ cursor: null, limit: 20 });

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("FETCH_FAILED");
      expect(result.errorMessage).toBe("Users fetch failed");
    });

    test("passes cursor to repo for pagination", async () => {
      const repository = createRepository();
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      await service.getAllUsers({ cursor: "cursor-abc", limit: 10 });

      expect(repository.getAllUsers).toHaveBeenCalledWith({ cursor: "cursor-abc", limit: 10 });
    });
  });

  describe("getAdmins", () => {
    test("returns admins list from repository", async () => {
      const repository = createRepository();
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.getAdmins();

      expect(repository.getAdmins).toHaveBeenCalled();
      expect(result.errorCode).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("admin-rec-1");
    });

    test("returns empty array and FETCH_FAILED on repo error", async () => {
      const repository = createRepository({
        getAdmins: jest.fn(async () => ({ data: [], errorMessage: "Admins fetch failed" })),
      });
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.getAdmins();

      expect(result.data).toHaveLength(0);
      expect(result.errorCode).toBe("FETCH_FAILED");
      expect(result.errorMessage).toBe("Admins fetch failed");
    });
  });

  describe("addAdminByEmail", () => {
    test("calls repo and returns new admin record", async () => {
      const repository = createRepository();
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.addAdminByEmail("alice@example.com");

      expect(repository.addAdminByEmail).toHaveBeenCalledWith("alice@example.com");
      expect(result.errorCode).toBeNull();
      expect(result.data?.email).toBe("alice@example.com");
    });

    test("returns INVALID_INPUT for empty email", async () => {
      const repository = createRepository();
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.addAdminByEmail("  ");

      expect(repository.addAdminByEmail).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns ADD_FAILED on repo error", async () => {
      const repository = createRepository({
        addAdminByEmail: jest.fn(async () => ({ data: null, errorMessage: "Already an admin" })),
      });
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.addAdminByEmail("alice@example.com");

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("ADD_FAILED");
      expect(result.errorMessage).toBe("Already an admin");
    });
  });

  describe("removeAdmin", () => {
    test("calls repo and returns success", async () => {
      const repository = createRepository();
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.removeAdmin("admin-rec-1");

      expect(repository.removeAdmin).toHaveBeenCalledWith("admin-rec-1");
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
    });

    test("returns INVALID_INPUT for empty adminId", async () => {
      const repository = createRepository();
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.removeAdmin("");

      expect(repository.removeAdmin).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns REMOVE_FAILED on repo error", async () => {
      const repository = createRepository({
        removeAdmin: jest.fn(async () => ({ success: false, errorMessage: "Record not found" })),
      });
      const service = new ManageAdminsService({ repository, logger: createLogger() });

      const result = await service.removeAdmin("admin-rec-1");

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("REMOVE_FAILED");
      expect(result.errorMessage).toBe("Record not found");
    });
  });
});
