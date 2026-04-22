import {
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import type { ClaimDomainLogger, OwnClaimEditPayload } from "@/core/domain/claims/contracts";

const PRE_HOD_EDITABLE_STATUSES: readonly DbClaimStatus[] = [
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
];

type UpdateOwnClaimRepository = {
  getClaimForFinanceEdit(claimId: string): Promise<{
    data: {
      id: string;
      detailType: "expense" | "advance";
      status: DbClaimStatus;
      submittedBy: string;
      assignedL1ApproverId: string;
      expenseReceiptFilePath: string | null;
      expenseBankStatementFilePath: string | null;
      advanceSupportingDocumentPath: string | null;
    } | null;
    errorMessage: string | null;
  }>;
  updateClaimDetailsBySubmitter(
    claimId: string,
    actorUserId: string,
    payload: OwnClaimEditPayload,
  ): Promise<{ errorMessage: string | null }>;
};

type UpdateOwnClaimServiceDependencies = {
  repository: UpdateOwnClaimRepository;
  logger: ClaimDomainLogger;
};

export class UpdateOwnClaimService {
  private readonly repository: UpdateOwnClaimRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: UpdateOwnClaimServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  private isPreHodEditableStatus(status: DbClaimStatus): boolean {
    return PRE_HOD_EDITABLE_STATUSES.some((candidate) => candidate === status);
  }

  async execute(input: {
    claimId: string;
    actorUserId: string;
    payload: OwnClaimEditPayload;
  }): Promise<{ ok: boolean; errorMessage: string | null }> {
    const claimResult = await this.repository.getClaimForFinanceEdit(input.claimId);

    if (claimResult.errorMessage) {
      this.logger.error("claims.own_edit.lookup_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        errorMessage: claimResult.errorMessage,
      });
      return { ok: false, errorMessage: claimResult.errorMessage };
    }

    if (!claimResult.data) {
      return { ok: false, errorMessage: "Claim not found." };
    }

    const claim = claimResult.data;

    if (!this.isPreHodEditableStatus(claim.status)) {
      this.logger.warn("claims.own_edit.unauthorized", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        status: claim.status,
        reason: "status_not_editable",
      });
      return { ok: false, errorMessage: "You are not authorized to edit this claim." };
    }

    const isSubmitter = input.actorUserId === claim.submittedBy;
    const isAssignedL1 = input.actorUserId === claim.assignedL1ApproverId;

    if (!isSubmitter && !isAssignedL1) {
      this.logger.warn("claims.own_edit.unauthorized", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        status: claim.status,
        reason: "not_submitter_or_assigned_l1",
      });
      return { ok: false, errorMessage: "You are not authorized to edit this claim." };
    }

    if (claim.detailType !== input.payload.detailType) {
      return { ok: false, errorMessage: "Claim detail type mismatch for edit request." };
    }

    const updateResult = await this.repository.updateClaimDetailsBySubmitter(
      input.claimId,
      input.actorUserId,
      input.payload,
    );

    if (updateResult.errorMessage) {
      this.logger.error("claims.own_edit.update_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        detailType: input.payload.detailType,
        errorMessage: updateResult.errorMessage,
      });
      return { ok: false, errorMessage: updateResult.errorMessage };
    }

    this.logger.info("claims.own_edit.updated", {
      claimId: input.claimId,
      actorUserId: input.actorUserId,
      detailType: input.payload.detailType,
    });

    return { ok: true, errorMessage: null };
  }
}
