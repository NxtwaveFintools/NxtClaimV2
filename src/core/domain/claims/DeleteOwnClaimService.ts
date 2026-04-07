import { isSubmitterDeletableClaimStatus } from "@/core/constants/statuses";
import type { ClaimDomainLogger, ClaimRepository } from "@/core/domain/claims/contracts";

type Dependencies = {
  repository: Pick<ClaimRepository, "getClaimForSubmitterDelete" | "softDeleteClaimBySubmitter">;
  logger: ClaimDomainLogger;
};

type DeleteOwnClaimInput = {
  claimId: string;
  actorUserId: string;
};

type DeleteOwnClaimResult = {
  ok: boolean;
  errorMessage: string | null;
};

export class DeleteOwnClaimService {
  private readonly repository: Pick<
    ClaimRepository,
    "getClaimForSubmitterDelete" | "softDeleteClaimBySubmitter"
  >;

  private readonly logger: ClaimDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async execute(input: DeleteOwnClaimInput): Promise<DeleteOwnClaimResult> {
    if (!input.claimId || !input.claimId.trim()) {
      return { ok: false, errorMessage: "Claim ID is required." };
    }

    if (!input.actorUserId || !input.actorUserId.trim()) {
      return { ok: false, errorMessage: "Unauthorized session." };
    }

    const claimResult = await this.repository.getClaimForSubmitterDelete(input.claimId);

    if (claimResult.errorMessage) {
      this.logger.error("claims.delete_own.lookup_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        errorMessage: claimResult.errorMessage,
      });
      return { ok: false, errorMessage: claimResult.errorMessage };
    }

    if (!claimResult.data) {
      return { ok: false, errorMessage: "Claim not found." };
    }

    if (claimResult.data.submittedBy !== input.actorUserId) {
      return { ok: false, errorMessage: "You can only delete claims you submitted." };
    }

    if (!isSubmitterDeletableClaimStatus(claimResult.data.status)) {
      return {
        ok: false,
        errorMessage:
          "Only claims awaiting HOD approval or rejected with resubmission allowed can be deleted.",
      };
    }

    const deleteResult = await this.repository.softDeleteClaimBySubmitter(
      input.claimId,
      input.actorUserId,
    );

    if (!deleteResult.success) {
      this.logger.error("claims.delete_own.delete_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        errorMessage: deleteResult.errorMessage,
      });
      return {
        ok: false,
        errorMessage: deleteResult.errorMessage ?? "Failed to delete claim.",
      };
    }

    return { ok: true, errorMessage: null };
  }
}
