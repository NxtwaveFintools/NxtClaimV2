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

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
    const result = await this.repository.getClosedWalletBaseTotals(userId);

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

    const totalPettyCashReceived = roundCurrency(result.data.totalPettyCashReceived);
    const totalPettyCashSpent = roundCurrency(result.data.totalPettyCashSpent);
    const totalReimbursements = roundCurrency(result.data.totalReimbursements);
    const totalExpenseSubmitted = roundCurrency(result.data.totalExpenseSubmitted);

    const amountReceived = roundCurrency(totalPettyCashReceived + totalReimbursements);
    const amountSpent = totalExpenseSubmitted;
    const pettyCashBalance = roundCurrency(totalPettyCashReceived - totalPettyCashSpent);

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
