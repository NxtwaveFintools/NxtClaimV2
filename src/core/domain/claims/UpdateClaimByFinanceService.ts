import type { ClaimDomainLogger, FinanceClaimEditPayload } from "@/core/domain/claims/contracts";

type UpdateClaimByFinanceRepository = {
  getFinanceApproverIdsForUser(
    userId: string,
  ): Promise<{ data: string[]; errorMessage: string | null }>;
  getClaimForFinanceEdit(claimId: string): Promise<{
    data: {
      id: string;
      detailType: "expense" | "advance";
      submittedBy: string;
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

  async execute(input: {
    claimId: string;
    actorUserId: string;
    payload: FinanceClaimEditPayload;
  }): Promise<{ ok: boolean; errorMessage: string | null }> {
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
      return { ok: false, errorMessage: "You are not authorized to edit this claim." };
    }

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

    if (claimResult.data.detailType !== input.payload.detailType) {
      return { ok: false, errorMessage: "Claim detail type mismatch for finance edit request." };
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
