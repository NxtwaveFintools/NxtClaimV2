import { GetMyClaimsPaginatedService } from "@/core/domain/claims/GetMyClaimsPaginatedService";
import { formatCurrency, formatDate } from "@/lib/format";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

type Repository = {
  getMyClaimsPaginated: jest.Mock;
};

function createRepository(overrides?: Partial<Repository>): Repository {
  return {
    getMyClaimsPaginated: jest.fn(async () => ({
      data: [
        {
          id: "claim-1",
          employeeId: "EMP-001",
          employeeName: "Alice",
          departmentName: "Operations",
          typeOfClaim: "Expense",
          totalAmount: 1234.5,
          status: "Submitted - Awaiting HOD approval",
          submittedAt: "2026-03-14T10:00:00.000Z",
          hodActionDate: "2026-03-15T10:00:00.000Z",
          financeActionDate: null,
          detailType: "expense",
          submissionType: "Self",
          onBehalfEmail: null,
          submitterEmail: "alice@nxtwave.co.in",
          hodEmail: "hod@nxtwave.co.in",
          financeEmail: null,
          submitterLabel: "Alice (alice@nxtwave.co.in)",
          categoryName: "Travel",
          purpose: "Team offsite",
          expenseReceiptFilePath: "receipts/claim-1.pdf",
          expenseBankStatementFilePath: null,
          advanceSupportingDocumentPath: null,
        },
      ],
      totalCount: 42,
      errorMessage: null,
    })),
    ...overrides,
  };
}

describe("GetMyClaimsPaginatedService", () => {
  test("maps repository rows into DTOs with formatted currency and dates", async () => {
    const repository = createRepository();
    const service = new GetMyClaimsPaginatedService({
      repository,
      logger: createLogger(),
    });

    const result = await service.execute({
      userId: "user-1",
      page: 1,
      limit: 20,
      filters: { detailType: "expense" },
    });

    expect(repository.getMyClaimsPaginated).toHaveBeenCalledWith("user-1", 1, 20, {
      detailType: "expense",
    });
    expect(result.errorMessage).toBeNull();
    expect(result.totalCount).toBe(42);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: "claim-1",
      detailType: "expense",
      formattedTotalAmount: formatCurrency(1234.5),
      formattedSubmittedAt: formatDate("2026-03-14T10:00:00.000Z"),
      formattedHodActionDate: formatDate("2026-03-15T10:00:00.000Z"),
      formattedFinanceActionDate: "N/A",
    });
  });

  test("returns empty state and logs when repository fails", async () => {
    const repository = createRepository({
      getMyClaimsPaginated: jest.fn(async () => ({
        data: [],
        totalCount: 0,
        errorMessage: "db down",
      })),
    });
    const logger = createLogger();
    const service = new GetMyClaimsPaginatedService({ repository, logger });

    const result = await service.execute({
      userId: "user-1",
      page: 2,
      limit: 10,
    });

    expect(result).toEqual({
      data: [],
      totalCount: 0,
      errorMessage: "db down",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.get_my_claims_paginated_failed",
      expect.objectContaining({
        userId: "user-1",
        page: 2,
        errorMessage: "db down",
      }),
    );
  });
});
