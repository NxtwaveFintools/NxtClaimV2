import { ManageActorsService } from "@/core/domain/admin/ManageActorsService";
import type {
  AdminRepository,
  DepartmentWithActors,
  FinanceApproverRecord,
} from "@/core/domain/admin/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const SAMPLE_DEPARTMENT: DepartmentWithActors = {
  id: "dept-1",
  name: "Engineering",
  isActive: true,
  hodUserId: "user-hod-1",
  hodUserName: "Alice",
  hodUserEmail: "alice@example.com",
  hodProvisionalEmail: null,
  founderUserId: "user-founder-1",
  founderUserName: "Bob",
  founderUserEmail: "bob@example.com",
  founderProvisionalEmail: null,
};

const SAMPLE_FINANCE_APPROVER: FinanceApproverRecord = {
  id: "fa-1",
  userId: "user-finance-1",
  email: "carol@example.com",
  fullName: "Carol",
  isActive: true,
  isPrimary: true,
  provisionalEmail: null,
};

function createRepository(overrides?: Partial<AdminRepository>): AdminRepository {
  return {
    getAllClaims: jest.fn(),
    softDeleteClaim: jest.fn(),
    getMasterDataItems: jest.fn(),
    createMasterDataItem: jest.fn(),
    updateMasterDataItem: jest.fn(),
    getDepartmentsWithActors: jest.fn(async () => ({
      data: [SAMPLE_DEPARTMENT],
      errorMessage: null,
    })),
    updateDepartmentActors: jest.fn(async () => ({ success: true, errorMessage: null })),
    updateDepartmentActorsByEmail: jest.fn(async () => ({ success: true, errorMessage: null })),
    getFinanceApprovers: jest.fn(async () => ({
      data: [SAMPLE_FINANCE_APPROVER],
      errorMessage: null,
    })),
    createFinanceApprover: jest.fn(async () => ({
      data: SAMPLE_FINANCE_APPROVER,
      errorMessage: null,
    })),
    updateFinanceApprover: jest.fn(async () => ({
      data: { ...SAMPLE_FINANCE_APPROVER },
      errorMessage: null,
    })),
    addFinanceApproverByEmail: jest.fn(async () => ({
      data: { ...SAMPLE_FINANCE_APPROVER },
      errorMessage: null,
    })),
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

describe("ManageActorsService", () => {
  describe("getDepartmentsWithActors", () => {
    test("returns departments list from repository", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.getDepartmentsWithActors();

      expect(repository.getDepartmentsWithActors).toHaveBeenCalled();
      expect(result.errorCode).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("dept-1");
    });

    test("returns empty array and FETCH_FAILED on repo error", async () => {
      const repository = createRepository({
        getDepartmentsWithActors: jest.fn(async () => ({
          data: [],
          errorMessage: "DB error",
        })),
      });
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.getDepartmentsWithActors();

      expect(result.data).toHaveLength(0);
      expect(result.errorCode).toBe("FETCH_FAILED");
      expect(result.errorMessage).toBe("DB error");
    });
  });

  describe("updateDepartmentActors", () => {
    test("calls repo and returns success", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActors({
        departmentId: "dept-1",
        hodUserId: "user-hod-1",
        founderUserId: "user-founder-1",
      });

      expect(repository.updateDepartmentActors).toHaveBeenCalledWith(
        "dept-1",
        "user-hod-1",
        "user-founder-1",
      );
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
    });

    test("returns INVALID_INPUT for empty departmentId", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActors({
        departmentId: "  ",
        hodUserId: "user-hod-1",
        founderUserId: "user-founder-1",
      });

      expect(repository.updateDepartmentActors).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns INVALID_INPUT for empty hodUserId", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActors({
        departmentId: "dept-1",
        hodUserId: "",
        founderUserId: "user-founder-1",
      });

      expect(repository.updateDepartmentActors).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns INVALID_INPUT for empty founderUserId", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActors({
        departmentId: "dept-1",
        hodUserId: "user-hod-1",
        founderUserId: "",
      });

      expect(repository.updateDepartmentActors).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns SAME_APPROVER when hodUserId equals founderUserId", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActors({
        departmentId: "dept-1",
        hodUserId: "user-1",
        founderUserId: "user-1",
      });

      expect(repository.updateDepartmentActors).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SAME_APPROVER");
    });

    test("returns UPDATE_FAILED on repo failure", async () => {
      const repository = createRepository({
        updateDepartmentActors: jest.fn(async () => ({
          success: false,
          errorMessage: "Update conflict",
        })),
      });
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActors({
        departmentId: "dept-1",
        hodUserId: "user-hod-1",
        founderUserId: "user-founder-1",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("UPDATE_FAILED");
      expect(result.errorMessage).toBe("Update conflict");
    });
  });

  describe("updateDepartmentActorsByEmail", () => {
    test("calls repo and returns success", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActorsByEmail({
        departmentId: "dept-1",
        hodEmail: "alice@example.com",
        founderEmail: "bob@example.com",
      });

      expect(repository.updateDepartmentActorsByEmail).toHaveBeenCalledWith(
        "dept-1",
        "alice@example.com",
        "bob@example.com",
      );
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
    });

    test("returns INVALID_INPUT for invalid HOD email", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActorsByEmail({
        departmentId: "dept-1",
        hodEmail: "not-an-email",
        founderEmail: "bob@example.com",
      });

      expect(repository.updateDepartmentActorsByEmail).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns INVALID_INPUT for invalid Founder email", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActorsByEmail({
        departmentId: "dept-1",
        hodEmail: "alice@example.com",
        founderEmail: "",
      });

      expect(repository.updateDepartmentActorsByEmail).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns SAME_APPROVER when HOD and Founder emails match", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActorsByEmail({
        departmentId: "dept-1",
        hodEmail: "same@example.com",
        founderEmail: "same@example.com",
      });

      expect(repository.updateDepartmentActorsByEmail).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SAME_APPROVER");
    });

    test("returns UPDATE_FAILED on repo failure", async () => {
      const repository = createRepository({
        updateDepartmentActorsByEmail: jest.fn(async () => ({
          success: false,
          errorMessage: "DB error",
        })),
      });
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateDepartmentActorsByEmail({
        departmentId: "dept-1",
        hodEmail: "alice@example.com",
        founderEmail: "bob@example.com",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("UPDATE_FAILED");
      expect(result.errorMessage).toBe("DB error");
    });
  });

  describe("getFinanceApprovers", () => {
    test("returns finance approvers list", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.getFinanceApprovers();

      expect(repository.getFinanceApprovers).toHaveBeenCalled();
      expect(result.errorCode).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("fa-1");
    });

    test("returns empty array and FETCH_FAILED on repo error", async () => {
      const repository = createRepository({
        getFinanceApprovers: jest.fn(async () => ({
          data: [],
          errorMessage: "Finance DB error",
        })),
      });
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.getFinanceApprovers();

      expect(result.data).toHaveLength(0);
      expect(result.errorCode).toBe("FETCH_FAILED");
    });
  });

  describe("createFinanceApprover", () => {
    test("calls repo and returns new record", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.createFinanceApprover({ userId: "user-finance-1" });

      expect(repository.createFinanceApprover).toHaveBeenCalledWith("user-finance-1");
      expect(result.errorCode).toBeNull();
      expect(result.data?.userId).toBe("user-finance-1");
    });

    test("returns INVALID_INPUT for empty userId", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.createFinanceApprover({ userId: "" });

      expect(repository.createFinanceApprover).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns CREATE_FAILED on repo error", async () => {
      const repository = createRepository({
        createFinanceApprover: jest.fn(async () => ({
          data: null,
          errorMessage: "Duplicate user",
        })),
      });
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.createFinanceApprover({ userId: "user-finance-1" });

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("CREATE_FAILED");
    });
  });

  describe("updateFinanceApprover", () => {
    test("calls repo with payload and returns updated record", async () => {
      const updated: FinanceApproverRecord = { ...SAMPLE_FINANCE_APPROVER, isActive: false };
      const repository = createRepository({
        updateFinanceApprover: jest.fn(async () => ({ data: updated, errorMessage: null })),
      });
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateFinanceApprover({
        id: "fa-1",
        payload: { isActive: false },
      });

      expect(repository.updateFinanceApprover).toHaveBeenCalledWith("fa-1", { isActive: false });
      expect(result.errorCode).toBeNull();
      expect(result.data?.isActive).toBe(false);
    });

    test("returns INVALID_INPUT for empty id", async () => {
      const repository = createRepository();
      const service = new ManageActorsService({ repository, logger: createLogger() });

      const result = await service.updateFinanceApprover({ id: "", payload: { isActive: false } });

      expect(repository.updateFinanceApprover).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("INVALID_INPUT");
    });
  });
});
