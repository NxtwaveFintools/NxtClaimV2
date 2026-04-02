import type { DbClaimStatus } from "@/core/constants/statuses";

export type WalletSummaryTotals = {
  totalPettyCashReceived: number;
  totalPettyCashSpent: number;
  totalReimbursements: number;
  amountReceived: number;
  amountSpent: number;
  pettyCashBalance: number;
};

export type DashboardRepository = {
  getWalletTotals(userId: string): Promise<{
    data: {
      totalPettyCashReceived: number;
      totalPettyCashSpent: number;
      totalReimbursements: number;
      pettyCashBalance: number;
    } | null;
    errorMessage: string | null;
  }>;
};

export type DashboardDomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
};

export type DashboardAnalyticsFilter = {
  month?: string;
  dateFrom?: string;
  dateTo?: string;
  startDate?: string;
  endDate?: string;
  departmentId?: string;
  expenseCategoryId?: string;
  productId?: string;
  financeApproverId?: string;
};

export type DashboardAnalyticsScope = "admin" | "hod" | "finance";

export type DashboardAnalyticsViewerContext = {
  userId: string;
  userRole: string | null;
  isAdmin: boolean;
  hodDepartmentIds: string[];
  founderDepartmentIds: string[];
  financeApproverIds: string[];
};

export type DashboardAnalyticsClaimRow = {
  claimId: string;
  status: DbClaimStatus;
  amount: number;
  paymentModeId: string | null;
  paymentModeName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  assignedL2ApproverId: string | null;
  submittedOn: string;
  hodActionDate: string | null;
};

export type DashboardAnalyticsOption = {
  id: string;
  label: string;
};

export type DashboardAnalyticsAdvancedFilters = {
  canUseScopeFilters: boolean;
  canUseFinanceApproverFilter: boolean;
  departments: DashboardAnalyticsOption[];
  expenseCategories: DashboardAnalyticsOption[];
  products: DashboardAnalyticsOption[];
  financeApprovers: DashboardAnalyticsOption[];
};

export type DashboardAnalyticsAmountSummary = {
  totalAmount: number;
  approvedAmount: number;
  pendingAmount: number;
  rejectedAmount: number;
};

export type DashboardAnalyticsStatusBreakdownItem = {
  status: DbClaimStatus;
  count: number;
  amount: number;
};

export type DashboardAnalyticsPaymentModeBreakdownItem = {
  paymentModeId: string | null;
  paymentModeName: string;
  count: number;
  amount: number;
};

export type DashboardAnalyticsAmountTrendItem = {
  currentAmount: number;
  previousAmount: number;
  percentageChange: number | null;
};

export type DashboardAnalyticsTrendSummary = {
  total: DashboardAnalyticsAmountTrendItem;
  approved: DashboardAnalyticsAmountTrendItem;
  pending: DashboardAnalyticsAmountTrendItem;
  rejected: DashboardAnalyticsAmountTrendItem;
};

export type DashboardAnalyticsEfficiencyItem = {
  departmentId: string;
  departmentName: string;
  sampleCount: number;
  averageHoursToApproval: number;
  averageDaysToApproval: number;
};

export type DashboardAnalyticsData = {
  scope: DashboardAnalyticsScope;
  period: {
    month: string | null;
    dateFrom: string;
    dateTo: string;
  };
  claimCount: number;
  amounts: DashboardAnalyticsAmountSummary;
  trends: DashboardAnalyticsTrendSummary | null;
  efficiencyByDepartment: DashboardAnalyticsEfficiencyItem[];
  statusBreakdown: DashboardAnalyticsStatusBreakdownItem[];
  paymentModeBreakdown: DashboardAnalyticsPaymentModeBreakdownItem[];
  advancedFilters: DashboardAnalyticsAdvancedFilters;
};

export type DashboardAnalyticsRepository = {
  getAnalyticsViewerContext(userId: string): Promise<{
    data: DashboardAnalyticsViewerContext | null;
    errorMessage: string | null;
  }>;
  getAnalyticsClaims(input: {
    scope: DashboardAnalyticsScope;
    hodDepartmentIds: string[];
    financeApproverIds: string[];
    dateFrom: string;
    dateTo: string;
    departmentId?: string;
    expenseCategoryId?: string;
    productId?: string;
    financeApproverId?: string;
  }): Promise<{
    data: DashboardAnalyticsClaimRow[];
    errorMessage: string | null;
  }>;
  getAnalyticsFilterOptions(input: {
    isAdmin: boolean;
    isFounder: boolean;
    isFinance: boolean;
    founderDepartmentIds: string[];
  }): Promise<{
    data: DashboardAnalyticsAdvancedFilters | null;
    errorMessage: string | null;
  }>;
};
