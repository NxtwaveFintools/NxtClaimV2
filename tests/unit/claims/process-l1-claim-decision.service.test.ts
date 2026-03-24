import { ProcessL1ClaimDecisionService } from "@/core/domain/claims/ProcessL1ClaimDecisionService";
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
    getClaimForL1Decision: jest.Mock;
    getPrimaryFinanceApproverId: jest.Mock;
    updateClaimL1Decision: jest.Mock;
  }>,
) {
  const pendingL1Status: DbClaimStatus = "Submitted - Awaiting HOD approval";

  return {
    getClaimForL1Decision: jest.fn(async () => ({
      data: {
        id: "claim-1",
        status: pendingL1Status,
        assignedL1ApproverId: "hod-1",
        assignedL2ApproverId: null,
      },
      errorMessage: null,
    })),
    getPrimaryFinanceApproverId: jest.fn(async () => ({
      data: "finance-approver-1",
      errorMessage: null,
    })),
    updateClaimL1Decision: jest.fn(async () => ({ errorMessage: null })),
    ...overrides,
  };
}

describe("ProcessL1ClaimDecisionService", () => {
  test("routes approved claims to finance pending status", async () => {
    const repository = createRepository();
    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "approve",
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimL1Decision).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "hod-1",
      status: "HOD approved - Awaiting finance approval",
      assignedL2ApproverId: "finance-approver-1",
      rejectionReason: null,
      allowResubmission: false,
    });
  });

  test("marks claim rejected for L1 rejection", async () => {
    const repository = createRepository();
    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "reject",
      rejectionReason: "Missing policy compliance evidence.",
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimL1Decision).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "hod-1",
      status: "Rejected",
      assignedL2ApproverId: null,
      rejectionReason: "Missing policy compliance evidence.",
      allowResubmission: false,
    });
  });

  test("passes allowResubmission when rejecting", async () => {
    const repository = createRepository();
    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });

    await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "reject",
      rejectionReason: "Missing policy compliance evidence.",
      allowResubmission: true,
    });

    expect(repository.updateClaimL1Decision).toHaveBeenCalledWith({
      claimId: "claim-1",
      actorUserId: "hod-1",
      status: "Rejected",
      assignedL2ApproverId: null,
      rejectionReason: "Missing policy compliance evidence.",
      allowResubmission: true,
    });
  });

  test("requires rejection reason for L1 rejection", async () => {
    const repository = createRepository();
    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "reject",
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Rejection reason is required.");
    expect(repository.updateClaimL1Decision).not.toHaveBeenCalled();
  });

  test("blocks decisions by non-assigned L1 approvers", async () => {
    const repository = createRepository();
    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-2",
      decision: "approve",
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("You are not authorized to approve or reject this claim.");
    expect(repository.updateClaimL1Decision).not.toHaveBeenCalled();
  });

  test("blocks when claim is no longer in L1 pending status", async () => {
    const repository = createRepository({
      getClaimForL1Decision: jest.fn(async () => ({
        data: {
          id: "claim-1",
          status: "HOD approved - Awaiting finance approval" as DbClaimStatus,
          assignedL1ApproverId: "hod-1",
          assignedL2ApproverId: "finance-approver-1",
        },
        errorMessage: null,
      })),
    });

    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "approve",
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("This claim is no longer pending L1 approval.");
    expect(repository.updateClaimL1Decision).not.toHaveBeenCalled();
  });
});
