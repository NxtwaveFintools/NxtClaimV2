import { UpdateClaimByFinanceService } from "@/core/domain/claims/UpdateClaimByFinanceService";

const validExpensePayload = {
  detailType: "expense" as const,
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
    getFinanceApproverIdsForUser: jest.Mock;
    getClaimForFinanceEdit: jest.Mock;
    updateClaimDetailsByFinance: jest.Mock;
  }>,
) {
  return {
    getFinanceApproverIdsForUser: jest.fn(async () => ({
      data: ["finance-approver-id-1"],
      errorMessage: null,
    })),
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
    updateClaimDetailsByFinance: jest.fn(async () => ({ errorMessage: null })),
    ...overrides,
  };
}

describe("UpdateClaimByFinanceService", () => {
  test("updates expense details for finance actor", async () => {
    const repository = createRepository();
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-user-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimDetailsByFinance).toHaveBeenCalledWith(
      "claim-1",
      validExpensePayload,
    );
  });

  test("blocks non-finance actors", async () => {
    const repository = createRepository({
      getFinanceApproverIdsForUser: jest.fn(async () => ({
        data: [],
        errorMessage: null,
      })),
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "employee-1",
      payload: validExpensePayload,
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("You are not authorized to edit this claim.");
    expect(repository.updateClaimDetailsByFinance).not.toHaveBeenCalled();
  });

  test("rejects payload/detail mismatch", async () => {
    const repository = createRepository({
      getClaimForFinanceEdit: jest.fn(async () => ({
        data: {
          id: "claim-1",
          detailType: "advance" as const,
          status: "HOD approved - Awaiting finance approval" as const,
          submittedBy: "employee-1",
          assignedL1ApproverId: "hod-1",
          expenseReceiptFilePath: null,
          expenseBankStatementFilePath: null,
          advanceSupportingDocumentPath: "expenses/employee-1/advance.pdf",
        },
        errorMessage: null,
      })),
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-user-1",
      payload: validExpensePayload,
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Claim detail type mismatch for edit request.");
    expect(repository.updateClaimDetailsByFinance).not.toHaveBeenCalled();
  });

  test("returns scope lookup error and logs it", async () => {
    const repository = createRepository({
      getFinanceApproverIdsForUser: jest.fn(async () => ({
        data: [],
        errorMessage: "scope lookup failed",
      })),
    });
    const logger = createLogger();
    const service = new UpdateClaimByFinanceService({ repository, logger });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-user-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: false, errorMessage: "scope lookup failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.finance_edit.finance_scope_lookup_failed",
      expect.objectContaining({ claimId: "claim-1", errorMessage: "scope lookup failed" }),
    );
  });

  test("returns not found when claim snapshot is missing", async () => {
    const repository = createRepository({
      getClaimForFinanceEdit: jest.fn(async () => ({
        data: null,
        errorMessage: null,
      })),
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "missing-claim",
      actorUserId: "finance-user-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: false, errorMessage: "Claim not found." });
  });

  test("returns update error and logs it", async () => {
    const repository = createRepository({
      updateClaimDetailsByFinance: jest.fn(async () => ({
        errorMessage: "update failed",
      })),
    });
    const logger = createLogger();
    const service = new UpdateClaimByFinanceService({ repository, logger });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-user-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: false, errorMessage: "update failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "claims.finance_edit.update_failed",
      expect.objectContaining({
        claimId: "claim-1",
        actorUserId: "finance-user-1",
        detailType: "expense",
        errorMessage: "update failed",
      }),
    );
  });

  test("allows submitter edit during pre-HOD stage", async () => {
    const repository = createRepository({
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
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "employee-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.getFinanceApproverIdsForUser).not.toHaveBeenCalled();
  });

  test("allows assigned L1 edit during rejected-resubmission stage", async () => {
    const repository = createRepository({
      getClaimForFinanceEdit: jest.fn(async () => ({
        data: {
          id: "claim-1",
          detailType: "expense" as const,
          status: "Rejected - Resubmission Allowed" as const,
          submittedBy: "employee-1",
          assignedL1ApproverId: "hod-1",
          expenseReceiptFilePath: "expenses/employee-1/old_receipt.pdf",
          expenseBankStatementFilePath: "expenses/employee-1/old_bank.pdf",
          advanceSupportingDocumentPath: null,
        },
        errorMessage: null,
      })),
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "hod-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.getFinanceApproverIdsForUser).not.toHaveBeenCalled();
  });

  test("blocks non-submitter/non-L1 actor during pre-HOD stage", async () => {
    const repository = createRepository({
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
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "random-user",
      payload: validExpensePayload,
    });

    expect(result).toEqual({
      ok: false,
      errorMessage: "You are not authorized to edit this claim.",
    });
    expect(repository.updateClaimDetailsByFinance).not.toHaveBeenCalled();
    expect(repository.getFinanceApproverIdsForUser).not.toHaveBeenCalled();
  });

  test("blocks edits outside pre-HOD and awaiting-finance stages", async () => {
    const repository = createRepository({
      getClaimForFinanceEdit: jest.fn(async () => ({
        data: {
          id: "claim-1",
          detailType: "expense" as const,
          status: "Payment Done - Closed" as const,
          submittedBy: "employee-1",
          assignedL1ApproverId: "hod-1",
          expenseReceiptFilePath: "expenses/employee-1/old_receipt.pdf",
          expenseBankStatementFilePath: "expenses/employee-1/old_bank.pdf",
          advanceSupportingDocumentPath: null,
        },
        errorMessage: null,
      })),
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-user-1",
      payload: validExpensePayload,
    });

    expect(result).toEqual({
      ok: false,
      errorMessage: "You are not authorized to edit this claim.",
    });
    expect(repository.updateClaimDetailsByFinance).not.toHaveBeenCalled();
  });
});
