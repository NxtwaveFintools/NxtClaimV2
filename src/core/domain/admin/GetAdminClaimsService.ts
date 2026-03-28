import type {
  AdminClaimRecord,
  AdminClaimsFilters,
  AdminCursorPaginatedResult,
  AdminCursorPaginationInput,
  AdminDomainLogger,
  AdminRepository,
} from "@/core/domain/admin/contracts";

type Dependencies = {
  repository: AdminRepository;
  logger: AdminDomainLogger;
};

type GetAdminClaimsInput = {
  filters: AdminClaimsFilters;
  pagination: AdminCursorPaginationInput;
};

type GetAdminClaimsResult = {
  data: AdminCursorPaginatedResult<AdminClaimRecord> | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class GetAdminClaimsService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async execute(input: GetAdminClaimsInput): Promise<GetAdminClaimsResult> {
    this.logger.info("GetAdminClaimsService.execute", {
      filters: input.filters,
      cursor: input.pagination.cursor,
      limit: input.pagination.limit,
    });

    const result = await this.repository.getAllClaims(input.filters, input.pagination);

    if (result.errorMessage) {
      this.logger.error("GetAdminClaimsService.execute.repositoryError", {
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "FETCH_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    return {
      data: result.data,
      errorCode: null,
      errorMessage: null,
    };
  }
}
