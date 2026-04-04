import type {
  DashboardDomainLogger,
  DashboardRepository,
  WalletSummaryTotals,
} from "@/core/domain/dashboard/contracts";

type GetWalletSummaryServiceDependencies = {
  repository: DashboardRepository;
  logger: DashboardDomainLogger;
};

const EMPTY_WALLET_TOTALS: WalletSummaryTotals = {
  totalPettyCashReceived: 0,
  totalPettyCashSpent: 0,
  totalReimbursements: 0,
  amountReceived: 0,
  amountSpent: 0,
  pettyCashBalance: 0,
};

class LedgerIntegrityError extends Error {
  constructor(metric: string, value: number) {
    super(`Ledger integrity failure: ${metric} cannot be negative (received ${value}).`);
    this.name = "LedgerIntegrityError";
  }
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertNonNegativeLedger(metric: string, value: number): void {
  if (value < 0) {
    throw new LedgerIntegrityError(metric, value);
  }
}

export class GetWalletSummaryService {
  private readonly repository: DashboardRepository;
  private readonly logger: DashboardDomainLogger;

  constructor(deps: GetWalletSummaryServiceDependencies) {
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  async execute(
    userId: string,
  ): Promise<{ data: WalletSummaryTotals | null; errorMessage: string | null }> {
    const result = await this.repository.getWalletTotals(userId);

    if (result.errorMessage || !result.data) {
      this.logger.error("dashboard.wallet_summary.failed", {
        userId,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorMessage: result.errorMessage ?? "Unable to compute wallet summary.",
      };
    }

    try {
      assertNonNegativeLedger("totalPettyCashReceived", result.data.totalPettyCashReceived);
      assertNonNegativeLedger("totalPettyCashSpent", result.data.totalPettyCashSpent);
      assertNonNegativeLedger("totalReimbursements", result.data.totalReimbursements);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Ledger integrity validation failed.";

      this.logger.error("dashboard.wallet_summary.integrity_failed", {
        userId,
        errorMessage,
      });

      return {
        data: null,
        errorMessage,
      };
    }

    const totalPettyCashReceived = roundCurrency(result.data.totalPettyCashReceived);
    const totalPettyCashSpent = roundCurrency(result.data.totalPettyCashSpent);
    const totalReimbursements = roundCurrency(result.data.totalReimbursements);
    const amountReceived = roundCurrency(totalPettyCashReceived + totalReimbursements);
    const amountSpent = totalPettyCashSpent;
    const pettyCashBalance = roundCurrency(result.data.pettyCashBalance);

    const summary: WalletSummaryTotals = {
      totalPettyCashReceived,
      totalPettyCashSpent,
      totalReimbursements,
      amountReceived,
      amountSpent,
      pettyCashBalance,
    };

    this.logger.info("dashboard.wallet_summary.success", {
      userId,
      amountReceived,
      amountSpent,
      pettyCashBalance,
    });

    return { data: summary, errorMessage: null };
  }

  static empty(): WalletSummaryTotals {
    return EMPTY_WALLET_TOTALS;
  }
}
