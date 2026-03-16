import type {
  ClaimDomainLogger,
  ClaimRepository,
  GetMyClaimsFilters,
  MyClaimDTO,
} from "@/core/domain/claims/contracts";
import { mapDbClaimStatusToCanonical } from "@/core/constants/statuses";

type GetMyClaimsServiceDependencies = {
  repository: ClaimRepository;
  logger: ClaimDomainLogger;
};

export class GetMyClaimsService {
  private readonly repository: ClaimRepository;

  private readonly logger: ClaimDomainLogger;

  constructor(dependencies: GetMyClaimsServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  async execute(input: { userId: string; filters?: GetMyClaimsFilters }): Promise<{
    claims: MyClaimDTO[];
    errorMessage: string | null;
  }> {
    const result = await this.repository.getMyClaims(input.userId, input.filters);

    if (result.errorMessage) {
      this.logger.error("claims.get_my_claims_failed", {
        userId: input.userId,
        errorMessage: result.errorMessage,
      });
      return {
        claims: [],
        errorMessage: result.errorMessage,
      };
    }

    return {
      claims: result.data.map((row) => {
        const resolvedAmount = row.expenseTotalAmount ?? row.advanceRequestedAmount ?? 0;
        const employee = row.onBehalfEmail ?? row.employeeId;

        return {
          id: row.id,
          claimId: row.id,
          employee,
          department: row.departmentName ?? "Unknown Department",
          paymentMode: row.paymentModeName ?? "Unknown Payment Mode",
          submissionType: row.submissionType,
          totalAmount: resolvedAmount,
          status: mapDbClaimStatusToCanonical(row.status),
          submittedOn: row.submittedAt,
        };
      }),
      errorMessage: null,
    };
  }
}
