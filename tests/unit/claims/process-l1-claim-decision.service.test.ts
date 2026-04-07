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
      status: "Rejected - Resubmission Not Allowed",
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
      status: "Rejected - Resubmission Allowed",
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

  test("returns not found when claim lookup returns null", async () => {
    const repository = createRepository({
      getClaimForL1Decision: jest.fn(async () => ({
        data: null,
        errorMessage: null,
      })),
    });

    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });
    const result = await service.execute({
      claimId: "missing-claim",
      actorUserId: "hod-1",
      decision: "approve",
    });

    expect(result).toEqual({ ok: false, errorMessage: "Claim not found." });
  });

  test("returns lookup error and logs when claim fetch fails", async () => {
    const repository = createRepository({
      getClaimForL1Decision: jest.fn(async () => ({
        data: null,
        errorMessage: "lookup failed",
      })),
    });
    const logger = createLogger();
    const service = new ProcessL1ClaimDecisionService({ repository, logger });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "approve",
    });

    expect(result).toEqual({ ok: false, errorMessage: "lookup failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.process_l1_decision.lookup_failed",
      expect.objectContaining({ claimId: "claim-1", errorMessage: "lookup failed" }),
    );
  });

  test("returns finance lookup error and logs when approver lookup fails", async () => {
    const repository = createRepository({
      getPrimaryFinanceApproverId: jest.fn(async () => ({
        data: null,
        errorMessage: "finance lookup failed",
      })),
    });
    const logger = createLogger();
    const service = new ProcessL1ClaimDecisionService({ repository, logger });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "approve",
    });

    expect(result).toEqual({ ok: false, errorMessage: "finance lookup failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.process_l1_decision.finance_lookup_failed",
      expect.objectContaining({ claimId: "claim-1", errorMessage: "finance lookup failed" }),
    );
    expect(repository.updateClaimL1Decision).not.toHaveBeenCalled();
  });

  test("returns configuration error when no L2 approver is available", async () => {
    const repository = createRepository({
      getClaimForL1Decision: jest.fn(async () => ({
        data: {
          id: "claim-1",
          status: "Submitted - Awaiting HOD approval" as DbClaimStatus,
          assignedL1ApproverId: "hod-1",
          assignedL2ApproverId: null,
        },
        errorMessage: null,
      })),
      getPrimaryFinanceApproverId: jest.fn(async () => ({
        data: null,
        errorMessage: null,
      })),
    });

    const service = new ProcessL1ClaimDecisionService({ repository, logger: createLogger() });
    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "approve",
    });

    expect(result).toEqual({
      ok: false,
      errorMessage: "No active finance approver is configured.",
    });
    expect(repository.updateClaimL1Decision).not.toHaveBeenCalled();
  });

  test("returns reject update error and logs it", async () => {
    const repository = createRepository({
      updateClaimL1Decision: jest.fn(async () => ({
        errorMessage: "reject update failed",
      })),
    });
    const logger = createLogger();
    const service = new ProcessL1ClaimDecisionService({ repository, logger });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "reject",
      rejectionReason: "policy mismatch",
    });

    expect(result).toEqual({ ok: false, errorMessage: "reject update failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.process_l1_decision.reject_failed",
      expect.objectContaining({ claimId: "claim-1", errorMessage: "reject update failed" }),
    );
  });

  test("returns approve update error and logs it", async () => {
    const repository = createRepository({
      updateClaimL1Decision: jest.fn(async () => ({
        errorMessage: "approve update failed",
      })),
    });
    const logger = createLogger();
    const service = new ProcessL1ClaimDecisionService({ repository, logger });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      decision: "approve",
    });

    expect(result).toEqual({ ok: false, errorMessage: "approve update failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.process_l1_decision.approve_failed",
      expect.objectContaining({ claimId: "claim-1", errorMessage: "approve update failed" }),
    );
  });
});
