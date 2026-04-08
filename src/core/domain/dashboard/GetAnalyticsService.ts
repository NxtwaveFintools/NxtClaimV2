import {
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
  DB_REJECTED_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_CLAIM_STATUSES,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import { resolveDashboardAnalyticsScope } from "@/core/domain/dashboard/resolve-analytics-scope";
import type {
  DashboardAnalyticsAdvancedFilters,
  DashboardAnalyticsAmountSummary,
  DashboardAnalyticsAmountTrendItem,
  DashboardAnalyticsData,
  DashboardAnalyticsEfficiencyItem,
  DashboardAnalyticsFilter,
  DashboardAnalyticsPaymentModeBreakdownItem,
  DashboardAnalyticsRepository,
  DashboardAnalyticsStatusBreakdownItem,
  DashboardAnalyticsTrendSummary,
  DashboardDomainLogger,
} from "@/core/domain/dashboard/contracts";

type GetAnalyticsServiceDependencies = {
  repository: DashboardAnalyticsRepository;
  logger: DashboardDomainLogger;
};

type ResolvedPeriod = {
  month: string | null;
  dateFrom: string;
  dateTo: string;
  hasExplicitRange: boolean;
  previousPeriod: {
    dateFrom: string;
    dateTo: string;
  } | null;
};

type AggregatedAnalytics = {
  claimCount: number;
  amounts: DashboardAnalyticsAmountSummary;
  statusBreakdown: DashboardAnalyticsStatusBreakdownItem[];
  paymentModeBreakdown: DashboardAnalyticsPaymentModeBreakdownItem[];
  efficiencyByDepartment: DashboardAnalyticsEfficiencyItem[];
};

const DATE_FORMAT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_FORMAT_PATTERN = /^\d{4}-\d{2}$/;
const DAY_IN_MILLISECONDS = 86_400_000;

const PENDING_STATUSES = new Set<DbClaimStatus>([
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
]);
const APPROVED_STATUSES = new Set<DbClaimStatus>([
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
]);
const REJECTED_STATUSES = new Set<DbClaimStatus>(DB_REJECTED_STATUSES);

const EMPTY_AMOUNTS: DashboardAnalyticsAmountSummary = {
  totalAmount: 0,
  approvedAmount: 0,
  pendingAmount: 0,
  hodPendingAmount: 0,
  hodPendingCount: 0,
  rejectedAmount: 0,
};

function toDateAtStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return roundCurrency(value);
}

function resolvePeriod(filter?: DashboardAnalyticsFilter): ResolvedPeriod {
  const startDate = filter?.startDate ?? filter?.dateFrom;
  const endDate = filter?.endDate ?? filter?.dateTo;

  if (filter?.month && !startDate && !endDate) {
    if (!MONTH_FORMAT_PATTERN.test(filter.month)) {
      throw new Error("month must use YYYY-MM format.");
    }

    const [yearRaw, monthRaw] = filter.month.split("-");
    const year = Number.parseInt(yearRaw, 10);
    const monthIndex = Number.parseInt(monthRaw, 10) - 1;

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      throw new Error("month is invalid.");
    }

    const start = new Date(Date.UTC(year, monthIndex, 1));
    const end = new Date(Date.UTC(year, monthIndex + 1, 0));

    return {
      month: filter.month,
      dateFrom: toIsoDate(start),
      dateTo: toIsoDate(end),
      hasExplicitRange: false,
      previousPeriod: null,
    };
  }

  if (startDate || endDate) {
    if (!startDate || !endDate) {
      throw new Error("Both startDate and endDate are required when date range filtering is used.");
    }

    if (!DATE_FORMAT_PATTERN.test(startDate) || !DATE_FORMAT_PATTERN.test(endDate)) {
      throw new Error("startDate/endDate must use YYYY-MM-DD format.");
    }

    const start = toDateAtStart(startDate);
    const end = toDateAtStart(endDate);

    if (start.getTime() > end.getTime()) {
      throw new Error("startDate cannot be later than endDate.");
    }

    const dayCount = Math.floor((end.getTime() - start.getTime()) / DAY_IN_MILLISECONDS) + 1;
    const previousEnd = new Date(start.getTime());
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);

    const previousStart = new Date(previousEnd.getTime());
    previousStart.setUTCDate(previousStart.getUTCDate() - (dayCount - 1));

    return {
      month: null,
      dateFrom: startDate,
      dateTo: endDate,
      hasExplicitRange: true,
      previousPeriod: {
        dateFrom: toIsoDate(previousStart),
        dateTo: toIsoDate(previousEnd),
      },
    };
  }

  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 89);

  return {
    month: null,
    dateFrom: toIsoDate(start),
    dateTo: toIsoDate(end),
    hasExplicitRange: false,
    previousPeriod: null,
  };
}

