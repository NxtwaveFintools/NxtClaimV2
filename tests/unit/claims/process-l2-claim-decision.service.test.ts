import { ProcessL2ClaimDecisionService } from "@/core/domain/claims/ProcessL2ClaimDecisionService";
import type { DbClaimStatus } from "@/core/constants/statuses";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(
  overrides?: Partial<{
    getClaimForL2Decision: jest.Mock;
    getFinanceApproverIdsForUser: jest.Mock;
    updateClaimL2Decision: jest.Mock;
  }>,
) {
  const pendingFinanceStatus: DbClaimStatus = "HOD approved - Awaiting finance approval";

  return {
    getClaimForL2Decision: jest.fn(async () => ({
      data: {
        id: "claim-1",
        status: pendingFinanceStatus,
        assignedL2ApproverId: "finance-old-owner",
      },
      errorMessage: null,
    })),
    getFinanceApproverIdsForUser: jest.fn(async () => ({
      data: ["finance-approver-id-1"],
      errorMessage: null,
    })),
    updateClaimL2Decision: jest.fn(async () => ({ errorMessage: null })),
    ...overrides,
  };
}

describe("ProcessL2ClaimDecisionService", () => {
  test("moves finance approval to payment under process", async () => {
    const repository = createRepository();
    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-1",
      decision: "approve",
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimL2Decision).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "finance-1",
      status: "Finance Approved - Payment under process",
      assignedL2ApproverId: "finance-approver-id-1",
      rejectionReason: null,
      allowResubmission: false,
    });
  });

  test("marks claim rejected during finance authorization", async () => {
    const repository = createRepository();
    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-1",
      decision: "reject",
      rejectionReason: "Insufficient documentation.",
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimL2Decision).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "finance-1",
      status: "Rejected",
      assignedL2ApproverId: "finance-approver-id-1",
      rejectionReason: "Insufficient documentation.",
      allowResubmission: false,
    });
  });

  test("passes allowResubmission when finance rejects", async () => {
    const repository = createRepository();
    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-1",
      decision: "reject",
      rejectionReason: "Insufficient documentation.",
      allowResubmission: true,
    });

    expect(repository.updateClaimL2Decision).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "finance-1",
      status: "Rejected",
      assignedL2ApproverId: "finance-approver-id-1",
      rejectionReason: "Insufficient documentation.",
      allowResubmission: true,
    });
  });

  test("marks payment done from payment-under-process stage", async () => {
    const repository = createRepository({
      getClaimForL2Decision: jest.fn(async () => ({
        data: {
          id: "claim-1",
          status: "Finance Approved - Payment under process" as DbClaimStatus,
          assignedL2ApproverId: "finance-1",
        },
        errorMessage: null,
      })),
    });
    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-1",
      decision: "mark-paid",
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimL2Decision).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "finance-1",
      status: "Payment Done - Closed",
      assignedL2ApproverId: "finance-approver-id-1",
      rejectionReason: null,
      allowResubmission: false,
    });
  });

  test("blocks users outside finance approvers scope", async () => {
    const repository = createRepository({
      getFinanceApproverIdsForUser: jest.fn(async () => ({
        data: [],
        errorMessage: null,
      })),
    });
    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "employee-2",
      decision: "approve",
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("You are not authorized to process this finance decision.");
    expect(repository.updateClaimL2Decision).not.toHaveBeenCalled();
  });

  test("requires rejection reason for finance rejection", async () => {
    const repository = createRepository();
    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-1",
      decision: "reject",
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Rejection reason is required.");
    expect(repository.updateClaimL2Decision).not.toHaveBeenCalled();
  });

  test("blocks mark-paid before finance approval", async () => {
    const repository = createRepository();
    const service = new ProcessL2ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-1",
      decision: "mark-paid",
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("This claim is not in payment-under-process stage.");
    expect(repository.updateClaimL2Decision).not.toHaveBeenCalled();
  });
});
