import { GetPendingApprovalsService } from "@/core/domain/claims/GetPendingApprovalsService";
import { formatCurrency, formatDate } from "@/lib/format";

type PendingApprovalsRepository = {
  getApprovalViewerContext: jest.Mock;
  getPendingApprovalsForL1: jest.Mock;
  getPendingApprovalsForFinance: jest.Mock;
};

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(
  overrides?: Partial<PendingApprovalsRepository>,
): PendingApprovalsRepository {
  return {
    getApprovalViewerContext: jest.fn(async () => ({
      data: { isHod: false, isFounder: true, isFinance: false },
      errorMessage: null,
    })),
    getPendingApprovalsForL1: jest.fn(async () => ({
      data: [
        {
          id: "claim-1",
          employeeId: "EMP-001",
          submitter: "EMP-001",
          departmentName: "Operations",
          totalAmount: 1200,
          status: "Submitted - Awaiting HOD approval",
          submittedAt: "2026-03-14T10:00:00.000Z",
        },
      ],
      nextCursor: null,
      hasNextPage: false,
      errorMessage: null,
    })),
    getPendingApprovalsForFinance: jest.fn(async () => ({
      data: [],
      nextCursor: null,
      hasNextPage: false,
      errorMessage: null,
    })),
    ...overrides,
  };
}

