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
  approver1Email: string;
  approver2Email: string;
};

type CreateDepartmentResult = {
  data: CreatedDepartmentRecord | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const SAME_APPROVER_ERROR_MESSAGE = "Approver 1 and Approver 2 cannot be the same person.";

export class CreateDepartmentService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async createDepartment(input: CreateDepartmentInput): Promise<CreateDepartmentResult> {
    const name = input.name?.trim();
    const approver1Email = input.approver1Email?.trim().toLowerCase();
    const approver2Email = input.approver2Email?.trim().toLowerCase();

    if (!name) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "Department name is required.",
      };
    }

    if (!approver1Email || !approver1Email.includes("@")) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid Approver 1 email address is required.",
      };
    }

    if (!approver2Email || !approver2Email.includes("@")) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid Approver 2 email address is required.",
      };
    }

    if (approver1Email === approver2Email) {
      return {
        data: null,
        errorCode: "SAME_APPROVER",
        errorMessage: SAME_APPROVER_ERROR_MESSAGE,
      };
    }

    this.logger.info("CreateDepartmentService.createDepartment", {
      name,
      approver1Email,
      approver2Email,
    });

    const result = await this.repository.createDepartmentWithActorsByEmail({
      name,
      approver1Email,
      approver2Email,
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
