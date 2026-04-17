import type {
  AdminDomainLogger,
  AdminRepository,
  CreatedDepartmentRecord,
} from "@/core/domain/admin/contracts";

type Dependencies = {
  repository: AdminRepository;
  logger: AdminDomainLogger;
};

type CreateDepartmentInput = {
  name: string;
  hodEmail: string;
  founderEmail: string;
};

type CreateDepartmentResult = {
  data: CreatedDepartmentRecord | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class CreateDepartmentService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async createDepartment(input: CreateDepartmentInput): Promise<CreateDepartmentResult> {
    const name = input.name?.trim();
    const hodEmail = input.hodEmail?.trim().toLowerCase();
    const founderEmail = input.founderEmail?.trim().toLowerCase();

    if (!name) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "Department name is required.",
      };
    }

    if (!hodEmail || !hodEmail.includes("@")) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid HOD email address is required.",
      };
    }

    if (!founderEmail || !founderEmail.includes("@")) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid Founder email address is required.",
      };
    }

    if (hodEmail === founderEmail) {
      return {
        data: null,
        errorCode: "SAME_APPROVER",
        errorMessage: "HOD and Founder cannot be the same person.",
      };
    }

    this.logger.info("CreateDepartmentService.createDepartment", {
      name,
      hodEmail,
      founderEmail,
    });

    const result = await this.repository.createDepartmentWithActorsByEmail({
      name,
      hodEmail,
      founderEmail,
    });

    if (result.errorMessage) {
      this.logger.error("CreateDepartmentService.createDepartment.failed", {
        name,
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
}
