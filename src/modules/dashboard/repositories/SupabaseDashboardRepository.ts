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
  DashboardAnalyticsAggregatePayload,
  DashboardAnalyticsAmountSummary,
  DashboardAnalyticsEfficiencyItem,
  DashboardAnalyticsOption,
  DashboardAnalyticsPaymentModeBreakdownItem,
  DashboardAnalyticsRepository,
  DashboardAnalyticsScope,
  DashboardAnalyticsStatusBreakdownItem,
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

const EMPTY_ANALYTICS_AMOUNTS: DashboardAnalyticsAmountSummary = {
  totalAmount: 0,
  approvedAmount: 0,
  pendingAmount: 0,
  hodPendingAmount: 0,
  hodPendingCount: 0,
  rejectedAmount: 0,
};

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toKnownClaimStatus(value: unknown): DbClaimStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  if (DB_CLAIM_STATUSES.includes(value as DbClaimStatus)) {
    return value as DbClaimStatus;
  }

  return null;
}

function createEmptyAnalyticsAggregatePayload(): DashboardAnalyticsAggregatePayload {
  return {
    claimCount: 0,
    amounts: EMPTY_ANALYTICS_AMOUNTS,
    statusBreakdown: DB_CLAIM_STATUSES.map((status) => ({
      status,
      count: 0,
      amount: 0,
    })),
    paymentModeBreakdown: [],
    efficiencyByDepartment: [],
  };
}

function parseAmountSummary(raw: unknown): DashboardAnalyticsAmountSummary {
  const record = asRecord(raw);
  if (!record) {
    return EMPTY_ANALYTICS_AMOUNTS;
  }

  return {
    totalAmount: toNumber(record.totalAmount),
    approvedAmount: toNumber(record.approvedAmount),
    pendingAmount: toNumber(record.pendingAmount),
    hodPendingAmount: toNumber(record.hodPendingAmount),
    hodPendingCount: Math.max(0, Math.trunc(toNumber(record.hodPendingCount))),
    rejectedAmount: toNumber(record.rejectedAmount),
  };
}

function parseStatusBreakdown(raw: unknown): DashboardAnalyticsStatusBreakdownItem[] {
  const statusByCode = new Map<DbClaimStatus, DashboardAnalyticsStatusBreakdownItem>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }

      const status = toKnownClaimStatus(record.status);
      if (!status) {
        continue;
      }

      statusByCode.set(status, {
        status,
        count: Math.max(0, Math.trunc(toNumber(record.count))),
        amount: toNumber(record.amount),
      });
    }
  }

  return DB_CLAIM_STATUSES.map(
    (status) =>
      statusByCode.get(status) ?? {
        status,
        count: 0,
        amount: 0,
      },
  );
}

function parsePaymentModeBreakdown(raw: unknown): DashboardAnalyticsPaymentModeBreakdownItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: DashboardAnalyticsPaymentModeBreakdownItem[] = [];

  for (const item of raw) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const paymentModeId = typeof record.paymentModeId === "string" ? record.paymentModeId : null;
    const paymentModeName =
      typeof record.paymentModeName === "string" && record.paymentModeName.trim().length > 0
        ? record.paymentModeName
        : "Unknown";

    rows.push({
      paymentModeId,
      paymentModeName,
      count: Math.max(0, Math.trunc(toNumber(record.count))),
      amount: toNumber(record.amount),
    });
  }

  return rows;
}

function parseEfficiencyByDepartment(raw: unknown): DashboardAnalyticsEfficiencyItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rows: DashboardAnalyticsEfficiencyItem[] = [];

  for (const item of raw) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    if (typeof record.departmentId !== "string" || record.departmentId.length === 0) {
      continue;
    }

    rows.push({
      departmentId: record.departmentId,
      departmentName:
        typeof record.departmentName === "string" && record.departmentName.trim().length > 0
          ? record.departmentName
          : "Unknown Department",
      sampleCount: Math.max(0, Math.trunc(toNumber(record.sampleCount))),
      averageHoursToApproval: toNumber(record.averageHoursToApproval),
      averageDaysToApproval: toNumber(record.averageDaysToApproval),
    });
  }

  return rows;
}

function parseAnalyticsAggregatePayload(raw: unknown): DashboardAnalyticsAggregatePayload {
  const record = asRecord(raw);
  if (!record) {
    return createEmptyAnalyticsAggregatePayload();
  }

  return {
    claimCount: Math.max(0, Math.trunc(toNumber(record.claimCount))),
    amounts: parseAmountSummary(record.amounts),
    statusBreakdown: parseStatusBreakdown(record.statusBreakdown),
    paymentModeBreakdown: parsePaymentModeBreakdown(record.paymentModeBreakdown),
    efficiencyByDepartment: parseEfficiencyByDepartment(record.efficiencyByDepartment),
  };
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
    data: DashboardAnalyticsAggregatePayload | null;
    errorMessage: string | null;
  }> {
    if (input.scope === "hod" && input.hodDepartmentIds.length === 0) {
      return {
        data: createEmptyAnalyticsAggregatePayload(),
        errorMessage: null,
      };
    }

    const client = getServiceRoleSupabaseClient();

    const { data, error } = await client.rpc("get_dashboard_analytics_payload", {
      p_scope: input.scope,
      p_hod_department_ids: input.hodDepartmentIds.length > 0 ? input.hodDepartmentIds : null,
      p_finance_approver_ids: input.financeApproverIds.length > 0 ? input.financeApproverIds : null,
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
    });

    if (error) {
      return {
        data: null,
        errorMessage: error.message,
      };
    }

    const payload = Array.isArray(data) ? data[0] : data;

    return {
      data: parseAnalyticsAggregatePayload(payload),
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
