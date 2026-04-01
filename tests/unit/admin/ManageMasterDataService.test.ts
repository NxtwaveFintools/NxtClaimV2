import { ManageMasterDataService } from "@/core/domain/admin/ManageMasterDataService";
import type { AdminRepository, MasterDataItem } from "@/core/domain/admin/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const SAMPLE_ITEM: MasterDataItem = {
  id: "item-1",
  name: "Engineering",
  isActive: true,
};

function createRepository(overrides?: Partial<AdminRepository>): AdminRepository {
  return {
    getAllClaims: jest.fn(),
    softDeleteClaim: jest.fn(),
    getMasterDataItems: jest.fn(async () => ({ data: [SAMPLE_ITEM], errorMessage: null })),
    createMasterDataItem: jest.fn(async () => ({ data: SAMPLE_ITEM, errorMessage: null })),
    updateMasterDataItem: jest.fn(async () => ({ data: { ...SAMPLE_ITEM }, errorMessage: null })),
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

describe("ManageMasterDataService", () => {
  describe("getItems", () => {
    test("returns items array for given tableName", async () => {
      const repository = createRepository();
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.getItems({ tableName: "master_expense_categories" });

      expect(repository.getMasterDataItems).toHaveBeenCalledWith("master_expense_categories");
      expect(result.errorCode).toBeNull();
      expect(result.errorMessage).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("item-1");
    });

    test("returns empty array and FETCH_FAILED on repo error", async () => {
      const repository = createRepository({
        getMasterDataItems: jest.fn(async () => ({
          data: [],
          errorMessage: "DB error",
        })),
      });
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.getItems({ tableName: "master_expense_categories" });

      expect(result.data).toHaveLength(0);
      expect(result.errorCode).toBe("FETCH_FAILED");
      expect(result.errorMessage).toBe("DB error");
    });
  });

  describe("createItem", () => {
    test("creates item with trimmed name", async () => {
      const repository = createRepository();
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.createItem({
        tableName: "master_expense_categories",
        name: "  Finance  ",
      });

      expect(repository.createMasterDataItem).toHaveBeenCalledWith(
        "master_expense_categories",
        "Finance",
      );
      expect(result.errorCode).toBeNull();
      expect(result.data).not.toBeNull();
    });

    test("returns INVALID_INPUT for empty name", async () => {
      const repository = createRepository();
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.createItem({
        tableName: "master_expense_categories",
        name: "   ",
      });

      expect(repository.createMasterDataItem).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns CREATE_FAILED on repo error", async () => {
      const repository = createRepository({
        createMasterDataItem: jest.fn(async () => ({
          data: null,
          errorMessage: "Insert failed",
        })),
      });
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.createItem({
        tableName: "master_expense_categories",
        name: "New Dept",
      });

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("CREATE_FAILED");
      expect(result.errorMessage).toBe("Insert failed");
    });
  });

  describe("updateItem", () => {
    test("updates name for existing item", async () => {
      const updated: MasterDataItem = { id: "item-1", name: "Renamed", isActive: true };
      const repository = createRepository({
        updateMasterDataItem: jest.fn(async () => ({ data: updated, errorMessage: null })),
      });
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.updateItem({
        tableName: "master_expense_categories",
        id: "item-1",
        payload: { name: "Renamed" },
      });

      expect(repository.updateMasterDataItem).toHaveBeenCalledWith(
        "master_expense_categories",
        "item-1",
        { name: "Renamed" },
      );
      expect(result.errorCode).toBeNull();
      expect(result.data?.name).toBe("Renamed");
    });

    test("updates isActive flag", async () => {
      const updated: MasterDataItem = { id: "item-1", name: "Engineering", isActive: false };
      const repository = createRepository({
        updateMasterDataItem: jest.fn(async () => ({ data: updated, errorMessage: null })),
      });
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.updateItem({
        tableName: "master_expense_categories",
        id: "item-1",
        payload: { isActive: false },
      });

      expect(result.data?.isActive).toBe(false);
      expect(result.errorCode).toBeNull();
    });

    test("returns INVALID_INPUT for empty id", async () => {
      const repository = createRepository();
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.updateItem({
        tableName: "master_expense_categories",
        id: "   ",
        payload: { name: "Something" },
      });

      expect(repository.updateMasterDataItem).not.toHaveBeenCalled();
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns INVALID_INPUT when name payload is empty string", async () => {
      const repository = createRepository();
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.updateItem({
        tableName: "master_expense_categories",
        id: "item-1",
        payload: { name: "  " },
      });

      expect(repository.updateMasterDataItem).not.toHaveBeenCalled();
      expect(result.errorCode).toBe("INVALID_INPUT");
    });

    test("returns UPDATE_FAILED on repo error", async () => {
      const repository = createRepository({
        updateMasterDataItem: jest.fn(async () => ({
          data: null,
          errorMessage: "Update failed",
        })),
      });
      const service = new ManageMasterDataService({ repository, logger: createLogger() });

      const result = await service.updateItem({
        tableName: "master_expense_categories",
        id: "item-1",
        payload: { isActive: false },
      });

      expect(result.data).toBeNull();
      expect(result.errorCode).toBe("UPDATE_FAILED");
      expect(result.errorMessage).toBe("Update failed");
    });
  });
});
