import type {
  AdminDomainLogger,
  AdminRepository,
  MasterDataItem,
  MasterDataTableName,
} from "@/core/domain/admin/contracts";

type Dependencies = {
  repository: AdminRepository;
  logger: AdminDomainLogger;
};

type GetItemsInput = { tableName: MasterDataTableName };

type CreateItemInput = { tableName: MasterDataTableName; name: string };

type UpdateItemInput = {
  tableName: MasterDataTableName;
  id: string;
  payload: { name?: string; isActive?: boolean };
};

type GetItemsResult = {
  data: MasterDataItem[];
  errorCode: string | null;
  errorMessage: string | null;
};

type MutateItemResult = {
  data: MasterDataItem | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class ManageMasterDataService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async getItems(input: GetItemsInput): Promise<GetItemsResult> {
    const result = await this.repository.getMasterDataItems(input.tableName);

    if (result.errorMessage) {
      this.logger.error("ManageMasterDataService.getItems.failed", {
        tableName: input.tableName,
        errorMessage: result.errorMessage,
      });

      return { data: [], errorCode: "FETCH_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async createItem(input: CreateItemInput): Promise<MutateItemResult> {
    const name = input.name.trim();

    if (!name) {
      return { data: null, errorCode: "INVALID_INPUT", errorMessage: "Name is required." };
    }

    this.logger.info("ManageMasterDataService.createItem", {
      tableName: input.tableName,
      name,
    });

    const result = await this.repository.createMasterDataItem(input.tableName, name);

    if (result.errorMessage) {
      this.logger.error("ManageMasterDataService.createItem.failed", {
        tableName: input.tableName,
        errorMessage: result.errorMessage,
      });

      return { data: null, errorCode: "CREATE_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async updateItem(input: UpdateItemInput): Promise<MutateItemResult> {
    if (!input.id?.trim()) {
      return { data: null, errorCode: "INVALID_INPUT", errorMessage: "Item ID is required." };
    }

    if (input.payload.name !== undefined && !input.payload.name.trim()) {
      return { data: null, errorCode: "INVALID_INPUT", errorMessage: "Name cannot be empty." };
    }

    this.logger.info("ManageMasterDataService.updateItem", {
      tableName: input.tableName,
      id: input.id,
      payload: input.payload,
    });

    const result = await this.repository.updateMasterDataItem(
      input.tableName,
      input.id,
      input.payload,
    );

    if (result.errorMessage) {
      this.logger.error("ManageMasterDataService.updateItem.failed", {
        tableName: input.tableName,
        id: input.id,
        errorMessage: result.errorMessage,
      });

      return { data: null, errorCode: "UPDATE_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }
}
