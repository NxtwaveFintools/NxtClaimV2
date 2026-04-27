import {
  DB_CLAIM_STATUSES,
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_FINANCE_ANALYTICS_PIPELINE_STATUSES,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
  DB_REJECTED_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type {
  DashboardAnalyticsAdvancedFilters,
  DashboardAnalyticsAggregateRow,
  DashboardAnalyticsFinanceApproverTatItem,
  DashboardAnalyticsOption,
  DashboardAnalyticsPayload,
  DashboardAnalyticsRepository,
  DashboardAnalyticsScope,
  DashboardAnalyticsViewerContext,
  DashboardRepository,
} from "@/core/domain/dashboard/contracts";

type WalletTotalsRow = {
  total_reimbursements_received: number | string | null;
  total_petty_cash_received: number | string | null;
  total_petty_cash_spent: number | string | null;
  petty_cash_balance: number | string | null;
};

type UserRoleRow = {
  role: string | null;
};

type AdminMembershipRow = {
  id: string;
};

type DepartmentAssignmentRow = {
  id: string;
  hod_user_id: string | null;
  founder_user_id: string | null;
};

type DepartmentOptionRow = {
  id: string;
  name: string;
};

type ExpenseCategoryOptionRow = {
  id: string;
  name: string;
};

type ProductOptionRow = {
  id: string;
  name: string;
};

type FinanceApproverAssignmentRow = {
  id: string;
};

type FinanceApproverUserRow = {
  full_name: string | null;
  email: string | null;
};

type FinanceApproverOptionRow = {
  id: string;
  provisional_email: string | null;
  user: FinanceApproverUserRow | FinanceApproverUserRow[] | null;
};

type FinanceScopedApproverRow = {
  assigned_l2_approver_id: string | null;
};

type NamedRelationRow = {
  name: string;
};

type AnalyticsAggregateQueryRow = {
  status: DbClaimStatus;
  claim_count: number | string | null;
  total_amount: number | string | null;
  payment_mode_id: string | null;
  department_id: string | null;
  assigned_l2_approver_id: string | null;
  expense_category_id: string | null;
  product_id: string | null;
  hod_approval_hours_sum: number | string | null;
  hod_approval_sample_count: number | string | null;
  master_departments: NamedRelationRow | NamedRelationRow[] | null;
  master_payment_modes: NamedRelationRow | NamedRelationRow[] | null;
};

type LegacyAnalyticsClaimQueryRow = {
  status: DbClaimStatus;
  amount: number | string | null;
  payment_mode_id: string | null;
  type_of_claim: string | null;
  department_id: string | null;
  department_name: string | null;
  assigned_l2_approver_id: string | null;
  submitted_on: string;
  hod_action_date: string | null;
};

type AnalyticsStatusBreakdownJsonRow = {
  status: string;
  count: number | string | null;
  amount: number | string | null;
};

type AnalyticsPaymentBreakdownJsonRow = {
  paymentModeId: string | null;
  paymentModeName: string | null;
  count: number | string | null;
  amount: number | string | null;
};

type AnalyticsEfficiencyJsonRow = {
  departmentId: string;
  departmentName: string | null;
  sampleCount: number | string | null;
  averageHoursToApproval: number | string | null;
  averageDaysToApproval: number | string | null;
};

type AnalyticsFinanceTatJsonRow = {
  financeApproverId: string;
  financeApproverName: string | null;
  sampleCount: number | string | null;
  averageHoursToApproval: number | string | null;
  averageDaysToApproval: number | string | null;
};

type AnalyticsRpcPayload = {
  claimCount: number | string | null;
  amounts: {
    totalAmount: number | string | null;
    approvedAmount: number | string | null;
    pendingAmount: number | string | null;
    hodPendingAmount: number | string | null;
    hodPendingCount: number | string | null;
    rejectedAmount: number | string | null;
  } | null;
  statusBreakdown: AnalyticsStatusBreakdownJsonRow[] | null;
  paymentModeBreakdown: AnalyticsPaymentBreakdownJsonRow[] | null;
  efficiencyByDepartment: AnalyticsEfficiencyJsonRow[] | null;
  overallFinanceTatAverage: number | string | null;
  overallFinanceTatSampleCount: number | string | null;
  financeApproverTatBreakdown: AnalyticsFinanceTatJsonRow[] | null;
};

const EMPTY_WALLET_TOTALS = {
  totalPettyCashReceived: 0,
  totalPettyCashSpent: 0,
  totalReimbursements: 0,
  pettyCashBalance: 0,
};

const TRANSIENT_FETCH_ERROR_FRAGMENT = "fetch failed";
const MISSING_ANALYTICS_CACHE_TABLE_FRAGMENT = "claims_analytics_daily_stats";

const FINANCE_PIPELINE_STATUSES: DbClaimStatus[] = [...DB_FINANCE_ANALYTICS_PIPELINE_STATUSES];
const APPROVED_STATUSES: DbClaimStatus[] = [
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
];
const PENDING_STATUSES: DbClaimStatus[] = [
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
];

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toInteger(value: number | string | null | undefined): number {
  return Math.max(0, Math.trunc(toNumber(value)));
}

function isDbClaimStatus(value: string): value is DbClaimStatus {
  return DB_CLAIM_STATUSES.some((status) => status === value);
}

function normalizeAnalyticsPayload(payload: AnalyticsRpcPayload | null): DashboardAnalyticsPayload {
  const safePayload = payload ?? {
    claimCount: 0,
    amounts: {
      totalAmount: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      hodPendingAmount: 0,
      hodPendingCount: 0,
      rejectedAmount: 0,
    },
    statusBreakdown: [],
    paymentModeBreakdown: [],
    efficiencyByDepartment: [],
    overallFinanceTatAverage: 0,
    overallFinanceTatSampleCount: 0,
    financeApproverTatBreakdown: [],
  };

  const statusBreakdown = (safePayload.statusBreakdown ?? [])
    .filter(
      (row): row is AnalyticsStatusBreakdownJsonRow =>
        typeof row?.status === "string" && isDbClaimStatus(row.status),
    )
    .map((row) => ({
      status: row.status,
      count: toInteger(row.count),
      amount: toNumber(row.amount),
    }));

  const paymentModeBreakdown = (safePayload.paymentModeBreakdown ?? []).map((row) => ({
    paymentModeId: row.paymentModeId,
    paymentModeName: row.paymentModeName?.trim() || "Unknown",
    count: toInteger(row.count),
    amount: toNumber(row.amount),
  }));

  const efficiencyByDepartment = (safePayload.efficiencyByDepartment ?? [])
    .filter((row): row is AnalyticsEfficiencyJsonRow => typeof row?.departmentId === "string")
    .map((row) => ({
      departmentId: row.departmentId,
      departmentName: row.departmentName?.trim() || "Unknown Department",
      sampleCount: toInteger(row.sampleCount),
      averageHoursToApproval: toNumber(row.averageHoursToApproval),
      averageDaysToApproval: toNumber(row.averageDaysToApproval),
    }));

  const financeApproverTatBreakdown: DashboardAnalyticsFinanceApproverTatItem[] = (
    safePayload.financeApproverTatBreakdown ?? []
  )
    .filter(
      (row): row is AnalyticsFinanceTatJsonRow =>
        typeof row?.financeApproverId === "string" && row.financeApproverId.length > 0,
    )
    .map((row) => ({
      financeApproverId: row.financeApproverId,
      financeApproverName: row.financeApproverName?.trim() || row.financeApproverId,
      sampleCount: toInteger(row.sampleCount),
      averageHoursToApproval: toNumber(row.averageHoursToApproval),
      averageDaysToApproval: toNumber(row.averageDaysToApproval),
    }));

  return {
    claimCount: toInteger(safePayload.claimCount),
    amounts: {
      totalAmount: toNumber(safePayload.amounts?.totalAmount),
      approvedAmount: toNumber(safePayload.amounts?.approvedAmount),
      pendingAmount: toNumber(safePayload.amounts?.pendingAmount),
      hodPendingAmount: toNumber(safePayload.amounts?.hodPendingAmount),
      hodPendingCount: toInteger(safePayload.amounts?.hodPendingCount),
      rejectedAmount: toNumber(safePayload.amounts?.rejectedAmount),
    },
    statusBreakdown,
    paymentModeBreakdown,
    efficiencyByDepartment,
    overallFinanceTatAverage: toNumber(safePayload.overallFinanceTatAverage),
    overallFinanceTatSampleCount: toInteger(safePayload.overallFinanceTatSampleCount),
    financeApproverTatBreakdown,
  };
}

function isTransientFetchError(error: { message: string } | null): boolean {
  if (!error?.message) {
    return false;
  }

  return error.message.toLowerCase().includes(TRANSIENT_FETCH_ERROR_FRAGMENT);
}

function isMissingAnalyticsCacheTableError(error: { message: string } | null): boolean {
  if (!error?.message) {
    return false;
  }

  return error.message.toLowerCase().includes(MISSING_ANALYTICS_CACHE_TABLE_FRAGMENT);
}

function toPostgrestInList(values: string[]): string {
  return `(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`;
}

function normalizeRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function toOptionLabel(input: {
  fullName?: string | null;
  email?: string | null;
  fallback: string;
}): string {
  const fullName = input.fullName?.trim();
  const email = input.email?.trim();

  if (fullName && email) {
    return `${fullName} (${email})`;
  }

  if (fullName) {
    return fullName;
  }

  if (email) {
    return email;
  }

  return input.fallback;
}

async function runWithSingleRetry<T>(
  run: () => Promise<{ data: T; error: { message: string } | null }>,
): Promise<{
  data: T;
  error: { message: string } | null;
}> {
  const firstAttempt = await run();
  if (!isTransientFetchError(firstAttempt.error)) {
    return firstAttempt;
  }

  return run();
}

export class SupabaseDashboardRepository
  implements DashboardRepository, DashboardAnalyticsRepository
{
  private aggregateLegacyRows(
    rows: LegacyAnalyticsClaimQueryRow[],
  ): DashboardAnalyticsAggregateRow[] {
    const aggregated = new Map<string, DashboardAnalyticsAggregateRow>();

    for (const row of rows) {
      const key = `${row.status}|${row.payment_mode_id ?? "__null__"}|${row.department_id ?? "__null__"}`;
      const amount = toNumber(row.amount);

      let hodApprovalHoursSum = 0;
      let hodApprovalSampleCount = 0;
      if (row.hod_action_date) {
        const submittedAt = new Date(row.submitted_on).getTime();
        const hodActionAt = new Date(row.hod_action_date).getTime();

        if (
          Number.isFinite(submittedAt) &&
          Number.isFinite(hodActionAt) &&
          hodActionAt >= submittedAt
        ) {
          hodApprovalHoursSum = Number(((hodActionAt - submittedAt) / (1000 * 60 * 60)).toFixed(4));
          hodApprovalSampleCount = 1;
        }
      }

      const current = aggregated.get(key);
      if (current) {
        current.claimCount += 1;
        current.totalAmount = Number((current.totalAmount + amount).toFixed(2));
        current.hodApprovalHoursSum = Number(
          (current.hodApprovalHoursSum + hodApprovalHoursSum).toFixed(4),
        );
        current.hodApprovalSampleCount += hodApprovalSampleCount;
      } else {
        aggregated.set(key, {
          status: row.status,
          claimCount: 1,
          totalAmount: Number(amount.toFixed(2)),
          paymentModeId: row.payment_mode_id,
          paymentModeName: row.type_of_claim ?? "Unknown",
          departmentId: row.department_id,
          departmentName: row.department_name ?? "Unknown Department",
          hodApprovalHoursSum,
          hodApprovalSampleCount,
        });
      }
    }

    return Array.from(aggregated.values());
  }

  private async getAnalyticsAggregatesFromLegacyView(input: {
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
  }> {
    const client = getServiceRoleSupabaseClient();

    let query = client
      .from("vw_enterprise_claims_dashboard")
      .select(
        "status, amount, payment_mode_id, type_of_claim, department_id, department_name, assigned_l2_approver_id, expense_category_id, product_id, submitted_on, hod_action_date",
      )
      .gte("submitted_on", `${input.dateFrom}T00:00:00.000Z`)
      .lte("submitted_on", `${input.dateTo}T23:59:59.999Z`);

    if (input.scope === "hod") {
      query = query.in("department_id", input.hodDepartmentIds);
    }

    if (input.scope === "finance") {
      if (input.financeApproverIds.length > 0) {
        query = query.or(
          `status.in.${toPostgrestInList(FINANCE_PIPELINE_STATUSES)},assigned_l2_approver_id.in.${toPostgrestInList(input.financeApproverIds)}`,
        );
      } else {
        query = query.in("status", FINANCE_PIPELINE_STATUSES);
      }
    }

    if (input.departmentId) {
      query = query.eq("department_id", input.departmentId);
    }

    if (input.expenseCategoryId) {
      query = query.eq("expense_category_id", input.expenseCategoryId);
    }

    if (input.productId) {
      query = query.eq("product_id", input.productId);
    }

    if (input.financeApproverId) {
      query = query.eq("assigned_l2_approver_id", input.financeApproverId);
    }

    const { data, error } = await query;

    if (error) {
      return {
        data: [],
        errorMessage: error.message,
      };
    }

    return {
      data: this.aggregateLegacyRows((data ?? []) as LegacyAnalyticsClaimQueryRow[]),
      errorMessage: null,
    };
  }

  async getWalletTotals(userId: string): Promise<{
    data: {
      totalPettyCashReceived: number;
      totalPettyCashSpent: number;
      totalReimbursements: number;
      pettyCashBalance: number;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const { data, error } = await runWithSingleRetry<WalletTotalsRow | null>(async () =>
      client
        .from("wallets")
        .select(
          "total_reimbursements_received, total_petty_cash_received, total_petty_cash_spent, petty_cash_balance",
        )
        .eq("user_id", userId)
        .maybeSingle(),
    );

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: EMPTY_WALLET_TOTALS, errorMessage: null };
    }

    const row = data;

    return {
      data: {
        totalPettyCashReceived: toNumber(row.total_petty_cash_received),
        totalPettyCashSpent: toNumber(row.total_petty_cash_spent),
        totalReimbursements: toNumber(row.total_reimbursements_received),
        pettyCashBalance: toNumber(row.petty_cash_balance),
      },
      errorMessage: null,
    };
  }

  async getAnalyticsViewerContext(userId: string): Promise<{
    data: DashboardAnalyticsViewerContext | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const [userResult, adminResult, departmentsResult, financeResult] = await Promise.all([
      client.from("users").select("role").eq("id", userId).eq("is_active", true).maybeSingle(),
      client.from("admins").select("id").eq("user_id", userId),
      client
        .from("master_departments")
        .select("id, hod_user_id, founder_user_id")
        .eq("is_active", true)
        .or(`hod_user_id.eq.${userId},founder_user_id.eq.${userId}`),
      client
        .from("master_finance_approvers")
        .select("id")
        .eq("is_active", true)
        .eq("user_id", userId),
    ]);

    if (userResult.error) {
      return { data: null, errorMessage: userResult.error.message };
    }

    if (adminResult.error) {
      return { data: null, errorMessage: adminResult.error.message };
    }

    if (departmentsResult.error) {
      return { data: null, errorMessage: departmentsResult.error.message };
    }

    if (financeResult.error) {
      return { data: null, errorMessage: financeResult.error.message };
    }

    const userRoleRow = userResult.data as UserRoleRow | null;
    const adminRows = (adminResult.data ?? []) as AdminMembershipRow[];
    const departmentRows = (departmentsResult.data ?? []) as DepartmentAssignmentRow[];
    const financeRows = (financeResult.data ?? []) as FinanceApproverAssignmentRow[];
    const founderDepartmentIds = departmentRows
      .filter((row) => row.founder_user_id === userId)
      .map((row) => row.id);

    return {
      data: {
        userId,
        userRole: userRoleRow?.role ?? null,
        isAdmin: adminRows.length > 0,
        hodDepartmentIds: departmentRows.map((row) => row.id),
        founderDepartmentIds,
        financeApproverIds: financeRows.map((row) => row.id),
      },
      errorMessage: null,
    };
  }

  async getAnalyticsPayload(input: {
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
  }> {
    if (input.scope === "hod" && input.hodDepartmentIds.length === 0) {
      return {
        data: normalizeAnalyticsPayload(null),
        errorMessage: null,
      };
    }

    const client = getServiceRoleSupabaseClient();

    const { data, error } = await runWithSingleRetry<AnalyticsRpcPayload | null>(async () =>
      client.rpc("get_dashboard_analytics_payload", {
        p_scope: input.scope,
        p_hod_department_ids: input.hodDepartmentIds,
        p_finance_approver_ids: input.financeApproverIds,
        p_date_from: input.dateFrom,
        p_date_to: input.dateTo,
        p_department_id: input.departmentId ?? null,
        p_expense_category_id: input.expenseCategoryId ?? null,
        p_product_id: input.productId ?? null,
        p_finance_approver_id: input.financeApproverId ?? null,
        p_finance_pipeline_statuses: FINANCE_PIPELINE_STATUSES,
        p_approved_statuses: APPROVED_STATUSES,
        p_pending_statuses: PENDING_STATUSES,
        p_rejected_statuses: DB_REJECTED_STATUSES,
        p_hod_pending_status: DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
      }),
    );

    if (error) {
      return {
        data: null,
        errorMessage: error.message,
      };
    }

    return {
      data: normalizeAnalyticsPayload(data),
      errorMessage: null,
    };
  }

  async getAnalyticsAggregates(input: {
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
  }> {
    if (input.scope === "hod" && input.hodDepartmentIds.length === 0) {
      return {
        data: [],
        errorMessage: null,
      };
    }

    const client = getServiceRoleSupabaseClient();

    let query = client
      .from("claims_analytics_daily_stats")
      .select(
        "status, claim_count, total_amount, payment_mode_id, department_id, assigned_l2_approver_id, expense_category_id, product_id, hod_approval_hours_sum, hod_approval_sample_count, master_departments(name), master_payment_modes(name)",
      )
      .gte("date_key", input.dateFrom)
      .lte("date_key", input.dateTo);

    if (input.scope === "hod") {
      query = query.in("department_id", input.hodDepartmentIds);
    }

    if (input.scope === "finance") {
      if (input.financeApproverIds.length > 0) {
        query = query.or(
          `status.in.${toPostgrestInList(FINANCE_PIPELINE_STATUSES)},assigned_l2_approver_id.in.${toPostgrestInList(input.financeApproverIds)}`,
        );
      } else {
        query = query.in("status", FINANCE_PIPELINE_STATUSES);
      }
    }

    if (input.departmentId) {
      query = query.eq("department_id", input.departmentId);
    }

    if (input.expenseCategoryId) {
      query = query.eq("expense_category_id", input.expenseCategoryId);
    }

    if (input.productId) {
      query = query.eq("product_id", input.productId);
    }

    if (input.financeApproverId) {
      query = query.eq("assigned_l2_approver_id", input.financeApproverId);
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingAnalyticsCacheTableError(error)) {
        return this.getAnalyticsAggregatesFromLegacyView(input);
      }

      return {
        data: [],
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as AnalyticsAggregateQueryRow[];

    return {
      data: rows.map((row) => ({
        claimCount: Math.max(0, Math.trunc(toNumber(row.claim_count))),
        status: row.status,
        totalAmount: toNumber(row.total_amount),
        paymentModeId: row.payment_mode_id,
        paymentModeName: normalizeRelation(row.master_payment_modes)?.name ?? "Unknown",
        departmentId: row.department_id,
        departmentName: normalizeRelation(row.master_departments)?.name ?? "Unknown Department",
        hodApprovalHoursSum: toNumber(row.hod_approval_hours_sum),
        hodApprovalSampleCount: Math.max(0, Math.trunc(toNumber(row.hod_approval_sample_count))),
      })),
      errorMessage: null,
    };
  }

  async getAnalyticsFilterOptions(input: {
    isAdmin: boolean;
    isFounder: boolean;
    isFinance: boolean;
    founderDepartmentIds: string[];
  }): Promise<{
    data: DashboardAnalyticsAdvancedFilters | null;
    errorMessage: string | null;
  }> {
    if (!input.isAdmin && !input.isFounder && !input.isFinance) {
      return {
        data: {
          canUseScopeFilters: false,
          canUseFinanceApproverFilter: false,
          departments: [],
          expenseCategories: [],
          products: [],
          financeApprovers: [],
        },
        errorMessage: null,
      };
    }

    const client = getServiceRoleSupabaseClient();
    let departments: DashboardAnalyticsOption[] = [];
    let expenseCategories: DashboardAnalyticsOption[] = [];
    let products: DashboardAnalyticsOption[] = [];

    if (input.isAdmin || input.isFinance) {
      const [departmentsResult, expenseCategoriesResult, productsResult] = await Promise.all([
        client
          .from("master_departments")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        client
          .from("master_expense_categories")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        client
          .from("master_products")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);

      if (departmentsResult.error) {
        return { data: null, errorMessage: departmentsResult.error.message };
      }

      if (expenseCategoriesResult.error) {
        return { data: null, errorMessage: expenseCategoriesResult.error.message };
      }

      if (productsResult.error) {
        return { data: null, errorMessage: productsResult.error.message };
      }

      const departmentRows = (departmentsResult.data ?? []) as DepartmentOptionRow[];
      departments = departmentRows.map((row) => ({ id: row.id, label: row.name }));

      const expenseCategoryRows = (expenseCategoriesResult.data ??
        []) as ExpenseCategoryOptionRow[];
      expenseCategories = expenseCategoryRows.map((row) => ({ id: row.id, label: row.name }));

      const productRows = (productsResult.data ?? []) as ProductOptionRow[];
      products = productRows.map((row) => ({ id: row.id, label: row.name }));
    } else if (input.founderDepartmentIds.length > 0) {
      const [departmentsResult, expenseCategoriesResult, productsResult] = await Promise.all([
        client
          .from("master_departments")
          .select("id, name")
          .eq("is_active", true)
          .in("id", input.founderDepartmentIds)
          .order("name", { ascending: true }),
        client
          .from("master_expense_categories")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        client
          .from("master_products")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);

      if (departmentsResult.error) {
        return { data: null, errorMessage: departmentsResult.error.message };
      }

      if (expenseCategoriesResult.error) {
        return { data: null, errorMessage: expenseCategoriesResult.error.message };
      }

      if (productsResult.error) {
        return { data: null, errorMessage: productsResult.error.message };
      }

      const departmentRows = (departmentsResult.data ?? []) as DepartmentOptionRow[];
      departments = departmentRows.map((row) => ({ id: row.id, label: row.name }));

      const expenseCategoryRows = (expenseCategoriesResult.data ??
        []) as ExpenseCategoryOptionRow[];
      expenseCategories = expenseCategoryRows.map((row) => ({ id: row.id, label: row.name }));

      const productRows = (productsResult.data ?? []) as ProductOptionRow[];
      products = productRows.map((row) => ({ id: row.id, label: row.name }));
    }

    let financeApprovers: DashboardAnalyticsOption[] = [];

    if (input.isAdmin) {
      const { data, error } = await client
        .from("master_finance_approvers")
        .select(
          "id, provisional_email, user:users!master_finance_approvers_user_id_fkey(full_name, email)",
        )
        .eq("is_active", true)
        .order("is_primary", { ascending: false });

      if (error) {
        return { data: null, errorMessage: error.message };
      }

      const rows = (data ?? []) as FinanceApproverOptionRow[];
      financeApprovers = rows.map((row) => {
        const user = normalizeRelation(row.user);
        return {
          id: row.id,
          label: toOptionLabel({
            fullName: user?.full_name,
            email: user?.email ?? row.provisional_email,
            fallback: row.id,
          }),
        };
      });
    } else if (input.isFounder && departments.length > 0) {
      const departmentIds = departments.map((department) => department.id);
      const { data, error } = await client
        .from("claims_analytics_daily_stats")
        .select("assigned_l2_approver_id")
        .in("department_id", departmentIds)
        .not("assigned_l2_approver_id", "is", null);

      if (error) {
        if (!isMissingAnalyticsCacheTableError(error)) {
          return { data: null, errorMessage: error.message };
        }

        const legacyApproversResult = await client
          .from("vw_enterprise_claims_dashboard")
          .select("assigned_l2_approver_id, finance_email")
          .in("department_id", departmentIds)
          .not("assigned_l2_approver_id", "is", null);

        if (legacyApproversResult.error) {
          return { data: null, errorMessage: legacyApproversResult.error.message };
        }

        const legacyRows = (legacyApproversResult.data ?? []) as Array<{
          assigned_l2_approver_id: string | null;
          finance_email: string | null;
        }>;

        const byId = new Map<string, DashboardAnalyticsOption>();
        for (const row of legacyRows) {
          if (!row.assigned_l2_approver_id || byId.has(row.assigned_l2_approver_id)) {
            continue;
          }

          byId.set(row.assigned_l2_approver_id, {
            id: row.assigned_l2_approver_id,
            label: toOptionLabel({
              email: row.finance_email,
              fallback: row.assigned_l2_approver_id,
            }),
          });
        }

        financeApprovers = Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
        return {
          data: {
            canUseScopeFilters: true,
            canUseFinanceApproverFilter: input.isAdmin || input.isFounder,
            departments,
            expenseCategories,
            products,
            financeApprovers,
          },
          errorMessage: null,
        };
      }

      const rows = (data ?? []) as FinanceScopedApproverRow[];
      const scopedApproverIds = Array.from(
        new Set(
          rows
            .map((row) => row.assigned_l2_approver_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      );

      if (scopedApproverIds.length === 0) {
        financeApprovers = [];
      } else {
        const scopedApproversResult = await client
          .from("master_finance_approvers")
          .select(
            "id, provisional_email, user:users!master_finance_approvers_user_id_fkey(full_name, email)",
          )
          .eq("is_active", true)
          .in("id", scopedApproverIds);

        if (scopedApproversResult.error) {
          return { data: null, errorMessage: scopedApproversResult.error.message };
        }

        const scopedApproverRows = (scopedApproversResult.data ?? []) as FinanceApproverOptionRow[];
        financeApprovers = scopedApproverRows
          .map((row) => {
            const user = normalizeRelation(row.user);
            return {
              id: row.id,
              label: toOptionLabel({
                fullName: user?.full_name,
                email: user?.email ?? row.provisional_email,
                fallback: row.id,
              }),
            };
          })
          .sort((a, b) => a.label.localeCompare(b.label));
      }
    }

    return {
      data: {
        canUseScopeFilters: true,
        canUseFinanceApproverFilter: input.isAdmin || input.isFounder,
        departments,
        expenseCategories,
        products,
        financeApprovers,
      },
      errorMessage: null,
    };
  }
}
