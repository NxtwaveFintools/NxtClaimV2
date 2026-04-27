import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { GetAnalyticsService } from "@/core/domain/dashboard/GetAnalyticsService";
import type {
  DashboardAnalyticsPayload,
  DashboardAnalyticsRepository,
} from "@/core/domain/dashboard/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function buildPayload(overrides?: Partial<DashboardAnalyticsPayload>): DashboardAnalyticsPayload {
  return {
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
    ...overrides,
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
    getAnalyticsPayload: jest.fn(async () => ({
      data: buildPayload(),
      errorMessage: null,
    })),
    getAnalyticsAggregates: jest.fn(async () => ({
      data: [],
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
  test("uses DB payload and builds trends for explicit ranges", async () => {
    const repository = createRepository({
      getAnalyticsPayload: jest
        .fn()
        .mockResolvedValueOnce({
          data: buildPayload({
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
            overallFinanceTatAverage: 0.75,
            overallFinanceTatSampleCount: 2,
            financeApproverTatBreakdown: [
              {
                financeApproverId: "fa-1",
                financeApproverName: "Finance One",
                sampleCount: 2,
                averageHoursToApproval: 18,
                averageDaysToApproval: 0.75,
              },
            ],
            statusBreakdown: [
              {
                status: DB_CLAIM_STATUSES[0],
                count: 1,
                amount: 1000,
              },
            ],
            paymentModeBreakdown: [
              {
                paymentModeId: "pm-1",
                paymentModeName: "Reimbursement",
                count: 2,
                amount: 2500,
              },
            ],
          }),
          errorMessage: null,
        })
        .mockResolvedValueOnce({
          data: buildPayload({
            claimCount: 3,
            amounts: {
              totalAmount: 2000,
              approvedAmount: 1000,
              pendingAmount: 500,
              hodPendingAmount: 500,
              hodPendingCount: 1,
              rejectedAmount: 500,
            },
          }),
          errorMessage: null,
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
    expect(result.data?.overallFinanceTatAverage).toBe(0.75);
    expect(result.data?.overallFinanceTatSampleCount).toBe(2);
    expect(result.data?.financeApproverTatBreakdown).toEqual([
      {
        financeApproverId: "fa-1",
        financeApproverName: "Finance One",
        sampleCount: 2,
        averageHoursToApproval: 18,
        averageDaysToApproval: 0.75,
      },
    ]);
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

    expect(repository.getAnalyticsPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: "2026-03-01",
        dateTo: "2026-03-07",
        departmentId: "dept-1",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
        financeApproverId: "fa-1",
      }),
    );
    expect(repository.getAnalyticsPayload).toHaveBeenCalledWith(
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
      getAnalyticsPayload: jest
        .fn()
        .mockResolvedValueOnce({
          data: buildPayload({
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
          data: buildPayload({
            amounts: {
              totalAmount: 0,
              approvedAmount: 0,
              pendingAmount: 0,
              hodPendingAmount: 0,
              hodPendingCount: 0,
              rejectedAmount: 0,
            },
          }),
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

  test("allows finance viewers to use scope filters while restricting finance approver filter", async () => {
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
      getAnalyticsPayload: jest.fn(async () => ({ data: buildPayload(), errorMessage: null })),
    });

    const service = new GetAnalyticsService({ repository, logger: createLogger() });

    const result = await service.execute({
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
    expect(repository.getAnalyticsPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "finance",
        departmentId: "dept-1",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
        financeApproverId: undefined,
      }),
    );

    expect(result.data?.overallFinanceTatAverage).toBeNull();
    expect(result.data?.financeApproverTatBreakdown).toEqual([]);
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
