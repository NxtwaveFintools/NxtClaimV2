/** @jest-environment node */

export {};

const mockGetCachedCurrentUser = jest.fn();
const mockGetAnalyticsViewerContext = jest.fn();
const mockGetEmployeeClaimMaster = jest.fn();
const mockGetEmployeeClaimDetail = jest.fn();

jest.mock("@/modules/auth/server/get-current-user", () => ({
  getCachedCurrentUser: (...args: unknown[]) => mockGetCachedCurrentUser(...args),
}));

jest.mock("@/modules/dashboard/repositories/SupabaseDashboardRepository", () => ({
  SupabaseDashboardRepository: jest.fn().mockImplementation(() => ({
    getAnalyticsViewerContext: mockGetAnalyticsViewerContext,
    getEmployeeClaimMaster: mockGetEmployeeClaimMaster,
    getEmployeeClaimDetail: mockGetEmployeeClaimDetail,
  })),
}));

function viewerContext(overrides: {
  isAdmin: boolean;
  approver1DepartmentIds?: string[];
  financeApproverIds?: string[];
}) {
  return {
    data: {
      userId: "user-1",
      isAdmin: overrides.isAdmin,
      approver1DepartmentIds: overrides.approver1DepartmentIds ?? [],
      approver2DepartmentIds: [],
      financeApproverIds: overrides.financeApproverIds ?? [],
    },
    errorMessage: null,
  };
}

describe("employee drilldown actions RBAC scoping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedCurrentUser.mockResolvedValue({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });
    mockGetEmployeeClaimMaster.mockResolvedValue({ data: [], totalCount: 0, errorMessage: null });
    mockGetEmployeeClaimDetail.mockResolvedValue({ data: null, errorMessage: null });
  });

  test("admin who is also an HOD fetches across all departments (no scoping)", async () => {
    // The admin is approver1 of dept-1. Before the fix, the action forwarded
    // ["dept-1"] to the RPC, silently restricting an admin to their own HOD scope.
    mockGetAnalyticsViewerContext.mockResolvedValue(
      viewerContext({ isAdmin: true, approver1DepartmentIds: ["dept-1"] }),
    );

    const { fetchEmployeeClaimMaster } =
      await import("@/app/(dashboard)/dashboard/analytics/employee-drilldown/actions");

    await fetchEmployeeClaimMaster({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });

    expect(mockGetEmployeeClaimMaster).toHaveBeenCalledTimes(1);
    expect(mockGetEmployeeClaimMaster).toHaveBeenCalledWith(
      expect.objectContaining({ hodDepartmentIds: [] }),
    );
  });

  test("non-admin HOD remains restricted to their own departments", async () => {
    mockGetAnalyticsViewerContext.mockResolvedValue(
      viewerContext({ isAdmin: false, approver1DepartmentIds: ["dept-1"] }),
    );

    const { fetchEmployeeClaimMaster } =
      await import("@/app/(dashboard)/dashboard/analytics/employee-drilldown/actions");

    await fetchEmployeeClaimMaster({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });

    expect(mockGetEmployeeClaimMaster).toHaveBeenCalledWith(
      expect.objectContaining({ hodDepartmentIds: ["dept-1"] }),
    );
  });

  test("admin who is also an HOD bypasses scoping for employee detail too", async () => {
    mockGetAnalyticsViewerContext.mockResolvedValue(
      viewerContext({ isAdmin: true, approver1DepartmentIds: ["dept-1"] }),
    );

    const { fetchEmployeeClaimDetail } =
      await import("@/app/(dashboard)/dashboard/analytics/employee-drilldown/actions");

    await fetchEmployeeClaimDetail({
      employeeId: "emp-9",
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
    });

    expect(mockGetEmployeeClaimDetail).toHaveBeenCalledWith(
      expect.objectContaining({ hodDepartmentIds: [], employeeId: "emp-9" }),
    );
  });
});
