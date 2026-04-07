import {
  DB_CLAIM_STATUSES,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import type { ClaimDomainLogger } from "@/core/domain/claims/contracts";

type DecisionType = "approve" | "reject" | "mark-paid";

type ProcessL2ClaimDecisionRepository = {
  getClaimForL2Decision(claimId: string): Promise<{
    data: { id: string; status: DbClaimStatus; assignedL2ApproverId: string | null } | null;
    errorMessage: string | null;
  }>;
  getFinanceApproverIdsForUser(
    userId: string,
  ): Promise<{ data: string[]; errorMessage: string | null }>;
  updateClaimL2Decision(input: {
    claimId: string;
    actorUserId: string;
    status: DbClaimStatus;
    assignedL2ApproverId: string | null;
    rejectionReason: string | null;
    allowResubmission: boolean;
  }): Promise<{ errorMessage: string | null }>;
};

type ProcessL2ClaimDecisionServiceDependencies = {
  repository: ProcessL2ClaimDecisionRepository;
  logger: ClaimDomainLogger;
};

export class ProcessL2ClaimDecisionService {
  private readonly repository: ProcessL2ClaimDecisionRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: ProcessL2ClaimDecisionServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  async execute(input: {
    claimId: string;
    actorUserId: string;
    decision: DecisionType;
    rejectionReason?: string;
    allowResubmission?: boolean;
  }): Promise<{ ok: boolean; errorMessage: string | null }> {
    const claimResult = await this.repository.getClaimForL2Decision(input.claimId);

    if (claimResult.errorMessage) {
      this.logger.error("claims.process_l2_decision.lookup_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        decision: input.decision,
        errorMessage: claimResult.errorMessage,
      });

      return { ok: false, errorMessage: claimResult.errorMessage };
    }

    if (!claimResult.data) {
      return { ok: false, errorMessage: "Claim not found." };
    }

    const financeApproverIdsResult = await this.repository.getFinanceApproverIdsForUser(
      input.actorUserId,
    );

    if (financeApproverIdsResult.errorMessage) {
      this.logger.error("claims.process_l2_decision.finance_scope_lookup_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        decision: input.decision,
        errorMessage: financeApproverIdsResult.errorMessage,
      });

      return { ok: false, errorMessage: financeApproverIdsResult.errorMessage };
    }

    const actorFinanceApproverId = financeApproverIdsResult.data[0] ?? null;

    if (!actorFinanceApproverId) {
      return {
        ok: false,
        errorMessage: "You are not authorized to process this finance decision.",
      };
    }

    let nextStatus: DbClaimStatus;
    let rejectionReason: string | null = null;

    if (input.decision === "mark-paid") {
      if (claimResult.data.status !== DB_CLAIM_STATUSES[2]) {
        return {
          ok: false,
          errorMessage: "This claim is not in payment-under-process stage.",
        };
      }

      nextStatus = DB_CLAIM_STATUSES[3];
    } else {
      if (claimResult.data.status !== DB_CLAIM_STATUSES[1]) {
        return {
          ok: false,
          errorMessage: "This claim is no longer pending finance authorization.",
        };
      }

      if (input.decision === "reject") {
        const normalizedReason = input.rejectionReason?.trim() ?? "";

        if (normalizedReason.length < 5) {
          return {
            ok: false,
            errorMessage: "Rejection reason is required.",
          };
        }

        rejectionReason = normalizedReason;
      }

      nextStatus =
        input.decision === "approve"
          ? DB_CLAIM_STATUSES[2]
          : input.allowResubmission === true
            ? DB_REJECTED_RESUBMISSION_ALLOWED_STATUS
            : DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS;
    }

    const updateResult = await this.repository.updateClaimL2Decision({
      claimId: input.claimId,
      actorUserId: input.actorUserId,
      status: nextStatus,
      assignedL2ApproverId: actorFinanceApproverId,
      rejectionReason,
      allowResubmission: input.decision === "reject" ? input.allowResubmission === true : false,
    });

    if (updateResult.errorMessage) {
      this.logger.error("claims.process_l2_decision.update_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        decision: input.decision,
        nextStatus,
        errorMessage: updateResult.errorMessage,
      });

      return { ok: false, errorMessage: updateResult.errorMessage };
    }

    return { ok: true, errorMessage: null };
  }
}
