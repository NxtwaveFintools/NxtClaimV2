import { GetWalletSummaryService } from "@/core/domain/dashboard/GetWalletSummaryService";
import type { DashboardRepository } from "@/core/domain/dashboard/contracts";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(overrides?: Partial<DashboardRepository>): DashboardRepository {
  return {
    getClosedWalletBaseTotals: jest.fn(async () => ({
      data: {
        totalPettyCashReceived: 1000,
        totalPettyCashSpent: 1200,
        totalReimbursements: 300,
        totalExpenseSubmitted: 1500,
      },
      errorMessage: null,
    })),
    ...overrides,
  };
}

describe("GetWalletSummaryService", () => {
  test("computes received, spent, and balance totals", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new GetWalletSummaryService({ repository, logger });

    const result = await service.execute("user-1");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 1000,
      totalPettyCashSpent: 1200,
      totalReimbursements: 300,
      amountReceived: 1300,
      amountSpent: 1500,
      pettyCashBalance: -200,
    });
  });

  test("returns error when repository fails", async () => {
    const repository = createRepository({
      getClosedWalletBaseTotals: jest.fn(async () => ({ data: null, errorMessage: "db failed" })),
    });
    const logger = createLogger();
    const service = new GetWalletSummaryService({ repository, logger });

    const result = await service.execute("user-2");

    expect(result).toEqual({ data: null, errorMessage: "db failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "dashboard.wallet_summary.failed",
      expect.objectContaining({ userId: "user-2", errorMessage: "db failed" }),
    );
  });

  test("preserves paise precision for very small amounts", async () => {
    const repository = createRepository({
      getClosedWalletBaseTotals: jest.fn(async () => ({
        data: {
          totalPettyCashReceived: 0.01,
          totalPettyCashSpent: 0,
          totalReimbursements: 0,
          totalExpenseSubmitted: 0.01,
        },
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new GetWalletSummaryService({ repository, logger });

    const result = await service.execute("user-3");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 0.01,
      totalPettyCashSpent: 0,
      totalReimbursements: 0,
      amountReceived: 0.01,
      amountSpent: 0.01,
      pettyCashBalance: 0.01,
    });
  });

  test("handles very large wallet totals without overflow", async () => {
    const repository = createRepository({
      getClosedWalletBaseTotals: jest.fn(async () => ({
        data: {
          totalPettyCashReceived: 10000000,
          totalPettyCashSpent: 10000001,
          totalReimbursements: 0.01,
          totalExpenseSubmitted: 10000002,
        },
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new GetWalletSummaryService({ repository, logger });

    const result = await service.execute("user-4");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 10000000,
      totalPettyCashSpent: 10000001,
      totalReimbursements: 0.01,
      amountReceived: 10000000.01,
      amountSpent: 10000002,
      pettyCashBalance: -1,
    });
  });
});
