import { cache } from "react";
import {
  GetPendingApprovalsService,
  type PendingApprovalsViewerContext,
} from "@/core/domain/claims/GetPendingApprovalsService";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";

const pendingApprovalsRepository = new SupabaseClaimRepository();
const pendingApprovalsViewerContextService = new GetPendingApprovalsService({
  repository: pendingApprovalsRepository,
  logger,
});

export const getCachedPendingApprovalsViewerContext = cache(
  async (userId: string): Promise<PendingApprovalsViewerContext> => {
    return pendingApprovalsViewerContextService.getViewerContext({ userId });
  },
);

export async function isFinancePendingApprovalsViewer(userId: string): Promise<boolean> {
  const viewerContext = await getCachedPendingApprovalsViewerContext(userId);

  return !viewerContext.errorMessage && viewerContext.activeScope === "finance";
}
