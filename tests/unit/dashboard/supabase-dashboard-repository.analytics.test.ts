import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";

const mockGetServiceRoleSupabaseClient = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

type AnyQuery = {
  eq: jest.Mock;
  maybeSingle?: jest.Mock;
  or?: jest.Mock;
};

describe("SupabaseDashboardRepository analytics methods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("getAnalyticsViewerContext resolves admin and founder-assigned departments", async () => {
    const usersQuery = {} as AnyQuery;
    usersQuery.eq = jest.fn(() => usersQuery);
    usersQuery.maybeSingle = jest.fn(async () => ({
      data: { role: "founder" },
      error: null,
    }));

    const adminsQuery = {} as AnyQuery;
    adminsQuery.eq = jest.fn(async () => ({
      data: [{ id: "admin-1" }],
      error: null,
    }));

    const deptsQuery = {} as AnyQuery;
    deptsQuery.eq = jest.fn(() => deptsQuery);
    deptsQuery.or = jest.fn(async () => ({
      data: [
        { id: "dept-1", hod_user_id: "other-user", founder_user_id: "user-1" },
        { id: "dept-2", hod_user_id: "user-1", founder_user_id: "user-9" },
      ],
      error: null,
    }));

    const financeQuery = {} as AnyQuery;
    financeQuery.eq = jest
      .fn()
      .mockImplementationOnce(() => financeQuery)
      .mockImplementationOnce(async () => ({
        data: [{ id: "fa-1" }],
        error: null,
      }));

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "users") {
          return { select: jest.fn(() => usersQuery) };
        }

        if (table === "admins") {
          return { select: jest.fn(() => adminsQuery) };
        }

        if (table === "master_departments") {
          return { select: jest.fn(() => deptsQuery) };
        }

        if (table === "master_finance_approvers") {
          return { select: jest.fn(() => financeQuery) };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getAnalyticsViewerContext("user-1");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      userId: "user-1",
      userRole: "founder",
      isAdmin: true,
      hodDepartmentIds: ["dept-1", "dept-2"],
      founderDepartmentIds: ["dept-1"],
      financeApproverIds: ["fa-1"],
    });
  });

  test("getAnalyticsAggregates uses RPC payload and keeps status ordering complete", async () => {
    const rpc = jest.fn(async () => ({
      data: {
        claimCount: 1,
        amounts: {
          totalAmount: 1200.45,
          approvedAmount: 0,
          pendingAmount: 1200.45,
          hodPendingAmount: 1200.45,
          hodPendingCount: 1,
          rejectedAmount: 0,
        },
        statusBreakdown: [
          {
            status: DB_CLAIM_STATUSES[1],
            count: 1,
            amount: 1200.45,
          },
        ],
        paymentModeBreakdown: [
          {
            paymentModeId: "pm-1",
            paymentModeName: "Reimbursement",
            count: 1,
            amount: 1200.45,
          },
        ],
        efficiencyByDepartment: [
          {
            departmentId: "dept-1",
            departmentName: "Engineering",
            sampleCount: 1,
            averageHoursToApproval: 24,
            averageDaysToApproval: 1,
          },
        ],
      },
      error: null,
    }));

    mockGetServiceRoleSupabaseClient.mockReturnValue({ rpc });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getAnalyticsAggregates({
      scope: "finance",
      hodDepartmentIds: [],
      financeApproverIds: ["fa-1"],
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      departmentId: "dept-1",
      expenseCategoryId: "cat-1",
      productId: "prod-1",
      financeApproverId: "fa-1",
    });

    expect(result.errorMessage).toBeNull();
    expect(rpc).toHaveBeenCalledWith(
      "get_dashboard_analytics_payload",
      expect.objectContaining({
        p_scope: "finance",
        p_date_from: "2026-03-01",
        p_date_to: "2026-03-31",
        p_department_id: "dept-1",
        p_expense_category_id: "cat-1",
        p_product_id: "prod-1",
        p_finance_approver_id: "fa-1",
        p_finance_approver_ids: ["fa-1"],
      }),
    );

    expect(result.data?.claimCount).toBe(1);
    expect(result.data?.amounts.totalAmount).toBe(1200.45);
    expect(result.data?.paymentModeBreakdown).toEqual([
      {
        paymentModeId: "pm-1",
        paymentModeName: "Reimbursement",
        count: 1,
        amount: 1200.45,
      },
    ]);
    expect(result.data?.efficiencyByDepartment).toEqual([
      {
        departmentId: "dept-1",
        departmentName: "Engineering",
        sampleCount: 1,
        averageHoursToApproval: 24,
        averageDaysToApproval: 1,
      },
    ]);

    expect(result.data?.statusBreakdown).toEqual(
      DB_CLAIM_STATUSES.map((status) =>
        status === DB_CLAIM_STATUSES[1]
          ? { status, count: 1, amount: 1200.45 }
          : { status, count: 0, amount: 0 },
      ),
    );
  });

  test("getAnalyticsFilterOptions returns disabled response for viewers without scope filter permissions", async () => {
    const repository = new SupabaseDashboardRepository();

    const result = await repository.getAnalyticsFilterOptions({
      isAdmin: false,
      isFounder: false,
      isFinance: false,
      founderDepartmentIds: [],
    });

    expect(result).toEqual({
      data: {
        canUseScopeFilters: false,
        canUseFinanceApproverFilter: false,
        departments: [],
        expenseCategories: [],
        products: [],
        financeApprovers: [],
      },
      errorMessage: null,
    });
  });

  test("getAnalyticsFilterOptions scopes founder filters to assigned departments", async () => {
    const departmentsQuery = {} as {
      eq: jest.Mock;
      in: jest.Mock;
      order: jest.Mock;
    };
    departmentsQuery.eq = jest.fn(() => departmentsQuery);
    departmentsQuery.in = jest.fn(() => departmentsQuery);
    departmentsQuery.order = jest.fn(async () => ({
      data: [{ id: "dept-1", name: "Engineering" }],
      error: null,
    }));

    const expenseCategoriesQuery = {} as {
      eq: jest.Mock;
      order: jest.Mock;
    };
    expenseCategoriesQuery.eq = jest.fn(() => expenseCategoriesQuery);
    expenseCategoriesQuery.order = jest.fn(async () => ({
      data: [{ id: "cat-1", name: "Travel" }],
      error: null,
    }));

    const productsQuery = {} as {
      eq: jest.Mock;
      order: jest.Mock;
    };
    productsQuery.eq = jest.fn(() => productsQuery);
    productsQuery.order = jest.fn(async () => ({
      data: [{ id: "prod-1", name: "SaaS" }],
      error: null,
    }));

    const scopedApproversQuery = {} as {
      in: jest.Mock;
      not: jest.Mock;
    };
    scopedApproversQuery.in = jest.fn(() => scopedApproversQuery);
    scopedApproversQuery.not = jest.fn(async () => ({
      data: [{ assigned_l2_approver_id: "fa-1" }, { assigned_l2_approver_id: "fa-1" }],
      error: null,
    }));

    const scopedApproverLookupQuery = {} as {
      eq: jest.Mock;
      in: jest.Mock;
    };
    scopedApproverLookupQuery.eq = jest.fn(() => scopedApproverLookupQuery);
    scopedApproverLookupQuery.in = jest.fn(async () => ({
      data: [
        {
          id: "fa-1",
          provisional_email: null,
          user: { full_name: null, email: "finance.one@example.com" },
        },
      ],
      error: null,
    }));

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "master_departments") {
          return { select: jest.fn(() => departmentsQuery) };
        }

        if (table === "master_expense_categories") {
          return { select: jest.fn(() => expenseCategoriesQuery) };
        }

        if (table === "master_products") {
          return { select: jest.fn(() => productsQuery) };
        }

        if (table === "claims_analytics_daily_stats") {
          return { select: jest.fn(() => scopedApproversQuery) };
        }

        if (table === "master_finance_approvers") {
          return { select: jest.fn(() => scopedApproverLookupQuery) };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getAnalyticsFilterOptions({
      isAdmin: false,
      isFounder: true,
      isFinance: false,
      founderDepartmentIds: ["dept-1"],
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      canUseScopeFilters: true,
      canUseFinanceApproverFilter: true,
      departments: [{ id: "dept-1", label: "Engineering" }],
      expenseCategories: [{ id: "cat-1", label: "Travel" }],
      products: [{ id: "prod-1", label: "SaaS" }],
      financeApprovers: [{ id: "fa-1", label: "finance.one@example.com" }],
    });
  });

  test("getAnalyticsFilterOptions gives finance users scope filters without finance approver options", async () => {
    const departmentsQuery = {} as {
      eq: jest.Mock;
      order: jest.Mock;
    };
    departmentsQuery.eq = jest.fn(() => departmentsQuery);
    departmentsQuery.order = jest.fn(async () => ({
      data: [{ id: "dept-1", name: "Engineering" }],
      error: null,
    }));

    const expenseCategoriesQuery = {} as {
      eq: jest.Mock;
      order: jest.Mock;
    };
    expenseCategoriesQuery.eq = jest.fn(() => expenseCategoriesQuery);
    expenseCategoriesQuery.order = jest.fn(async () => ({
      data: [{ id: "cat-1", name: "Travel" }],
      error: null,
    }));

    const productsQuery = {} as {
      eq: jest.Mock;
      order: jest.Mock;
    };
    productsQuery.eq = jest.fn(() => productsQuery);
    productsQuery.order = jest.fn(async () => ({
      data: [{ id: "prod-1", name: "SaaS" }],
      error: null,
    }));

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "master_departments") {
          return { select: jest.fn(() => departmentsQuery) };
        }

        if (table === "master_expense_categories") {
          return { select: jest.fn(() => expenseCategoriesQuery) };
        }

        if (table === "master_products") {
          return { select: jest.fn(() => productsQuery) };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getAnalyticsFilterOptions({
      isAdmin: false,
      isFounder: false,
      isFinance: true,
      founderDepartmentIds: [],
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      canUseScopeFilters: true,
      canUseFinanceApproverFilter: false,
      departments: [{ id: "dept-1", label: "Engineering" }],
      expenseCategories: [{ id: "cat-1", label: "Travel" }],
      products: [{ id: "prod-1", label: "SaaS" }],
      financeApprovers: [],
    });
  });
});
