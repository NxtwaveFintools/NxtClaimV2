import type { DbClaimStatus } from "@/core/constants/statuses";
import type {
  ClaimDetailType,
  ClaimDomainLogger,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { formatCurrency, formatDate } from "@/lib/format";

type MyClaimsPaginatedRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentName: string;
  typeOfClaim: string;
  totalAmount: number;
  status: DbClaimStatus;
  submittedAt: string;
  hodActionDate: string | null;
  financeActionDate: string | null;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  onBehalfEmail: string | null;
  submitterEmail: string | null;
  hodEmail: string | null;
  financeEmail: string | null;
  submitterLabel: string | null;
  categoryName: string | null;
  purpose: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
  formattedTotalAmount: string;
  formattedSubmittedAt: string;
  formattedHodActionDate: string;
  formattedFinanceActionDate: string;
};

type RepositoryClaimRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentName: string;
  typeOfClaim: string;
  totalAmount: number;
  status: DbClaimStatus;
  submittedAt: string;
  hodActionDate: string | null;
  financeActionDate: string | null;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  onBehalfEmail: string | null;
  submitterEmail: string | null;
  hodEmail: string | null;
  financeEmail: string | null;
  submitterLabel: string | null;
  categoryName: string | null;
  purpose: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
};

type PaginatedClaimsRepository = {
  getMyClaimsPaginated(
    userId: string,
    page: number,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: RepositoryClaimRow[];
    totalCount: number;
    errorMessage: string | null;
  }>;
};

type GetMyClaimsPaginatedServiceDependencies = {
  repository: PaginatedClaimsRepository;
  logger: ClaimDomainLogger;
};

export class GetMyClaimsPaginatedService {
  private readonly repository: PaginatedClaimsRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: GetMyClaimsPaginatedServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  async execute(input: {
    userId: string;
    page: number;
    limit: number;
    filters?: GetMyClaimsFilters;
  }): Promise<{
    data: MyClaimsPaginatedRecord[];
    totalCount: number;
    errorMessage: string | null;
  }> {
    const result = await this.repository.getMyClaimsPaginated(
      input.userId,
      input.page,
      input.limit,
      input.filters,
    );

    if (result.errorMessage) {
      this.logger.error("claims.get_my_claims_paginated_failed", {
        userId: input.userId,
        page: input.page,
        errorMessage: result.errorMessage,
      });

      return {
        data: [],
        totalCount: 0,
        errorMessage: result.errorMessage,
      };
    }

    return {
      data: result.data.map((row) => ({
        ...row,
        formattedTotalAmount: formatCurrency(row.totalAmount),
        formattedSubmittedAt: formatDate(row.submittedAt),
        formattedHodActionDate: formatDate(row.hodActionDate),
        formattedFinanceActionDate: formatDate(row.financeActionDate),
      })),
      totalCount: result.totalCount,
      errorMessage: null,
    };
  }
}
