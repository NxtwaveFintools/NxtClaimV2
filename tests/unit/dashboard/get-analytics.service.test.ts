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
    getAnalyticsClaims: jest.fn(async () => ({
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
  test("aggregates totals, trends, and efficiency for explicit ranges", async () => {
    const repository = createRepository({
      getAnalyticsClaims: jest.fn(async (input) => {
        if (input.dateFrom === "2026-03-01" && input.dateTo === "2026-03-07") {
          return {
            data: [
              {
                claimId: "CLAIM-1",
                status: DB_CLAIM_STATUSES[0],
                amount: 1000,
                paymentModeId: "pm-1",
                paymentModeName: "Reimbursement",
                departmentId: "dept-1",
                departmentName: "Engineering",
                assignedL2ApproverId: null,
                submittedOn: "2026-03-01T00:00:00.000Z",
                hodActionDate: "2026-03-02T00:00:00.000Z",
              },
              {
                claimId: "CLAIM-2",
                status: DB_CLAIM_STATUSES[2],
                amount: 2000,
                paymentModeId: "pm-2",
                paymentModeName: "Petty Cash",
                departmentId: "dept-1",
                departmentName: "Engineering",
                assignedL2ApproverId: "fa-1",
                submittedOn: "2026-03-02T00:00:00.000Z",
                hodActionDate: "2026-03-04T00:00:00.000Z",
              },
              {
                claimId: "CLAIM-3",
                status: DB_CLAIM_STATUSES[4],
                amount: 500,
                paymentModeId: "pm-1",
                paymentModeName: "Reimbursement",
                departmentId: "dept-2",
                departmentName: "Operations",
                assignedL2ApproverId: "fa-1",
                submittedOn: "2026-03-03T00:00:00.000Z",
                hodActionDate: null,
              },
            ],
            errorMessage: null,
          };
        }

        return {
          data: [
            {
              claimId: "CLAIM-4",
              status: DB_CLAIM_STATUSES[0],
              amount: 500,
              paymentModeId: "pm-1",
              paymentModeName: "Reimbursement",
              departmentId: "dept-1",
              departmentName: "Engineering",
              assignedL2ApproverId: null,
              submittedOn: "2026-02-23T00:00:00.000Z",
              hodActionDate: "2026-02-24T00:00:00.000Z",
            },
            {
              claimId: "CLAIM-5",
              status: DB_CLAIM_STATUSES[2],
              amount: 1000,
              paymentModeId: "pm-2",
              paymentModeName: "Petty Cash",
              departmentId: "dept-1",
              departmentName: "Engineering",
              assignedL2ApproverId: "fa-1",
              submittedOn: "2026-02-24T00:00:00.000Z",
              hodActionDate: "2026-02-25T00:00:00.000Z",
            },
            {
              claimId: "CLAIM-6",
              status: DB_CLAIM_STATUSES[5],
              amount: 500,
              paymentModeId: "pm-1",
              paymentModeName: "Reimbursement",
              departmentId: "dept-2",
              departmentName: "Operations",
              assignedL2ApproverId: "fa-1",
              submittedOn: "2026-02-26T00:00:00.000Z",
              hodActionDate: null,
            },
          ],
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

    expect(repository.getAnalyticsClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: "2026-03-01",
        dateTo: "2026-03-07",
        departmentId: "dept-1",
        expenseCategoryId: "cat-1",
        productId: "prod-1",
        financeApproverId: "fa-1",
      }),
    );
    expect(repository.getAnalyticsClaims).toHaveBeenCalledWith(
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
      getAnalyticsClaims: jest
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              claimId: "CLAIM-1",
              status: DB_CLAIM_STATUSES[2],
              amount: 750,
              paymentModeId: "pm-1",
              paymentModeName: "Reimbursement",
              departmentId: "dept-1",
              departmentName: "Engineering",
              assignedL2ApproverId: "fa-1",
              submittedOn: "2026-03-01T00:00:00.000Z",
              hodActionDate: "2026-03-01T12:00:00.000Z",
            },
          ],
          errorMessage: null,
        })
        .mockResolvedValueOnce({
          data: [],
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
      getAnalyticsClaims: jest.fn(async () => ({ data: [], errorMessage: null })),
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
    expect(repository.getAnalyticsClaims).toHaveBeenCalledWith(
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
