import type { AdminDomainLogger, AdminRepository } from "@/core/domain/admin/contracts";

type Dependencies = {
  repository: AdminRepository;
  logger: AdminDomainLogger;
};

type AdminSoftDeleteInput = {
  claimId: string;
  actorId: string;
};

type AdminSoftDeleteResult = {
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

export class AdminSoftDeleteClaimService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async execute(input: AdminSoftDeleteInput): Promise<AdminSoftDeleteResult> {
    if (!input.claimId || !input.claimId.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Claim ID is required.",
      };
    }

    if (!input.actorId || !input.actorId.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Actor ID is required.",
      };
    }

    this.logger.info("AdminSoftDeleteClaimService.execute", {
      claimId: input.claimId,
      actorId: input.actorId,
    });

    const result = await this.repository.softDeleteClaim(input.claimId, input.actorId);

    if (!result.success) {
      this.logger.error("AdminSoftDeleteClaimService.execute.failed", {
        claimId: input.claimId,
        errorMessage: result.errorMessage,
      });

      return {
        success: false,
        errorCode: "SOFT_DELETE_FAILED",
        errorMessage: result.errorMessage ?? "Failed to soft-delete claim.",
      };
    }

    if (result.errorMessage) {
      // Audit log warning: soft-delete succeeded but log write failed
      this.logger.warn("AdminSoftDeleteClaimService.execute.auditLogWarning", {
        claimId: input.claimId,
        warningMessage: result.errorMessage,
      });
    }

    this.logger.info("AdminSoftDeleteClaimService.execute.success", {
      claimId: input.claimId,
    });

    return {
      success: true,
      errorCode: null,
      errorMessage: null,
    };
  }
}
