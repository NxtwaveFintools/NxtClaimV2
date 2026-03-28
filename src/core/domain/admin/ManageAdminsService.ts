import type {
  AdminCursorPaginatedResult,
  AdminCursorPaginationInput,
  AdminDomainLogger,
  AdminRecord,
  AdminRepository,
  AdminUserRecord,
} from "@/core/domain/admin/contracts";

type Dependencies = {
  repository: AdminRepository;
  logger: AdminDomainLogger;
};

type GetUsersResult = {
  data: AdminCursorPaginatedResult<AdminUserRecord> | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type GetAdminsResult = {
  data: AdminRecord[];
  errorCode: string | null;
  errorMessage: string | null;
};

type AddAdminResult = {
  data: AdminRecord | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type RemoveAdminResult = {
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

export class ManageAdminsService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async getAllUsers(pagination: AdminCursorPaginationInput): Promise<GetUsersResult> {
    const result = await this.repository.getAllUsers(pagination);

    if (result.errorMessage) {
      this.logger.error("ManageAdminsService.getAllUsers.failed", {
        errorMessage: result.errorMessage,
      });

      return { data: null, errorCode: "FETCH_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async getAdmins(): Promise<GetAdminsResult> {
    const result = await this.repository.getAdmins();

    if (result.errorMessage) {
      this.logger.error("ManageAdminsService.getAdmins.failed", {
        errorMessage: result.errorMessage,
      });

      return { data: [], errorCode: "FETCH_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async addAdminByEmail(email: string): Promise<AddAdminResult> {
    if (!email?.trim()) {
      return { data: null, errorCode: "INVALID_INPUT", errorMessage: "Email is required." };
    }

    this.logger.info("ManageAdminsService.addAdminByEmail", { email });

    const result = await this.repository.addAdminByEmail(email);

    if (result.errorMessage) {
      this.logger.error("ManageAdminsService.addAdminByEmail.failed", {
        email,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "ADD_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async removeAdmin(adminId: string): Promise<RemoveAdminResult> {
    if (!adminId?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Admin record ID is required.",
      };
    }

    this.logger.info("ManageAdminsService.removeAdmin", { adminId });

    const result = await this.repository.removeAdmin(adminId);

    if (!result.success) {
      this.logger.error("ManageAdminsService.removeAdmin.failed", {
        adminId,
        errorMessage: result.errorMessage,
      });

      return {
        success: false,
        errorCode: "REMOVE_FAILED",
        errorMessage: result.errorMessage ?? "Failed to remove admin.",
      };
    }

    return { success: true, errorCode: null, errorMessage: null };
  }
}
