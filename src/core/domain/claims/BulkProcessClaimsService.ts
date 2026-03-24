import type { ClaimDomainLogger, GetMyClaimsFilters } from "@/core/domain/claims/contracts";

type BulkAction = "L2_APPROVE" | "L2_REJECT" | "MARK_PAID";

type BulkProcessClaimsRepository = {
  getFinanceApproverIdsForUser(
    userId: string,
  ): Promise<{ data: string[]; errorMessage: string | null }>;
  listFinancePendingApprovalIds(
    userId: string,
    filters?: GetMyClaimsFilters,
  ): Promise<{ data: string[]; errorMessage: string | null }>;
  bulkProcessClaims(input: {
    claimIds: string[];
    action: BulkAction;
    actorUserId: string;
    reason?: string;
    allowResubmission?: boolean;
  }): Promise<{ processedCount: number; errorMessage: string | null }>;
};

type BulkProcessClaimsServiceDependencies = {
  repository: BulkProcessClaimsRepository;
  logger: ClaimDomainLogger;
};

export class BulkProcessClaimsService {
  private readonly repository: BulkProcessClaimsRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: BulkProcessClaimsServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  async execute(input: {
    actorUserId: string;
    action: BulkAction;
    claimIds: string[];
    isGlobalSelect: boolean;
    filters?: GetMyClaimsFilters;
    reason?: string;
    allowResubmission?: boolean;
  }): Promise<{ ok: boolean; processedCount: number; errorMessage: string | null }> {
    const financeApproversResult = await this.repository.getFinanceApproverIdsForUser(
      input.actorUserId,
    );

    if (financeApproversResult.errorMessage) {
      this.logger.error("claims.bulk_process.finance_scope_lookup_failed", {
        actorUserId: input.actorUserId,
        action: input.action,
        errorMessage: financeApproversResult.errorMessage,
      });

      return {
        ok: false,
        processedCount: 0,
        errorMessage: financeApproversResult.errorMessage,
      };
    }

    if (financeApproversResult.data.length === 0) {
      return {
        ok: false,
        processedCount: 0,
        errorMessage: "Only Finance users can run bulk claim actions.",
      };
    }

    const normalizedClaimIds = [...new Set(input.claimIds.map((id) => id.trim()).filter(Boolean))];

    let targetClaimIds = normalizedClaimIds;

    if (input.isGlobalSelect) {
      const globalIdsResult = await this.repository.listFinancePendingApprovalIds(
        input.actorUserId,
        input.filters,
      );

      if (globalIdsResult.errorMessage) {
        this.logger.error("claims.bulk_process.resolve_global_ids_failed", {
          actorUserId: input.actorUserId,
          action: input.action,
          errorMessage: globalIdsResult.errorMessage,
        });

        return {
          ok: false,
          processedCount: 0,
          errorMessage: globalIdsResult.errorMessage,
        };
      }

      targetClaimIds = globalIdsResult.data;
    }

    if (targetClaimIds.length === 0) {
      return {
        ok: false,
        processedCount: 0,
        errorMessage: "No claims matched the current bulk selection.",
      };
    }

    const processResult = await this.repository.bulkProcessClaims({
      claimIds: targetClaimIds,
      action: input.action,
      actorUserId: input.actorUserId,
      reason: input.reason,
      allowResubmission: input.allowResubmission,
    });

    if (processResult.errorMessage) {
      this.logger.error("claims.bulk_process.rpc_failed", {
        actorUserId: input.actorUserId,
        action: input.action,
        claimCount: targetClaimIds.length,
        errorMessage: processResult.errorMessage,
      });

      return {
        ok: false,
        processedCount: 0,
        errorMessage: processResult.errorMessage,
      };
    }

    if (processResult.processedCount === 0) {
      return {
        ok: false,
        processedCount: 0,
        errorMessage: "No claims were updated. They may have already changed state.",
      };
    }

    this.logger.info("claims.bulk_process.succeeded", {
      actorUserId: input.actorUserId,
      action: input.action,
      requestedCount: targetClaimIds.length,
      processedCount: processResult.processedCount,
    });

    return {
      ok: true,
      processedCount: processResult.processedCount,
      errorMessage: null,
    };
  }
}
