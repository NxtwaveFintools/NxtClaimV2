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
  submitterEmail: string | null;
  hodEmail: string | null;
  financeEmail: string | null;
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
  submitterEmail: string | null;
  hodEmail: string | null;
  financeEmail: string | null;
};

type PaginatedClaimsRepository = {
  getMyClaimsPaginated(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: RepositoryClaimRow[];
    nextCursor: string | null;
    hasNextPage: boolean;
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
    cursor: string | null;
    limit: number;
    filters?: GetMyClaimsFilters;
  }): Promise<{
    data: MyClaimsPaginatedRecord[];
    nextCursor: string | null;
    hasNextPage: boolean;
    errorMessage: string | null;
  }> {
    const result = await this.repository.getMyClaimsPaginated(
      input.userId,
      input.cursor,
      input.limit,
      input.filters,
    );

    if (result.errorMessage) {
      this.logger.error("claims.get_my_claims_paginated_failed", {
        userId: input.userId,
        cursor: input.cursor,
        errorMessage: result.errorMessage,
      });

      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
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
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
      errorMessage: null,
    };
  }
}
