import type {
  DashboardAnalyticsScope,
  DashboardAnalyticsViewerContext,
} from "@/core/domain/dashboard/contracts";

type AnalyticsScopeInput = Pick<
  DashboardAnalyticsViewerContext,
  "isAdmin" | "hodDepartmentIds" | "financeApproverIds"
>;

export function resolveDashboardAnalyticsScope(
  input: AnalyticsScopeInput,
): DashboardAnalyticsScope | null {
  if (input.isAdmin) {
    return "admin";
  }

  if (input.financeApproverIds.length > 0) {
    return "finance";
  }

  if (input.hodDepartmentIds.length > 0) {
    return "hod";
  }

  return null;
}
