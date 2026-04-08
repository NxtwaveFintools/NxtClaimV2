import {
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import type { ClaimDomainLogger, FinanceClaimEditPayload } from "@/core/domain/claims/contracts";

const PRE_HOD_EDITABLE_STATUSES: readonly DbClaimStatus[] = [
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
];

type UpdateClaimByFinanceRepository = {
  getFinanceApproverIdsForUser(
    userId: string,
  ): Promise<{ data: string[]; errorMessage: string | null }>;
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
  updateClaimDetailsByFinance(
    claimId: string,
    payload: FinanceClaimEditPayload,
  ): Promise<{ errorMessage: string | null }>;
};

type UpdateClaimByFinanceServiceDependencies = {
  repository: UpdateClaimByFinanceRepository;
  logger: ClaimDomainLogger;
};

export class UpdateClaimByFinanceService {
  private readonly repository: UpdateClaimByFinanceRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: UpdateClaimByFinanceServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  private isPreHodEditableStatus(status: DbClaimStatus): boolean {
    return PRE_HOD_EDITABLE_STATUSES.some((candidate) => candidate === status);
  }

  async execute(input: {
    claimId: string;
    actorUserId: string;
    payload: FinanceClaimEditPayload;
  }): Promise<{ ok: boolean; errorMessage: string | null }> {
    const claimResult = await this.repository.getClaimForFinanceEdit(input.claimId);

    if (claimResult.errorMessage) {
      this.logger.error("claims.finance_edit.lookup_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        errorMessage: claimResult.errorMessage,
      });
      return { ok: false, errorMessage: claimResult.errorMessage };
    }

    if (!claimResult.data) {
      return { ok: false, errorMessage: "Claim not found." };
    }

    const isFinanceStage =
      claimResult.data.status === DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS;
    const isPreHodStage = this.isPreHodEditableStatus(claimResult.data.status);

    if (isFinanceStage) {
      const financeScopeResult = await this.repository.getFinanceApproverIdsForUser(
        input.actorUserId,
      );

      if (financeScopeResult.errorMessage) {
        this.logger.error("claims.finance_edit.finance_scope_lookup_failed", {
          claimId: input.claimId,
          actorUserId: input.actorUserId,
          errorMessage: financeScopeResult.errorMessage,
        });
        return { ok: false, errorMessage: financeScopeResult.errorMessage };
      }

      if ((financeScopeResult.data ?? []).length === 0) {
        this.logger.warn("claims.finance_edit.unauthorized", {
          claimId: input.claimId,
          actorUserId: input.actorUserId,
          status: claimResult.data.status,
          reason: "finance_scope_missing",
        });
        return { ok: false, errorMessage: "You are not authorized to edit this claim." };
      }
    } else if (isPreHodStage) {
      const isSubmitter = input.actorUserId === claimResult.data.submittedBy;
      const isAssignedL1 = input.actorUserId === claimResult.data.assignedL1ApproverId;

      if (!isSubmitter && !isAssignedL1) {
        this.logger.warn("claims.finance_edit.unauthorized", {
          claimId: input.claimId,
          actorUserId: input.actorUserId,
          status: claimResult.data.status,
          reason: "not_submitter_or_assigned_l1",
        });
        return { ok: false, errorMessage: "You are not authorized to edit this claim." };
      }
    } else {
      this.logger.warn("claims.finance_edit.unauthorized", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        status: claimResult.data.status,
        reason: "status_not_editable",
      });
      return { ok: false, errorMessage: "You are not authorized to edit this claim." };
    }

    if (claimResult.data.detailType !== input.payload.detailType) {
      return { ok: false, errorMessage: "Claim detail type mismatch for edit request." };
    }

    const updateResult = await this.repository.updateClaimDetailsByFinance(
      input.claimId,
      input.payload,
    );

    if (updateResult.errorMessage) {
      this.logger.error("claims.finance_edit.update_failed", {
        claimId: input.claimId,
        actorUserId: input.actorUserId,
        detailType: input.payload.detailType,
        errorMessage: updateResult.errorMessage,
      });
      return { ok: false, errorMessage: updateResult.errorMessage };
    }

    this.logger.info("claims.finance_edit.updated", {
      claimId: input.claimId,
      actorUserId: input.actorUserId,
      detailType: input.payload.detailType,
    });

    return { ok: true, errorMessage: null };
  }
}
