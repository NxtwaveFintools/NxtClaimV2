import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { GetAnalyticsService } from "@/core/domain/dashboard/GetAnalyticsService";
import type { DashboardAnalyticsRepository } from "@/core/domain/dashboard/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createAggregatePayload(overrides?: {
  claimCount?: number;
  amounts?: {
    totalAmount: number;
    approvedAmount: number;
    pendingAmount: number;
    hodPendingAmount: number;
    hodPendingCount: number;
    rejectedAmount: number;
  };
  efficiencyByDepartment?: Array<{
    departmentId: string;
    departmentName: string;
    sampleCount: number;
    averageHoursToApproval: number;
    averageDaysToApproval: number;
  }>;
}) {
  return {
    claimCount: overrides?.claimCount ?? 0,
    amounts: {
      totalAmount: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      hodPendingAmount: 0,
      hodPendingCount: 0,
      rejectedAmount: 0,
      ...(overrides?.amounts ?? {}),
    },
    statusBreakdown: DB_CLAIM_STATUSES.map((status) => ({ status, count: 0, amount: 0 })),
    paymentModeBreakdown: [],
    efficiencyByDepartment: overrides?.efficiencyByDepartment ?? [],
  };
}

function createRepository(
  overrides?: Partial<DashboardAnalyticsRepository>,
): DashboardAnalyticsRepository {
  return {
    getAnalyticsViewerContext: jest.fn(async () => ({
      data: {
        userId: "user-1",
        userRole: "employee",
        isAdmin: true,
        hodDepartmentIds: [],
        founderDepartmentIds: [],
        financeApproverIds: [],
      },
      errorMessage: null,
    })),
    getAnalyticsAggregates: jest.fn(async () => ({
      data: createAggregatePayload(),
      errorMessage: null,
    })),
    getAnalyticsFilterOptions: jest.fn(async () => ({
      data: {
        canUseScopeFilters: true,
        canUseFinanceApproverFilter: true,
        departments: [{ id: "dept-1", label: "Engineering" }],
        expenseCategories: [{ id: "cat-1", label: "Travel" }],
        products: [{ id: "prod-1", label: "SaaS" }],
        financeApprovers: [{ id: "fa-1", label: "Finance One" }],
      },
      errorMessage: null,
    })),
    ...overrides,
  };
}