describe("GetPendingApprovalsService", () => {
  test("routes founder users through L1 pending approvals", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new GetPendingApprovalsService({ repository, logger });

    const viewerContext = await service.getViewerContext({ userId: "founder-1" });

    const result = await service.execute({
      userId: "founder-1",
      cursor: null,
      limit: 10,
    });

    expect(result.errorMessage).toBeNull();
    expect(viewerContext.activeScope).toBe("l1");
    expect(viewerContext.canViewApprovals).toBe(true);
    expect(repository.getPendingApprovalsForL1).toHaveBeenCalledWith(
      "founder-1",
      null,
      10,
      undefined,
    );
    expect(repository.getPendingApprovalsForFinance).not.toHaveBeenCalled();
  });

  test("gates finance view to L2 status only by using finance query", async () => {
    const repository = createRepository({
      getApprovalViewerContext: jest.fn(async () => ({
        data: { isHod: false, isFounder: false, isFinance: true },
        errorMessage: null,
      })),
      getPendingApprovalsForFinance: jest.fn(async () => ({
        data: [
          {
            id: "claim-fin-1",
            employeeId: "EMP-002",
            submitter: "EMP-002",
            departmentName: "Finance",
            totalAmount: 1500,
            status: "HOD approved - Awaiting finance approval",
            submittedAt: "2026-03-14T09:30:00.000Z",
          },
        ],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: null,
      })),
    });

    const logger = createLogger();
    const service = new GetPendingApprovalsService({ repository, logger });

    const viewerContext = await service.getViewerContext({ userId: "finance-1" });

    const result = await service.execute({
      userId: "finance-1",
      cursor: null,
      limit: 10,
    });

    expect(result.errorMessage).toBeNull();
    expect(viewerContext.activeScope).toBe("finance");
    expect(result.data[0]?.status).toBe("HOD approved - Awaiting finance approval");
    expect(repository.getPendingApprovalsForFinance).toHaveBeenCalledWith(
      "finance-1",
      null,
      10,
      undefined,
    );
    expect(repository.getPendingApprovalsForL1).not.toHaveBeenCalled();
  });

  test("applies formatted fields in response DTO", async () => {
    const repository = createRepository({
      getPendingApprovalsForL1: jest.fn(async () => ({
        data: [
          {
            id: "claim-typed-1",
            employeeId: "EMP-101",
            submitter: "Employee One",
            departmentName: "Operations",
            paymentModeName: "Reimbursement",
            detailType: "expense",
            submissionType: "Self",
            onBehalfEmail: null,
            purpose: "Business travel",
            categoryName: "Travel",
            evidenceFilePath: null,
            expenseReceiptFilePath: "expenses/receipt.pdf",
            expenseBankStatementFilePath: "expenses/bank.pdf",
            advanceSupportingDocumentPath: null,
            totalAmount: 999.5,
            status: "Submitted - Awaiting HOD approval",
            submittedAt: "2026-03-14T10:00:00.000Z",
            hodActionAt: null,
            financeActionAt: null,
          },
        ],
        nextCursor: "next-typed",
        hasNextPage: true,
        errorMessage: null,
      })),
    });
    const service = new GetPendingApprovalsService({ repository, logger: createLogger() });

    const result = await service.execute({
      userId: "founder-1",
      cursor: null,
      limit: 1,
    });

    expect(result.errorMessage).toBeNull();
    expect(result.nextCursor).toBe("next-typed");
    expect(result.hasNextPage).toBe(true);
    expect(result.data[0]).toMatchObject({
      detailType: "expense",
      formattedTotalAmount: formatCurrency(999.5),
      formattedSubmittedAt: formatDate("2026-03-14T10:00:00.000Z"),
      formattedHodActionDate: "N/A",
      formattedFinanceActionDate: "N/A",
      expenseBankStatementFilePath: "expenses/bank.pdf",
    });
  });

  test("returns empty response when user has no approver privileges", async () => {
    const repository = createRepository({
      getApprovalViewerContext: jest.fn(async () => ({
        data: { isHod: false, isFounder: false, isFinance: false },
        errorMessage: null,
      })),
    });

    const logger = createLogger();
    const service = new GetPendingApprovalsService({ repository, logger });

    const viewerContext = await service.getViewerContext({ userId: "employee-1" });

    const result = await service.execute({
      userId: "employee-1",
      cursor: null,
      limit: 10,
    });

    expect(result.errorMessage).toBeNull();
    expect(viewerContext.canViewApprovals).toBe(false);
    expect(viewerContext.activeScope).toBeNull();
    expect(result.data).toEqual([]);
    expect(repository.getPendingApprovalsForL1).not.toHaveBeenCalled();
    expect(repository.getPendingApprovalsForFinance).not.toHaveBeenCalled();
  });

  test("prioritizes finance scope for dual-role users", async () => {
    const repository = createRepository({
      getApprovalViewerContext: jest.fn(async () => ({
        data: { isHod: true, isFounder: false, isFinance: true },
        errorMessage: null,
      })),
    });
    const service = new GetPendingApprovalsService({ repository, logger: createLogger() });

    const viewerContext = await service.getViewerContext({ userId: "dual-role-user" });
    await service.execute({ userId: "dual-role-user", cursor: null, limit: 10 });

    expect(viewerContext).toEqual({
      canViewApprovals: true,
      activeScope: "finance",
      errorMessage: null,
    });
    expect(repository.getPendingApprovalsForFinance).toHaveBeenCalled();
    expect(repository.getPendingApprovalsForL1).not.toHaveBeenCalled();
  });

  test("returns viewer-context error and logs it", async () => {
    const repository = createRepository({
      getApprovalViewerContext: jest.fn(async () => ({
        data: { isHod: false, isFounder: false, isFinance: false },
        errorMessage: "viewer context failed",
      })),
    });
    const logger = createLogger();
    const service = new GetPendingApprovalsService({ repository, logger });

    const result = await service.execute({ userId: "user-1", cursor: null, limit: 10 });

    expect(result).toEqual({
      data: [],
      nextCursor: null,
      hasNextPage: false,
      totalCount: 0,
      errorMessage: "viewer context failed",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.get_pending_approvals.viewer_context_failed",
      expect.objectContaining({ userId: "user-1", errorMessage: "viewer context failed" }),
    );
  });

  test("returns fetch error for active scope and logs it", async () => {
    const repository = createRepository({
      getPendingApprovalsForL1: jest.fn(async () => ({
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: "fetch failed",
      })),
    });
    const logger = createLogger();
    const service = new GetPendingApprovalsService({ repository, logger });

    const result = await service.execute({
      userId: "founder-1",
      cursor: "cursor-1",
      limit: 10,
    });

    expect(result).toEqual({
      data: [],
      nextCursor: null,
      hasNextPage: false,
      totalCount: 0,
      errorMessage: "fetch failed",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.get_pending_approvals.fetch_failed",
      expect.objectContaining({
        userId: "founder-1",
        scope: "l1",
        cursor: "cursor-1",
        errorMessage: "fetch failed",
      }),
    );
  });
});
