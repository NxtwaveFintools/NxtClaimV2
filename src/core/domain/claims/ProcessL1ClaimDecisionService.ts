import {
  DB_CLAIM_STATUSES,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import type { ClaimDomainLogger } from "@/core/domain/claims/contracts";

type DecisionType = "approve" | "reject";

type ProcessL1ClaimDecisionRepository = {
  getClaimForL1Decision(claimId: string): Promise<{
    data: {
      id: string;
      status: DbClaimStatus;
      assignedL1ApproverId: string;
      assignedL2ApproverId: string | null;
    } | null;
    errorMessage: string | null;
  }>;
  getPrimaryFinanceApproverId(): Promise<{ data: string | null; errorMessage: string | null }>;
  updateClaimL1Decision(input: {
    claimId: string;
    actorUserId: string;
    status: DbClaimStatus;
    assignedL2ApproverId: string | null;
    rejectionReason: string | null;
    allowResubmission: boolean;
  }): Promise<{ errorMessage: string | null }>;
};

type ProcessL1ClaimDecisionServiceDependencies = {
  repository: ProcessL1ClaimDecisionRepository;
  logger: ClaimDomainLogger;
};

export class ProcessL1ClaimDecisionService {
  private readonly repository: ProcessL1ClaimDecisionRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: ProcessL1ClaimDecisionServiceDependencies) {
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
    const claimResult = await this.repository.getClaimForL1Decision(input.claimId);

    if (claimResult.errorMessage) {
      this.logger.error("claims.process_l1_decision.lookup_failed", {
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

    if (claimResult.data.assignedL1ApproverId !== input.actorUserId) {
      return { ok: false, errorMessage: "You are not authorized to approve or reject this claim." };
    }

    if (claimResult.data.status !== DB_CLAIM_STATUSES[0]) {
      return { ok: false, errorMessage: "This claim is no longer pending L1 approval." };
    }

    if (input.decision === "reject") {
      const normalizedReason = input.rejectionReason?.trim() ?? "";
      const finalStatus =
        input.allowResubmission === true
          ? DB_REJECTED_RESUBMISSION_ALLOWED_STATUS
          : DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS;

      if (normalizedReason.length < 5) {
        return { ok: false, errorMessage: "Rejection reason is required." };
      }

      const rejectResult = await this.repository.updateClaimL1Decision({
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        status: finalStatus,
        assignedL2ApproverId: claimResult.data.assignedL2ApproverId,
        rejectionReason: normalizedReason,
        allowResubmission: input.allowResubmission === true,
      });

      if (rejectResult.errorMessage) {
        this.logger.error("claims.process_l1_decision.reject_failed", {
          claimId: input.claimId,
          actorUserId: input.actorUserId,
          errorMessage: rejectResult.errorMessage,
        });

        return { ok: false, errorMessage: rejectResult.errorMessage };
      }

      return { ok: true, errorMessage: null };
    }

    const financeApproverIdResult = await this.repository.getPrimaryFinanceApproverId();

    if (financeApproverIdResult.errorMessage) {
      this.logger.error("claims.process_l1_decision.finance_lookup_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        errorMessage: financeApproverIdResult.errorMessage,
      });

      return { ok: false, errorMessage: financeApproverIdResult.errorMessage };
    }

    const assignedL2ApproverId =
      claimResult.data.assignedL2ApproverId ?? financeApproverIdResult.data;

    if (!assignedL2ApproverId) {
      return {
        ok: false,
        errorMessage: "No active finance approver is configured.",
      };
    }

    const approveResult = await this.repository.updateClaimL1Decision({
      claimId: input.claimId,
      actorUserId: input.actorUserId,
      status: DB_CLAIM_STATUSES[1],
      assignedL2ApproverId,
      rejectionReason: null,
      allowResubmission: false,
    });

    if (approveResult.errorMessage) {
      this.logger.error("claims.process_l1_decision.approve_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        errorMessage: approveResult.errorMessage,
      });

      return { ok: false, errorMessage: approveResult.errorMessage };
    }

    return { ok: true, errorMessage: null };
  }
}