function initializeStatusBreakdown(): DashboardAnalyticsStatusBreakdownItem[] {
  return DB_CLAIM_STATUSES.map((status) => ({
    status,
    count: 0,
    amount: 0,
  }));
}

function buildTrendItem(
  currentAmount: number,
  previousAmount: number,
): DashboardAnalyticsAmountTrendItem {
  if (previousAmount === 0) {
    return {
      currentAmount,
      previousAmount,
      percentageChange: null,
    };
  }

  const percentageChange = roundCurrency(((currentAmount - previousAmount) / previousAmount) * 100);

  return {
    currentAmount,
    previousAmount,
    percentageChange,
  };
}

function aggregateClaims(
  rows: Array<{
    status: DbClaimStatus;
    amount: number;
    paymentModeId: string | null;
    paymentModeName: string | null;
    departmentId: string | null;
    departmentName: string | null;
    submittedOn: string;
    hodActionDate: string | null;
  }>,
): AggregatedAnalytics {
  const statusBreakdown = initializeStatusBreakdown();
  const statusIndex = new Map<DbClaimStatus, number>(
    statusBreakdown.map((item, index) => [item.status, index]),
  );

  const paymentModeMap = new Map<string, DashboardAnalyticsPaymentModeBreakdownItem>();
  const efficiencyMap = new Map<
    string,
    {
      departmentName: string;
      totalHours: number;
      sampleCount: number;
    }
  >();

  let totalAmount = 0;
  let approvedAmount = 0;
  let pendingAmount = 0;
  let hodPendingAmount = 0;
  let hodPendingCount = 0;
  let rejectedAmount = 0;

  for (const claim of rows) {
    const normalizedAmount = normalizeAmount(claim.amount);
    totalAmount = roundCurrency(totalAmount + normalizedAmount);

    if (APPROVED_STATUSES.has(claim.status)) {
      approvedAmount = roundCurrency(approvedAmount + normalizedAmount);
    } else if (PENDING_STATUSES.has(claim.status)) {
      pendingAmount = roundCurrency(pendingAmount + normalizedAmount);
    } else if (REJECTED_STATUSES.has(claim.status)) {
      rejectedAmount = roundCurrency(rejectedAmount + normalizedAmount);
    }

    if (claim.status === DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS) {
      hodPendingAmount = roundCurrency(hodPendingAmount + normalizedAmount);
      hodPendingCount += 1;
    }

    const statusItemIndex = statusIndex.get(claim.status);
    if (statusItemIndex !== undefined) {
      const current = statusBreakdown[statusItemIndex];
      statusBreakdown[statusItemIndex] = {
        ...current,
        count: current.count + 1,
        amount: roundCurrency(current.amount + normalizedAmount),
      };
    }

    const paymentKey = claim.paymentModeId ?? "__unknown__";
    const currentPayment = paymentModeMap.get(paymentKey);

    if (currentPayment) {
      paymentModeMap.set(paymentKey, {
        ...currentPayment,
        count: currentPayment.count + 1,
        amount: roundCurrency(currentPayment.amount + normalizedAmount),
      });
    } else {
      paymentModeMap.set(paymentKey, {
        paymentModeId: claim.paymentModeId,
        paymentModeName: claim.paymentModeName ?? "Unknown",
        count: 1,
        amount: normalizedAmount,
      });
    }

    if (claim.departmentId && claim.hodActionDate) {
      const submittedAt = new Date(claim.submittedOn).getTime();
      const hodActionAt = new Date(claim.hodActionDate).getTime();

      if (
        Number.isFinite(submittedAt) &&
        Number.isFinite(hodActionAt) &&
        hodActionAt >= submittedAt
      ) {
        const durationHours = (hodActionAt - submittedAt) / (1000 * 60 * 60);
        const currentEfficiency = efficiencyMap.get(claim.departmentId);

        if (currentEfficiency) {
          currentEfficiency.totalHours += durationHours;
          currentEfficiency.sampleCount += 1;
        } else {
          efficiencyMap.set(claim.departmentId, {
            departmentName: claim.departmentName ?? "Unknown Department",
            totalHours: durationHours,
            sampleCount: 1,
          });
        }
      }
    }
  }

  const paymentModeBreakdown = Array.from(paymentModeMap.values()).sort((a, b) =>
    a.paymentModeName.localeCompare(b.paymentModeName),
  );

  const efficiencyByDepartment = Array.from(efficiencyMap.entries())
    .map(([departmentId, value]) => {
      const averageHoursToApproval = roundCurrency(value.totalHours / value.sampleCount);
      return {
        departmentId,
        departmentName: value.departmentName,
        sampleCount: value.sampleCount,
        averageHoursToApproval,
        averageDaysToApproval: roundCurrency(averageHoursToApproval / 24),
      };
    })
    .sort((a, b) => b.averageDaysToApproval - a.averageDaysToApproval);

  return {
    claimCount: rows.length,
    amounts: {
      totalAmount,
      approvedAmount,
      pendingAmount,
      hodPendingAmount,
      hodPendingCount,
      rejectedAmount,
    },
    statusBreakdown,
    paymentModeBreakdown,
    efficiencyByDepartment,
  };
}

