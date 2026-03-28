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
  hodUserId: string;
  founderUserId: string;
};

type UpdateDepartmentActorsByEmailInput = {
  departmentId: string;
  hodEmail: string;
  founderEmail: string;
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

    if (!input.hodUserId?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "HOD user ID is required.",
      };
    }

    if (!input.founderUserId?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Founder user ID is required.",
      };
    }

    if (input.hodUserId === input.founderUserId) {
      return {
        success: false,
        errorCode: "SAME_APPROVER",
        errorMessage: "HOD and Founder cannot be the same person.",
      };
    }

    this.logger.info("ManageActorsService.updateDepartmentActors", {
      departmentId: input.departmentId,
      hodUserId: input.hodUserId,
      founderUserId: input.founderUserId,
    });

    const result = await this.repository.updateDepartmentActors(
      input.departmentId,
      input.hodUserId,
      input.founderUserId,
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
    const hodEmail = input.hodEmail?.trim().toLowerCase();
    const founderEmail = input.founderEmail?.trim().toLowerCase();

    if (!hodEmail || !hodEmail.includes("@")) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid HOD email address is required.",
      };
    }

    if (!founderEmail || !founderEmail.includes("@")) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid Founder email address is required.",
      };
    }

    if (hodEmail === founderEmail) {
      return {
        success: false,
        errorCode: "SAME_APPROVER",
        errorMessage: "HOD and Founder cannot be the same person.",
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
      hodEmail,
      founderEmail,
    });

    const result = await this.repository.updateDepartmentActorsByEmail(
      input.departmentId,
      hodEmail,
      founderEmail,
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
