import { UpdateOwnClaimService } from "@/core/domain/claims/UpdateOwnClaimService";

const validExpensePayload = {
  detailType: "expense" as const,
  detailId: "expense-detail-1",
  billNo: "BILL-2",
  expenseCategoryId: "cat-1",
  locationId: "loc-1",
  transactionDate: "2026-03-20",
  isGstApplicable: true,
  gstNumber: "GSTIN123",
  vendorName: "Updated Vendor",
  basicAmount: 500,
  cgstAmount: 45,
  sgstAmount: 45,
  igstAmount: 0,
  totalAmount: 590,
  purpose: "Updated purpose",
  productId: "prod-1",
  peopleInvolved: "Alice,Bob",
  remarks: "Updated remarks",
  receiptFilePath: "expenses/employee-1/new_receipt.pdf",
  bankStatementFilePath: "expenses/employee-1/new_bank.pdf",
};

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(
  overrides?: Partial<{
    getClaimForFinanceEdit: jest.Mock;
    updateClaimDetailsBySubmitter: jest.Mock;
  }>,
) {
  return {
    getClaimForFinanceEdit: jest.fn(async () => ({
      data: {
        id: "claim-1",
        detailType: "expense" as const,
        status: "Submitted - Awaiting HOD approval" as const,
        submittedBy: "employee-1",
        assignedL1ApproverId: "hod-1",
        expenseReceiptFilePath: "expenses/employee-1/old_receipt.pdf",
        expenseBankStatementFilePath: "expenses/employee-1/old_bank.pdf",
        advanceSupportingDocumentPath: null,
      },
      errorMessage: null,
    })),
    updateClaimDetailsBySubmitter: jest.fn(async () => ({ errorMessage: null })),
    ...overrides,
  };
}

describe("UpdateOwnClaimService", () => {
  test("updates claim details for submitter during pre-HOD stage", async () => {
    const repository = createRepository();
    const service = new UpdateOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "employee-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimDetailsBySubmitter).toHaveBeenCalledWith(
      "claim-1",
      "employee-1",
      validExpensePayload,
    );
  });

  test("allows assigned L1 approver during pre-HOD stage", async () => {
    const repository = createRepository();
    const service = new UpdateOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
  });

  test("blocks edits outside pre-HOD statuses", async () => {
    const repository = createRepository({
      getClaimForFinanceEdit: jest.fn(async () => ({
        data: {
          id: "claim-1",
          detailType: "expense" as const,
          status: "HOD approved - Awaiting finance approval" as const,
          submittedBy: "employee-1",
          assignedL1ApproverId: "hod-1",
          expenseReceiptFilePath: "expenses/employee-1/old_receipt.pdf",
          expenseBankStatementFilePath: "expenses/employee-1/old_bank.pdf",
          advanceSupportingDocumentPath: null,
        },
        errorMessage: null,
      })),
    });
    const service = new UpdateOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "employee-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({
      ok: false,
      errorMessage: "You are not authorized to edit this claim.",
    });
    expect(repository.updateClaimDetailsBySubmitter).not.toHaveBeenCalled();
  });

  test("blocks non-submitter/non-L1 actors", async () => {
    const repository = createRepository();
    const service = new UpdateOwnClaimService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "random-user",
      payload: validExpensePayload,
    });

    expect(result).toEqual({
      ok: false,
      errorMessage: "You are not authorized to edit this claim.",
    });
    expect(repository.updateClaimDetailsBySubmitter).not.toHaveBeenCalled();
  });

  test("returns update error and logs it", async () => {
    const repository = createRepository({
      updateClaimDetailsBySubmitter: jest.fn(async () => ({
        errorMessage: "update failed",
      })),
    });
    const logger = createLogger();
    const service = new UpdateOwnClaimService({ repository, logger });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "employee-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: false, errorMessage: "update failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.own_edit.update_failed",
      expect.objectContaining({
        claimId: "claim-1",
        actorUserId: "employee-1",
        detailType: "expense",
        errorMessage: "update failed",
      }),
    );
  });
});
