import type {
  ClaimDomainLogger,
  DepartmentViewerClaimRecord,
  DepartmentViewerFilters,
  DepartmentViewerPaginatedResult,
  DepartmentViewerPaginationInput,
  DepartmentViewerRepository,
} from "@/core/domain/claims/contracts";

type Dependencies = {
  repository: DepartmentViewerRepository;
  logger: ClaimDomainLogger;
};

type GetDepartmentViewClaimsInput = {
  userId: string;
  filters: DepartmentViewerFilters;
  pagination: DepartmentViewerPaginationInput;
};

type GetDepartmentViewClaimsResult = {
  data: DepartmentViewerPaginatedResult<DepartmentViewerClaimRecord> | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class GetDepartmentViewClaimsService {
  private readonly repository: DepartmentViewerRepository;
  private readonly logger: ClaimDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async execute(input: GetDepartmentViewClaimsInput): Promise<GetDepartmentViewClaimsResult> {
    this.logger.info("GetDepartmentViewClaimsService.execute", {
      userId: input.userId,
      filters: input.filters,
      cursor: input.pagination.cursor,
      limit: input.pagination.limit,
    });

    // 1. Fetch viewer department IDs
    const deptsResult = await this.repository.getViewerDepartments(input.userId);

    if (deptsResult.errorMessage) {
      this.logger.error("GetDepartmentViewClaimsService.execute.viewerDepartmentsError", {
        userId: input.userId,
        errorMessage: deptsResult.errorMessage,
      });
      return {
        data: null,
        errorCode: "FETCH_DEPARTMENTS_FAILED",
        errorMessage: deptsResult.errorMessage,
      };
    }

    if (deptsResult.data.length === 0) {
      return {
        data: { data: [], nextCursor: null, hasNextPage: false },
        errorCode: null,
        errorMessage: null,
      };
    }

    const departmentIds = deptsResult.data.map((d) => d.id);

    // 2. Fetch claims for those departments
    const claimsResult = await this.repository.getClaims(
      departmentIds,
      input.filters,
      input.pagination,
    );

    if (claimsResult.errorMessage) {
      this.logger.error("GetDepartmentViewClaimsService.execute.claimsError", {
        userId: input.userId,
        errorMessage: claimsResult.errorMessage,
      });
      return {
        data: null,
        errorCode: "FETCH_CLAIMS_FAILED",
        errorMessage: claimsResult.errorMessage,
      };
    }

    return {
      data: claimsResult.data,
      errorCode: null,
      errorMessage: null,
    };
  }
}
