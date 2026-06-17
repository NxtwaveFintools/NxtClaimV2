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
  isAdmin: boolean;
  approver1DepartmentIds: string[];
  approver2DepartmentIds: string[];
  financeApproverIds: string[];
};

export type DashboardAnalyticsAggregateRow = {
  status: DbClaimStatus;
  claimCount: number;
  totalAmount: number;
  paymentModeId: string | null;
  paymentModeName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  hodApprovalHoursSum: number;
  hodApprovalSampleCount: number;
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
  hodPendingAmount: number;
  hodPendingCount: number;
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
  hodPending: DashboardAnalyticsAmountTrendItem;
  rejected: DashboardAnalyticsAmountTrendItem;
};

export type DashboardAnalyticsEfficiencyItem = {
  departmentId: string;
  departmentName: string;
  sampleCount: number;
  averageHoursToApproval: number;
  averageDaysToApproval: number;
};

export type DashboardAnalyticsFinanceApproverTatItem = {
  financeApproverId: string;
  financeApproverName: string;
  sampleCount: number;
  averageHoursToApproval: number;
  averageDaysToApproval: number;
};

export type DashboardAnalyticsPayload = {
  claimCount: number;
  amounts: DashboardAnalyticsAmountSummary;
  statusBreakdown: DashboardAnalyticsStatusBreakdownItem[];
  paymentModeBreakdown: DashboardAnalyticsPaymentModeBreakdownItem[];
  efficiencyByDepartment: DashboardAnalyticsEfficiencyItem[];
  overallFinanceTatAverage: number;
  overallFinanceTatSampleCount: number;
  financeApproverTatBreakdown: DashboardAnalyticsFinanceApproverTatItem[];
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
  overallFinanceTatAverage: number | null;
  overallFinanceTatSampleCount: number;
  financeApproverTatBreakdown: DashboardAnalyticsFinanceApproverTatItem[];
  statusBreakdown: DashboardAnalyticsStatusBreakdownItem[];
  paymentModeBreakdown: DashboardAnalyticsPaymentModeBreakdownItem[];
  advancedFilters: DashboardAnalyticsAdvancedFilters;
  hodDepartmentIds: string[];
};

export type EmployeeClaimMasterRow = {
  employeeId: string;
  employeeName: string;
  totalAmount: number;
  claimCount: number;
  expenseAmount: number;
  advanceAmount: number;
};

export type EmployeeClaimCategoryBreakdownItem = {
  categoryName: string;
  amount: number;
  count: number;
};

export type EmployeeClaimDetailPayload = {
  totalAmount: number;
  expenseAmount: number;
  advanceAmount: number;
  largestClaimAmount: number;
  mostFrequentCategory: string | null;
  categoryBreakdown: EmployeeClaimCategoryBreakdownItem[];
};

export type EmployeeClaimQueryInput = {
  hodDepartmentIds: string[];
  dateFrom: string;
  dateTo: string;
  status?: string;
  departmentId?: string;
  expenseCategoryId?: string;
  limit?: number;
  offset?: number;
};

export type DashboardAnalyticsRepository = {
  getAnalyticsViewerContext(userId: string): Promise<{
    data: DashboardAnalyticsViewerContext | null;
    errorMessage: string | null;
  }>;
  getAnalyticsPayload(input: {
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
    data: DashboardAnalyticsPayload | null;
    errorMessage: string | null;
  }>;
  getAnalyticsAggregates(input: {
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
    data: DashboardAnalyticsAggregateRow[];
    errorMessage: string | null;
  }>;
  getAnalyticsFilterOptions(input: {
    isAdmin: boolean;
    isApprover1: boolean;
    approver1DepartmentIds: string[];
    isApprover2: boolean;
    isFinance: boolean;
    approver2DepartmentIds: string[];
  }): Promise<{
    data: DashboardAnalyticsAdvancedFilters | null;
    errorMessage: string | null;
  }>;
  getEmployeeClaimMaster(input: EmployeeClaimQueryInput & { employeeSearch?: string }): Promise<{
    data: EmployeeClaimMasterRow[];
    totalCount: number;
    errorMessage: string | null;
  }>;
  getEmployeeClaimDetail(input: EmployeeClaimQueryInput & { employeeId: string }): Promise<{
    data: EmployeeClaimDetailPayload | null;
    errorMessage: string | null;
  }>;
};
