import type { DbClaimStatus } from "@/core/constants/statuses";
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
  departmentName: string | null;
  paymentModeName: string;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  onBehalfEmail: string | null;
  purpose: string | null;
  categoryName: string;
  evidenceFilePath: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
  totalAmount: number;
  status: DbClaimStatus;
  submittedAt: string;
  formattedTotalAmount: string;
  formattedSubmittedAt: string;
};

type RepositoryApprovalRow = Omit<
  PendingApprovalRecord,
  "formattedTotalAmount" | "formattedSubmittedAt"
>;

type ApprovalViewerContext = {
  isHod: boolean;
  isFounder: boolean;
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
};

type GetPendingApprovalsServiceDependencies = {
  repository: PendingApprovalsRepository;
  logger: ClaimDomainLogger;
};

export class GetPendingApprovalsService {
  private readonly repository: PendingApprovalsRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: GetPendingApprovalsServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  async getViewerContext(input: { userId: string }): Promise<{
    canViewApprovals: boolean;
    activeScope: "l1" | "finance" | null;
    errorMessage: string | null;
  }> {
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

    const isL1 = viewerContextResult.data.isHod || viewerContextResult.data.isFounder;
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
  }): Promise<{
    data: PendingApprovalRecord[];
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }> {
    const viewerContext = await this.getViewerContext({ userId: input.userId });

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
      })),
      nextCursor: approvalsResult.nextCursor,
      hasNextPage: approvalsResult.hasNextPage,
      totalCount: approvalsResult.totalCount,
      errorMessage: null,
    };
  }
}
