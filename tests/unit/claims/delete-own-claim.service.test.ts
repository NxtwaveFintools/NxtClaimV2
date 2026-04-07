import {
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
} from "@/core/constants/statuses";
import { DeleteOwnClaimService } from "@/core/domain/claims/DeleteOwnClaimService";
import type { ClaimRepository } from "@/core/domain/claims/contracts";

type DeleteOwnClaimRepository = Pick<
  ClaimRepository,
  "getClaimForSubmitterDelete" | "softDeleteClaimBySubmitter"
>;

type ClaimForDeleteResult = Awaited<
  ReturnType<DeleteOwnClaimRepository["getClaimForSubmitterDelete"]>
>;

type ClaimForDeleteStatus = NonNullable<ClaimForDeleteResult["data"]>["status"];

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(overrides?: Partial<DeleteOwnClaimRepository>): DeleteOwnClaimRepository {
  return {
    getClaimForSubmitterDelete:
      overrides?.getClaimForSubmitterDelete ??
      createGetClaimForSubmitterDeleteMock(DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS, "user-1"),
    softDeleteClaimBySubmitter:
      overrides?.softDeleteClaimBySubmitter ??
      jest.fn(async () => ({ success: true, errorMessage: null })),
  };
}

function createGetClaimForSubmitterDeleteMock(
  status: ClaimForDeleteStatus,
  submittedBy: string,
): DeleteOwnClaimRepository["getClaimForSubmitterDelete"] {
  return jest.fn<
    ReturnType<DeleteOwnClaimRepository["getClaimForSubmitterDelete"]>,
    Parameters<DeleteOwnClaimRepository["getClaimForSubmitterDelete"]>
  >(async () => ({
    data: {
      id: "CLM-001",
      status,
      submittedBy,
    },
    errorMessage: null,
  }));
}

describe("DeleteOwnClaimService", () => {
  test("rejects empty claim id", async () => {
    const repository = createRepository();
    const service = new DeleteOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({ claimId: "", actorUserId: "user-1" });

    expect(result).toEqual({ ok: false, errorMessage: "Claim ID is required." });
    expect(repository.getClaimForSubmitterDelete).not.toHaveBeenCalled();
  });

  test("rejects when actor is not submitter", async () => {
    const repository = createRepository({
      getClaimForSubmitterDelete: createGetClaimForSubmitterDeleteMock(
        DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
        "another-user",
      ),
    });
    const service = new DeleteOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({ claimId: "CLM-001", actorUserId: "user-1" });

    expect(result).toEqual({
      ok: false,
      errorMessage: "You can only delete claims you submitted.",
    });
    expect(repository.softDeleteClaimBySubmitter).not.toHaveBeenCalled();
  });

  test("rejects non-deletable status", async () => {
    const repository = createRepository({
      getClaimForSubmitterDelete: createGetClaimForSubmitterDeleteMock(
        DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
        "user-1",
      ),
    });
    const service = new DeleteOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({ claimId: "CLM-001", actorUserId: "user-1" });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe(
      "Only claims awaiting HOD approval or rejected with resubmission allowed can be deleted.",
    );
    expect(repository.softDeleteClaimBySubmitter).not.toHaveBeenCalled();
  });

  test("deletes claim for allowed rejected-resubmission status", async () => {
    const repository = createRepository({
      getClaimForSubmitterDelete: createGetClaimForSubmitterDeleteMock(
        DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
        "user-1",
      ),
    });
    const service = new DeleteOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({ claimId: "CLM-001", actorUserId: "user-1" });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.softDeleteClaimBySubmitter).toHaveBeenCalledWith("CLM-001", "user-1");
  });

  test("surfaces repository delete failure", async () => {
    const logger = createLogger();
    const repository = createRepository({
      softDeleteClaimBySubmitter: jest.fn(async () => ({
        success: false,
        errorMessage: "Failed to update claim row.",
      })),
    });
    const service = new DeleteOwnClaimService({ repository, logger });

    const result = await service.execute({ claimId: "CLM-001", actorUserId: "user-1" });

    expect(result).toEqual({ ok: false, errorMessage: "Failed to update claim row." });
    expect(logger.error).toHaveBeenCalled();
  });
});
