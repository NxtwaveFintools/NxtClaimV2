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
    getWalletTotals: jest.fn(async () => ({
      data: {
        totalPettyCashReceived: 1000,
        totalPettyCashSpent: 800,
        totalReimbursements: 300,
        pettyCashBalance: 200,
      },
      errorMessage: null,
    })),
    getPendingReimbursementTotals: jest.fn(async () => ({
      data: {
        pendingReimbursementAmount: 450.75,
        pendingReimbursementCount: 3,
      },
      errorMessage: null,
    })),
    getAmountSpentClaimCount: jest.fn(async () => ({
      data: {
        amountSpentClaimCount: 2,
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
      totalPettyCashSpent: 800,
      totalReimbursements: 300,
      amountReceived: 1300,
      amountSpent: 800,
      pettyCashBalance: 200,
      amountSpentClaimCount: 2,
      pendingReimbursementAmount: 450.75,
      pendingReimbursementCount: 3,
    });
  });

  test("returns error when pending reimbursement lookup fails", async () => {
    const repository = createRepository({
      getPendingReimbursementTotals: jest.fn(async () => ({
        data: null,
        errorMessage: "pending lookup failed",
      })),
    });
    const logger = createLogger();
    const service = new GetWalletSummaryService({ repository, logger });

    const result = await service.execute("user-2");

    expect(result).toEqual({ data: null, errorMessage: "pending lookup failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "dashboard.wallet_summary.pending_failed",
      expect.objectContaining({ userId: "user-2", errorMessage: "pending lookup failed" }),
    );
  });

  test("returns error when amount spent claim count lookup fails", async () => {
    const repository = createRepository({
      getAmountSpentClaimCount: jest.fn(async () => ({
        data: null,
        errorMessage: "spent count failed",
      })),
    });
    const logger = createLogger();
    const service = new GetWalletSummaryService({ repository, logger });

    const result = await service.execute("user-6");

    expect(result).toEqual({ data: null, errorMessage: "spent count failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "dashboard.wallet_summary.spent_count_failed",
      expect.objectContaining({ userId: "user-6", errorMessage: "spent count failed" }),
    );
  });

  test("returns error when repository fails", async () => {
    const repository = createRepository({
      getWalletTotals: jest.fn(async () => ({ data: null, errorMessage: "db failed" })),
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
      getWalletTotals: jest.fn(async () => ({
        data: {
          totalPettyCashReceived: 0.01,
          totalPettyCashSpent: 0,
          totalReimbursements: 0,
          pettyCashBalance: 0.01,
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
      amountSpent: 0,
      pettyCashBalance: 0.01,
      amountSpentClaimCount: 2,
      pendingReimbursementAmount: 450.75,
      pendingReimbursementCount: 3,
    });
  });

  test("handles very large wallet totals without overflow", async () => {
    const repository = createRepository({
      getWalletTotals: jest.fn(async () => ({
        data: {
          totalPettyCashReceived: 10000000,
          totalPettyCashSpent: 9999999,
          totalReimbursements: 0.01,
          pettyCashBalance: 1,
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
      totalPettyCashSpent: 9999999,
      totalReimbursements: 0.01,
      amountReceived: 10000000.01,
      amountSpent: 9999999,
      pettyCashBalance: 1,
      amountSpentClaimCount: 2,
      pendingReimbursementAmount: 450.75,
      pendingReimbursementCount: 3,
    });
  });

  test("allows negative petty cash balance when spent exceeds received", async () => {
    const repository = createRepository({
      getWalletTotals: jest.fn(async () => ({
        data: {
          totalPettyCashReceived: 1000,
          totalPettyCashSpent: 1200,
          totalReimbursements: 300,
          pettyCashBalance: -200,
        },
        errorMessage: null,
      })),
    });
    const logger = createLogger();
    const service = new GetWalletSummaryService({ repository, logger });

    const result = await service.execute("user-5");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 1000,
      totalPettyCashSpent: 1200,
      totalReimbursements: 300,
      amountReceived: 1300,
      amountSpent: 1200,
      pettyCashBalance: -200,
      amountSpentClaimCount: 2,
      pendingReimbursementAmount: 450.75,
      pendingReimbursementCount: 3,
    });
  });
});