function emptyAdvancedFilters(): DashboardAnalyticsAdvancedFilters {
  return {
    canUseScopeFilters: false,
    canUseFinanceApproverFilter: false,
    departments: [],
    expenseCategories: [],
    products: [],
    financeApprovers: [],
  };
}

export class GetAnalyticsService {
  private readonly repository: DashboardAnalyticsRepository;
  private readonly logger: DashboardDomainLogger;

  constructor(dependencies: GetAnalyticsServiceDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger;
  }

  async execute(input: {
    userId: string;
    filter?: DashboardAnalyticsFilter;
  }): Promise<{ data: DashboardAnalyticsData | null; errorMessage: string | null }> {
    let period: ResolvedPeriod;

    try {
      period = resolvePeriod(input.filter);
    } catch (error) {
      return {
        data: null,
        errorMessage: error instanceof Error ? error.message : "Invalid analytics filter.",
      };
    }

    const viewerContextResult = await this.repository.getAnalyticsViewerContext(input.userId);

    if (viewerContextResult.errorMessage || !viewerContextResult.data) {
      this.logger.error("dashboard.analytics.viewer_context.failed", {
        userId: input.userId,
        errorMessage: viewerContextResult.errorMessage,
      });

      return {
        data: null,
        errorMessage: viewerContextResult.errorMessage ?? "Unable to resolve viewer context.",
      };
    }

    const scope = resolveDashboardAnalyticsScope(viewerContextResult.data);

    if (!scope) {
      this.logger.warn("dashboard.analytics.viewer_context.unauthorized", {
        userId: input.userId,
      });

      return {
        data: null,
        errorMessage: "You are not authorized to access analytics.",
      };
    }

    const normalizedRole = (viewerContextResult.data.userRole ?? "").trim().toLowerCase();
    const isFounder =
      normalizedRole === "founder" || viewerContextResult.data.founderDepartmentIds.length > 0;
    const isFinance =
      normalizedRole === "finance" || viewerContextResult.data.financeApproverIds.length > 0;
    const canUseScopeFilters = viewerContextResult.data.isAdmin || isFounder || isFinance;
    const canUseFinanceApproverFilter = viewerContextResult.data.isAdmin || isFounder;

    let advancedFilters = emptyAdvancedFilters();

    if (canUseScopeFilters || canUseFinanceApproverFilter) {
      const optionsResult = await this.repository.getAnalyticsFilterOptions({
        isAdmin: viewerContextResult.data.isAdmin,
        isFounder,
        isFinance,
        founderDepartmentIds: viewerContextResult.data.founderDepartmentIds,
      });

      if (optionsResult.errorMessage || !optionsResult.data) {
        this.logger.error("dashboard.analytics.filter_options.failed", {
          userId: input.userId,
          scope,
          errorMessage: optionsResult.errorMessage,
        });

        return {
          data: null,
          errorMessage: optionsResult.errorMessage ?? "Unable to load analytics filter options.",
        };
      }

      advancedFilters = optionsResult.data;
    }

    const requestedDepartmentId = input.filter?.departmentId?.trim() || undefined;
    const requestedExpenseCategoryId = input.filter?.expenseCategoryId?.trim() || undefined;
    const requestedProductId = input.filter?.productId?.trim() || undefined;
    const requestedFinanceApproverId = input.filter?.financeApproverId?.trim() || undefined;

    let departmentId: string | undefined;
    let expenseCategoryId: string | undefined;
    let productId: string | undefined;
    let financeApproverId: string | undefined;

    if (canUseScopeFilters) {
      if (requestedDepartmentId) {
        const departmentAllowed = advancedFilters.departments.some(
          (department) => department.id === requestedDepartmentId,
        );
        if (!departmentAllowed) {
          return {
            data: null,
            errorMessage: "Selected department filter is not available for your account.",
          };
        }

        departmentId = requestedDepartmentId;
      }

      if (requestedExpenseCategoryId) {
        const expenseCategoryAllowed = advancedFilters.expenseCategories.some(
          (expenseCategory) => expenseCategory.id === requestedExpenseCategoryId,
        );

        if (!expenseCategoryAllowed) {
          return {
            data: null,
            errorMessage: "Selected expense category filter is not available for your account.",
          };
        }

        expenseCategoryId = requestedExpenseCategoryId;
      }

      if (requestedProductId) {
        const productAllowed = advancedFilters.products.some(
          (product) => product.id === requestedProductId,
        );

        if (!productAllowed) {
          return {
            data: null,
            errorMessage: "Selected product filter is not available for your account.",
          };
        }

        productId = requestedProductId;
      }
    } else if (requestedDepartmentId || requestedExpenseCategoryId || requestedProductId) {
      this.logger.warn("dashboard.analytics.scope_filter.ignored", {
        userId: input.userId,
        scope,
      });
    }

    if (canUseFinanceApproverFilter) {
      if (requestedFinanceApproverId) {
        const approverAllowed = advancedFilters.financeApprovers.some(
          (approver) => approver.id === requestedFinanceApproverId,
        );

        if (!approverAllowed) {
          return {
            data: null,
            errorMessage: "Selected finance approver filter is not available for your account.",
          };
        }

        financeApproverId = requestedFinanceApproverId;
      }
    } else if (requestedFinanceApproverId) {
      this.logger.warn("dashboard.analytics.finance_approver_filter.ignored", {
        userId: input.userId,
        scope,
      });
    }

    const claimsResult = await this.repository.getAnalyticsClaims({
      scope,
      hodDepartmentIds: viewerContextResult.data.hodDepartmentIds,
      financeApproverIds: viewerContextResult.data.financeApproverIds,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      departmentId,
      expenseCategoryId,
      productId,
      financeApproverId,
    });

    if (claimsResult.errorMessage) {
      this.logger.error("dashboard.analytics.claims.failed", {
        userId: input.userId,
        scope,
        errorMessage: claimsResult.errorMessage,
      });

      return {
        data: null,
        errorMessage: claimsResult.errorMessage,
      };
    }

    const currentPeriodAggregate = aggregateClaims(claimsResult.data);
    let trends: DashboardAnalyticsTrendSummary | null = null;

    if (period.hasExplicitRange && period.previousPeriod) {
      const previousPeriodClaimsResult = await this.repository.getAnalyticsClaims({
        scope,
        hodDepartmentIds: viewerContextResult.data.hodDepartmentIds,
        financeApproverIds: viewerContextResult.data.financeApproverIds,
        dateFrom: period.previousPeriod.dateFrom,
        dateTo: period.previousPeriod.dateTo,
        departmentId,
        expenseCategoryId,
        productId,
        financeApproverId,
      });

      if (previousPeriodClaimsResult.errorMessage) {
        this.logger.error("dashboard.analytics.claims.previous_period.failed", {
          userId: input.userId,
          scope,
          errorMessage: previousPeriodClaimsResult.errorMessage,
        });

        return {
          data: null,
          errorMessage: previousPeriodClaimsResult.errorMessage,
        };
      }

      const previousPeriodAggregate = aggregateClaims(previousPeriodClaimsResult.data);
      trends = {
        total: buildTrendItem(
          currentPeriodAggregate.amounts.totalAmount,
          previousPeriodAggregate.amounts.totalAmount,
        ),
        approved: buildTrendItem(
          currentPeriodAggregate.amounts.approvedAmount,
          previousPeriodAggregate.amounts.approvedAmount,
        ),
        pending: buildTrendItem(
          currentPeriodAggregate.amounts.pendingAmount,
          previousPeriodAggregate.amounts.pendingAmount,
        ),
        hodPending: buildTrendItem(
          currentPeriodAggregate.amounts.hodPendingAmount,
          previousPeriodAggregate.amounts.hodPendingAmount,
        ),
        rejected: buildTrendItem(
          currentPeriodAggregate.amounts.rejectedAmount,
          previousPeriodAggregate.amounts.rejectedAmount,
        ),
      };
    }

    this.logger.info("dashboard.analytics.success", {
      userId: input.userId,
      scope,
      claimCount: currentPeriodAggregate.claimCount,
      period,
    });

    return {
      data: {
        scope,
        period: {
          month: period.month,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
        },
        claimCount: currentPeriodAggregate.claimCount,
        amounts: currentPeriodAggregate.amounts,
        trends,
        efficiencyByDepartment: currentPeriodAggregate.efficiencyByDepartment,
        statusBreakdown: currentPeriodAggregate.statusBreakdown,
        paymentModeBreakdown: currentPeriodAggregate.paymentModeBreakdown,
        advancedFilters,
      },
      errorMessage: null,
    };
  }

  static empty(period?: {
    month: string | null;
    dateFrom: string;
    dateTo: string;
  }): DashboardAnalyticsData {
    return {
      scope: "admin",
      period: period ?? {
        month: null,
        dateFrom: toIsoDate(new Date()),
        dateTo: toIsoDate(new Date()),
      },
      claimCount: 0,
      amounts: EMPTY_AMOUNTS,
      trends: null,
      efficiencyByDepartment: [],
      statusBreakdown: initializeStatusBreakdown(),
      paymentModeBreakdown: [],
      advancedFilters: emptyAdvancedFilters(),
    };
  }
}
