import {
  DB_CLAIM_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
} from "@/core/constants/statuses";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";

const mockGetServiceRoleSupabaseClient = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

type QueryResult<T> = {
  data: T;
  error: { message: string } | null;
};

type AwaitableBuilder<T> = {
  gte: jest.Mock;
  lte: jest.Mock;
  order: jest.Mock;
  in: jest.Mock;
  or: jest.Mock;
  eq: jest.Mock;
  then: (onfulfilled: (value: QueryResult<T>) => unknown) => Promise<unknown>;
};

type AnyQuery = {
  eq: jest.Mock;
  maybeSingle?: jest.Mock;
  or?: jest.Mock;
};

function createAwaitableBuilder<T>(result: QueryResult<T>): AwaitableBuilder<T> {
  const builder = {} as AwaitableBuilder<T>;

  builder.gte = jest.fn(() => builder);
  builder.lte = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.in = jest.fn(() => builder);
  builder.or = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.then = (onfulfilled: (value: QueryResult<T>) => unknown) =>
    Promise.resolve(onfulfilled(result));

  return builder;
}

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

  test("getAnalyticsAggregates applies scope and explicit advanced filters", async () => {
    const analyticsBuilder = createAwaitableBuilder({
      data: [
        {
          status: DB_CLAIM_STATUSES[1],
          claim_count: "1",
          total_amount: "1200.45",
          payment_mode_id: "pm-1",
          department_id: "dept-1",
          assigned_l2_approver_id: "fa-1",
          expense_category_id: "cat-1",
          product_id: "prod-1",
          hod_approval_hours_sum: "24",
          hod_approval_sample_count: "1",
          master_departments: { name: "Engineering" },
          master_payment_modes: { name: "Reimbursement" },
        },
      ],
      error: null,
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => analyticsBuilder),
      })),
    });

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
    expect(analyticsBuilder.or).toHaveBeenCalledTimes(1);
    expect(analyticsBuilder.or).toHaveBeenCalledWith(
      expect.stringContaining(DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS),
    );
    expect(analyticsBuilder.eq).toHaveBeenCalledWith("department_id", "dept-1");
    expect(analyticsBuilder.eq).toHaveBeenCalledWith("expense_category_id", "cat-1");
    expect(analyticsBuilder.eq).toHaveBeenCalledWith("product_id", "prod-1");
    expect(analyticsBuilder.eq).toHaveBeenCalledWith("assigned_l2_approver_id", "fa-1");
    expect(result.data).toEqual([
      {
        claimCount: 1,
        status: DB_CLAIM_STATUSES[1],
        totalAmount: 1200.45,
        paymentModeId: "pm-1",
        paymentModeName: "Reimbursement",
        departmentId: "dept-1",
        departmentName: "Engineering",
        hodApprovalHoursSum: 24,
        hodApprovalSampleCount: 1,
      },
    ]);
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