describe("GetAnalyticsService", () => {
  test("aggregates totals, trends, and efficiency for explicit ranges", async () => {
    const repository = createRepository({
      getAnalyticsAggregates: jest.fn(async (input) => {
        if (input.dateFrom === "2026-03-01" && input.dateTo === "2026-03-07") {
          return {
            data: createAggregatePayload({
              claimCount: 3,
              amounts: {
                totalAmount: 3500,
                approvedAmount: 2000,
                pendingAmount: 1000,
                hodPendingAmount: 1000,
                hodPendingCount: 1,
                rejectedAmount: 500,
              },
              efficiencyByDepartment: [
                {
                  departmentId: "dept-1",
                  departmentName: "Engineering",
                  sampleCount: 2,
                  averageHoursToApproval: 36,
                  averageDaysToApproval: 1.5,
                },
              ],
            }),
            errorMessage: null,
          };
        }

        return {
          data: createAggregatePayload({
            claimCount: 3,
            amounts: {
              totalAmount: 2000,
              approvedAmount: 1000,
              pendingAmount: 500,
              hodPendingAmount: 500,
              hodPendingCount: 1,
              rejectedAmount: 500,
            },
            efficiencyByDepartment: [
              {
                departmentId: "dept-1",
                departmentName: "Engineering",
                sampleCount: 2,
                averageHoursToApproval: 24,
                averageDaysToApproval: 1,
              },
            ],
          }),
          errorMessage: null,
        };
      }),
    });

    const logger = createLogger();
    const service = new GetAnalyticsService({ repository, logger });

    const result = await service.execute({
      userId: "user-1",
      filter: {
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        departmentId: "dept-1",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
        financeApproverId: "fa-1",
      },
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data?.amounts).toEqual({
      totalAmount: 3500,
      approvedAmount: 2000,
      pendingAmount: 1000,
      hodPendingAmount: 1000,
      hodPendingCount: 1,
      rejectedAmount: 500,
    });
    expect(result.data?.trends).toEqual({
      total: {
        currentAmount: 3500,
        previousAmount: 2000,
        percentageChange: 75,
      },
      approved: {
        currentAmount: 2000,
        previousAmount: 1000,
        percentageChange: 100,
      },
      pending: {
        currentAmount: 1000,
        previousAmount: 500,
        percentageChange: 100,
      },
      hodPending: {
        currentAmount: 1000,
        previousAmount: 500,
        percentageChange: 100,
      },
      rejected: {
        currentAmount: 500,
        previousAmount: 500,
        percentageChange: 0,
      },
    });
    expect(result.data?.efficiencyByDepartment).toEqual([
      {
        departmentId: "dept-1",
        departmentName: "Engineering",
        sampleCount: 2,
        averageHoursToApproval: 36,
        averageDaysToApproval: 1.5,
      },
    ]);

    expect(repository.getAnalyticsAggregates).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: "2026-03-01",
        dateTo: "2026-03-07",
        departmentId: "dept-1",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
        financeApproverId: "fa-1",
      }),
    );
    expect(repository.getAnalyticsAggregates).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: "2026-02-22",
        dateTo: "2026-02-28",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
      }),
    );
  });

  test("returns null trend percentage when previous amount is zero", async () => {
    const repository = createRepository({
      getAnalyticsAggregates: jest
        .fn()
        .mockResolvedValueOnce({
          data: createAggregatePayload({
            claimCount: 1,
            amounts: {
              totalAmount: 750,
              approvedAmount: 750,
              pendingAmount: 0,
              hodPendingAmount: 0,
              hodPendingCount: 0,
              rejectedAmount: 0,
            },
          }),
          errorMessage: null,
        })
        .mockResolvedValueOnce({
          data: createAggregatePayload(),
          errorMessage: null,
        }),
    });

    const service = new GetAnalyticsService({ repository, logger: createLogger() });

    const result = await service.execute({
      userId: "user-1",
      filter: {
        startDate: "2026-03-01",
        endDate: "2026-03-03",
      },
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data?.trends?.total.percentageChange).toBeNull();
  });

  test("allows finance viewers to use department, category, and product filters while restricting finance approver filter", async () => {
    const repository = createRepository({
      getAnalyticsViewerContext: jest.fn(async () => ({
        data: {
          userId: "user-2",
          userRole: "finance",
          isAdmin: false,
          hodDepartmentIds: [],
          founderDepartmentIds: [],
          financeApproverIds: ["fa-1"],
        },
        errorMessage: null,
      })),
      getAnalyticsAggregates: jest.fn(async () => ({
        data: createAggregatePayload(),
        errorMessage: null,
      })),
    });

    const service = new GetAnalyticsService({ repository, logger: createLogger() });

    await service.execute({
      userId: "user-2",
      filter: {
        startDate: "2026-03-01",
        endDate: "2026-03-02",
        departmentId: "dept-1",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
        financeApproverId: "fa-2",
      },
    });

    expect(repository.getAnalyticsFilterOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        isFinance: true,
      }),
    );
    expect(repository.getAnalyticsAggregates).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "finance",
        departmentId: "dept-1",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
        financeApproverId: undefined,
      }),
    );
  });

  test("returns unauthorized for viewers with no analytics scope", async () => {
    const repository = createRepository({
      getAnalyticsViewerContext: jest.fn(async () => ({
        data: {
          userId: "user-3",
          userRole: "employee",
          isAdmin: false,
          hodDepartmentIds: [],
          founderDepartmentIds: [],
          financeApproverIds: [],
        },
        errorMessage: null,
      })),
    });

    const service = new GetAnalyticsService({ repository, logger: createLogger() });

    const result = await service.execute({ userId: "user-3", filter: {} });

    expect(result.data).toBeNull();
    expect(result.errorMessage).toBe("You are not authorized to access analytics.");
  });
});
