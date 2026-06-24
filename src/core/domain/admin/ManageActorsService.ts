import type {
  AdminDomainLogger,
  AdminRepository,
  DepartmentWithActors,
  FinanceApproverRecord,
} from "@/core/domain/admin/contracts";

type Dependencies = {
  repository: AdminRepository;
  logger: AdminDomainLogger;
};

type UpdateDepartmentActorsInput = {
  departmentId: string;
  approver1Id: string;
  approver2Id: string;
};

type UpdateDepartmentActorsByEmailInput = {
  departmentId: string;
  approver1Email: string;
  approver2Email: string;
};

type CreateFinanceApproverInput = { userId: string };
type AddFinanceApproverByEmailInput = { email: string };

type UpdateFinanceApproverInput = {
  id: string;
  payload: { isActive?: boolean; isPrimary?: boolean };
};

type GetDepartmentsResult = {
  data: DepartmentWithActors[];
  errorCode: string | null;
  errorMessage: string | null;
};

type GetFinanceApproversResult = {
  data: FinanceApproverRecord[];
  errorCode: string | null;
  errorMessage: string | null;
};

type MutateResult = {
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

type FinanceApproverResult = {
  data: FinanceApproverRecord | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class ManageActorsService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async getDepartmentsWithActors(): Promise<GetDepartmentsResult> {
    const result = await this.repository.getDepartmentsWithActors();

    if (result.errorMessage) {
      this.logger.error("ManageActorsService.getDepartmentsWithActors.failed", {
        errorMessage: result.errorMessage,
      });

      return { data: [], errorCode: "FETCH_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async updateDepartmentActors(input: UpdateDepartmentActorsInput): Promise<MutateResult> {
    if (!input.departmentId?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Department ID is required.",
      };
    }

    if (!input.approver1Id?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Approver 1 user ID is required.",
      };
    }

    if (!input.approver2Id?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Approver 2 user ID is required.",
      };
    }

    this.logger.info("ManageActorsService.updateDepartmentActors", {
      departmentId: input.departmentId,
      approver1Id: input.approver1Id,
      approver2Id: input.approver2Id,
    });

    const result = await this.repository.updateDepartmentActors(
      input.departmentId,
      input.approver1Id,
      input.approver2Id,
    );

    if (!result.success) {
      this.logger.error("ManageActorsService.updateDepartmentActors.failed", {
        departmentId: input.departmentId,
        errorMessage: result.errorMessage,
      });

      return {
        success: false,
        errorCode: "UPDATE_FAILED",
        errorMessage: result.errorMessage ?? "Failed to update department actors.",
      };
    }

    return { success: true, errorCode: null, errorMessage: null };
  }

  async updateDepartmentActorsByEmail(
    input: UpdateDepartmentActorsByEmailInput,
  ): Promise<MutateResult> {
    const approver1Email = input.approver1Email?.trim().toLowerCase();
    const approver2Email = input.approver2Email?.trim().toLowerCase();

    if (!approver1Email || !approver1Email.includes("@")) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid Approver 1 email address is required.",
      };
    }

    if (!approver2Email || !approver2Email.includes("@")) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid Approver 2 email address is required.",
      };
    }

    if (!input.departmentId?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Department ID is required.",
      };
    }

    this.logger.info("ManageActorsService.updateDepartmentActorsByEmail", {
      departmentId: input.departmentId,
      approver1Email,
      approver2Email,
    });

    const result = await this.repository.updateDepartmentActorsByEmail(
      input.departmentId,
      approver1Email,
      approver2Email,
    );

    if (!result.success) {
      this.logger.error("ManageActorsService.updateDepartmentActorsByEmail.failed", {
        departmentId: input.departmentId,
        errorMessage: result.errorMessage,
      });

      return {
        success: false,
        errorCode: "UPDATE_FAILED",
        errorMessage: result.errorMessage ?? "Failed to update department actors.",
      };
    }

    return { success: true, errorCode: null, errorMessage: null };
  }

  async getFinanceApprovers(): Promise<GetFinanceApproversResult> {
    const result = await this.repository.getFinanceApprovers();

    if (result.errorMessage) {
      this.logger.error("ManageActorsService.getFinanceApprovers.failed", {
        errorMessage: result.errorMessage,
      });

      return { data: [], errorCode: "FETCH_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async createFinanceApprover(input: CreateFinanceApproverInput): Promise<FinanceApproverResult> {
    if (!input.userId?.trim()) {
      return { data: null, errorCode: "INVALID_INPUT", errorMessage: "User ID is required." };
    }

    this.logger.info("ManageActorsService.createFinanceApprover", { userId: input.userId });

    const result = await this.repository.createFinanceApprover(input.userId);

    if (result.errorMessage) {
      this.logger.error("ManageActorsService.createFinanceApprover.failed", {
        userId: input.userId,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "CREATE_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async addFinanceApproverByEmail(
    input: AddFinanceApproverByEmailInput,
  ): Promise<FinanceApproverResult> {
    const trimmedEmail = input.email?.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid email address is required.",
      };
    }

    this.logger.info("ManageActorsService.addFinanceApproverByEmail", { email: trimmedEmail });

    const result = await this.repository.addFinanceApproverByEmail(trimmedEmail);

    if (result.errorMessage) {
      this.logger.error("ManageActorsService.addFinanceApproverByEmail.failed", {
        email: trimmedEmail,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "CREATE_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async updateFinanceApprover(input: UpdateFinanceApproverInput): Promise<FinanceApproverResult> {
    if (!input.id?.trim()) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "Finance approver ID is required.",
      };
    }

    this.logger.info("ManageActorsService.updateFinanceApprover", {
      id: input.id,
      payload: input.payload,
    });

    const result = await this.repository.updateFinanceApprover(input.id, input.payload);

    if (result.errorMessage) {
      this.logger.error("ManageActorsService.updateFinanceApprover.failed", {
        id: input.id,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "UPDATE_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }
}
