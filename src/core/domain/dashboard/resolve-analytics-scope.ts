import type {
  DashboardAnalyticsScope,
  DashboardAnalyticsViewerContext,
} from "@/core/domain/dashboard/contracts";

type AnalyticsScopeInput = Pick<
  DashboardAnalyticsViewerContext,
  "isAdmin" | "userRole" | "hodDepartmentIds" | "financeApproverIds"
>;

export function resolveDashboardAnalyticsScope(
  input: AnalyticsScopeInput,
): DashboardAnalyticsScope | null {
  if (input.isAdmin) {
    return "admin";
  }

  const normalizedRole = (input.userRole ?? "").trim().toLowerCase();
  const canAccessFinance = normalizedRole === "finance" || input.financeApproverIds.length > 0;

  if (canAccessFinance) {
    return "finance";
  }

  if (input.hodDepartmentIds.length > 0) {
    return "hod";
  }

  return null;
}
