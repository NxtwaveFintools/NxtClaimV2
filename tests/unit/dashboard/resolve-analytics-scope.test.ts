import { resolveDashboardAnalyticsScope } from "@/core/domain/dashboard/resolve-analytics-scope";

describe("resolveDashboardAnalyticsScope", () => {
  test("returns admin when user is admin", () => {
    const scope = resolveDashboardAnalyticsScope({
      isAdmin: true,
      approver1DepartmentIds: ["dept-1"],
      financeApproverIds: [],
    });

    expect(scope).toBe("admin");
  });

  test("returns finance when finance approver assignment exists", () => {
    const scope = resolveDashboardAnalyticsScope({
      isAdmin: false,
      approver1DepartmentIds: [],
      financeApproverIds: ["fa-1"],
    });

    expect(scope).toBe("finance");
  });

  test("returns hod when user manages departments", () => {
    const scope = resolveDashboardAnalyticsScope({
      isAdmin: false,
      approver1DepartmentIds: ["dept-1"],
      financeApproverIds: [],
    });

    expect(scope).toBe("hod");
  });

  test("returns null when user has no analytics permissions", () => {
    const scope = resolveDashboardAnalyticsScope({
      isAdmin: false,
      approver1DepartmentIds: [],
      financeApproverIds: [],
    });

    expect(scope).toBeNull();
  });
});
