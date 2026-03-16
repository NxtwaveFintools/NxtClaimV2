import { GetPendingApprovalsService } from "@/core/domain/claims/GetPendingApprovalsService";

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
});
