"use server";

import { resolveDashboardAnalyticsScope } from "@/core/domain/dashboard/resolve-analytics-scope";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";

const repo = new SupabaseDashboardRepository();

type DrilldownFilterInput = {
  dateFrom: string;
  dateTo: string;
  status?: string | null;
  departmentId?: string | null;
  expenseCategoryId?: string | null;
  limit?: number;
  offset?: number;
};

async function resolveHodScope(): Promise<{
  hodDepartmentIds: string[];
  isAdmin: boolean;
  errorMessage: string | null;
}> {
  const userResult = await getCachedCurrentUser();
  if (!userResult.user?.id) {
    return { hodDepartmentIds: [], isAdmin: false, errorMessage: "Unauthorized" };
  }

  const ctxResult = await repo.getAnalyticsViewerContext(userResult.user.id);
  if (ctxResult.errorMessage || !ctxResult.data) {
    return {
      hodDepartmentIds: [],
      isAdmin: false,
      errorMessage: ctxResult.errorMessage ?? "Unable to verify permissions",
    };
  }

  const scope = resolveDashboardAnalyticsScope(ctxResult.data);
  if (!scope) {
    return { hodDepartmentIds: [], isAdmin: false, errorMessage: "Unauthorized" };
  }

  const isAdmin = ctxResult.data.isAdmin;
  const hodDepartmentIds = ctxResult.data.approver1DepartmentIds;

  if (!isAdmin && hodDepartmentIds.length === 0) {
    return { hodDepartmentIds: [], isAdmin: false, errorMessage: null };
  }

  return { hodDepartmentIds, isAdmin, errorMessage: null };
}

export async function fetchEmployeeClaimMaster(
  input: DrilldownFilterInput & { employeeSearch?: string | null },
) {
  const { hodDepartmentIds, isAdmin, errorMessage } = await resolveHodScope();

  if (errorMessage) {
    return { data: [], totalCount: 0, errorMessage };
  }

  if (!isAdmin && hodDepartmentIds.length === 0) {
    return { data: [], totalCount: 0, errorMessage: null };
  }

  return repo.getEmployeeClaimMaster({
    hodDepartmentIds,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    status: input.status ?? undefined,
    departmentId: input.departmentId ?? undefined,
    expenseCategoryId: input.expenseCategoryId ?? undefined,
    employeeSearch: input.employeeSearch ?? undefined,
    limit: input.limit,
    offset: input.offset,
  });
}

export async function fetchEmployeeClaimDetail(
  input: DrilldownFilterInput & { employeeId: string },
) {
  const { hodDepartmentIds, isAdmin, errorMessage } = await resolveHodScope();

  if (errorMessage) {
    return { data: null, errorMessage };
  }

  if (!isAdmin && hodDepartmentIds.length === 0) {
    return { data: null, errorMessage: null };
  }

  return repo.getEmployeeClaimDetail({
    hodDepartmentIds,
    employeeId: input.employeeId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    status: input.status ?? undefined,
    departmentId: input.departmentId ?? undefined,
    expenseCategoryId: input.expenseCategoryId ?? undefined,
  });
}
