import {
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import type {
  ClaimDetailType,
  ClaimDomainLogger,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { formatCurrency, formatDate } from "@/lib/format";

type PendingApprovalRecord = {
  id: string;
  employeeId: string;
  submitter: string;
  submitterEmail: string | null;
  departmentName: string | null;
  paymentModeName: string;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  onBehalfEmail: string | null;
  onBehalfEmployeeCode: string | null;
  purpose: string | null;
  categoryName: string;
  evidenceFilePath: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
  totalAmount: number;
  status: DbClaimStatus;
  submittedAt: string;
  hodActionAt: string | null;
  financeActionAt: string | null;
  formattedTotalAmount: string;
  formattedSubmittedAt: string;
  formattedHodActionDate: string;
  formattedFinanceActionDate: string;
};

type RepositoryApprovalRow = Omit<
  PendingApprovalRecord,
  | "formattedTotalAmount"
  | "formattedSubmittedAt"
  | "formattedHodActionDate"
  | "formattedFinanceActionDate"
>;

type ApprovalViewerContext = {
  isApprover1: boolean;
  isApprover2: boolean;
  isFinance: boolean;
};

type PendingApprovalsRepository = {
  getApprovalViewerContext(userId: string): Promise<{
    data: ApprovalViewerContext;
    errorMessage: string | null;
  }>;
  getPendingApprovalsForL1(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: RepositoryApprovalRow[];
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }>;
  getPendingApprovalsForFinance(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: RepositoryApprovalRow[];
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }>;
  getPendingApprovalsForFinanceHodPendingObservability(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: RepositoryApprovalRow[];
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }>;
};

type GetPendingApprovalsServiceDependencies = {
  repository: PendingApprovalsRepository;
  logger: ClaimDomainLogger;
};

export type PendingApprovalsViewerContext = {
  canViewApprovals: boolean;
  activeScope: "l1" | "finance" | null;
  errorMessage: string | null;
};

export class GetPendingApprovalsService {
  private readonly repository: PendingApprovalsRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: GetPendingApprovalsServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  async getViewerContext(input: { userId: string }): Promise<PendingApprovalsViewerContext> {
    const viewerContextResult = await this.repository.getApprovalViewerContext(input.userId);

    if (viewerContextResult.errorMessage) {
      this.logger.error("claims.get_pending_approvals.viewer_context_failed", {
        userId: input.userId,
        errorMessage: viewerContextResult.errorMessage,
      });

      return {
        canViewApprovals: false,
        activeScope: null,
        errorMessage: viewerContextResult.errorMessage,
      };
    }

    const isL1 = viewerContextResult.data.isApprover1 || viewerContextResult.data.isApprover2;
    const isFinance = viewerContextResult.data.isFinance;

    return {
      canViewApprovals: isL1 || isFinance,
      // Finance scope takes precedence for dual-role users so they can process L2 queues.
      activeScope: isFinance ? "finance" : isL1 ? "l1" : null,
      errorMessage: null,
    };
  }

  async execute(input: {
    userId: string;
    cursor: string | null;
    limit: number;
    filters?: GetMyClaimsFilters;
    viewerContext?: PendingApprovalsViewerContext;
  }): Promise<{
    data: PendingApprovalRecord[];
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }> {
    const viewerContext =
      input.viewerContext ?? (await this.getViewerContext({ userId: input.userId }));

    if (viewerContext.errorMessage) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: viewerContext.errorMessage,
      };
    }

    if (!viewerContext.canViewApprovals || !viewerContext.activeScope) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: null,
      };
    }

    const approvalsResult =
      viewerContext.activeScope === "l1"
        ? await this.repository.getPendingApprovalsForL1(
            input.userId,
            input.cursor,
            input.limit,
            input.filters,
          )
        : await this.repository.getPendingApprovalsForFinance(
            input.userId,
            input.cursor,
            input.limit,
            input.filters,
          );

    if (approvalsResult.errorMessage) {
      this.logger.error("claims.get_pending_approvals.fetch_failed", {
        userId: input.userId,
        scope: viewerContext.activeScope,
        cursor: input.cursor,
        errorMessage: approvalsResult.errorMessage,
      });

      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: approvalsResult.errorMessage,
      };
    }

    return {
      data: approvalsResult.data.map((row) => ({
        ...row,
        formattedTotalAmount: formatCurrency(row.totalAmount),
        formattedSubmittedAt: formatDate(row.submittedAt),
        formattedHodActionDate: formatDate(row.hodActionAt),
        formattedFinanceActionDate: formatDate(row.financeActionAt),
      })),
      nextCursor: approvalsResult.nextCursor,
      hasNextPage: approvalsResult.hasNextPage,
      totalCount: approvalsResult.totalCount,
      errorMessage: null,
    };
  }

  async executeFinanceHodPendingObservability(input: {
    userId: string;
    cursor: string | null;
    limit: number;
    filters?: GetMyClaimsFilters;
    viewerContext?: PendingApprovalsViewerContext;
  }): Promise<{
    data: PendingApprovalRecord[];
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }> {
    const viewerContext =
      input.viewerContext ?? (await this.getViewerContext({ userId: input.userId }));

    if (viewerContext.errorMessage) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: viewerContext.errorMessage,
      };
    }

    if (!viewerContext.canViewApprovals || viewerContext.activeScope !== "finance") {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: null,
      };
    }

    const approvalsResult =
      await this.repository.getPendingApprovalsForFinanceHodPendingObservability(
        input.userId,
        input.cursor,
        input.limit,
        input.filters,
      );

    if (approvalsResult.errorMessage) {
      this.logger.error("claims.get_pending_approvals.finance_hod_pending.fetch_failed", {
        userId: input.userId,
        cursor: input.cursor,
        errorMessage: approvalsResult.errorMessage,
      });

      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: approvalsResult.errorMessage,
      };
    }

    return {
      data: approvalsResult.data.map((row) => ({
        ...row,
        formattedTotalAmount: formatCurrency(row.totalAmount),
        formattedSubmittedAt: formatDate(row.submittedAt),
        formattedHodActionDate: formatDate(row.hodActionAt),
        formattedFinanceActionDate: formatDate(row.financeActionAt),
      })),
      nextCursor: approvalsResult.nextCursor,
      hasNextPage: approvalsResult.hasNextPage,
      totalCount: approvalsResult.totalCount,
      errorMessage: null,
    };
  }
}

export function getDefaultApprovalsStatusFilter(
  scope: "l1" | "finance" | null,
): DbClaimStatus | null {
  if (scope === "l1") return DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS;
  if (scope === "finance") return DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS;
  return null;
}
