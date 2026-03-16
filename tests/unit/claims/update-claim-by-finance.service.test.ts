import { UpdateClaimByFinanceService } from "@/core/domain/claims/UpdateClaimByFinanceService";

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
        submittedBy: "employee-1",
        expenseReceiptFilePath: "expenses/employee-1/old_receipt.pdf",
        expenseReceiptFileHash: "old-hash",
        advanceSupportingDocumentPath: null,
        advanceSupportingDocumentHash: null,
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
      payload: {
        detailType: "expense",
        billNo: "BILL-2",
        vendorName: "Updated Vendor",
        basicAmount: 500,
        totalAmount: 590,
        purpose: "Updated purpose",
        productId: "11111111-1111-4111-8111-111111111111",
        remarks: "Updated remarks",
        receiptFilePath: "expenses/employee-1/new_receipt.pdf",
        receiptFileHash: "new-hash",
      },
    });

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(repository.updateClaimDetailsByFinance).toHaveBeenCalledWith("claim-1", {
      detailType: "expense",
      billNo: "BILL-2",
      vendorName: "Updated Vendor",
      basicAmount: 500,
      totalAmount: 590,
      purpose: "Updated purpose",
      productId: "11111111-1111-4111-8111-111111111111",
      remarks: "Updated remarks",
      receiptFilePath: "expenses/employee-1/new_receipt.pdf",
      receiptFileHash: "new-hash",
    });
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
      payload: {
        detailType: "expense",
        billNo: "BILL-2",
        vendorName: "Updated Vendor",
        basicAmount: 500,
        totalAmount: 590,
        purpose: "Updated purpose",
        productId: null,
        remarks: null,
        receiptFilePath: null,
        receiptFileHash: null,
      },
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
          submittedBy: "employee-1",
          expenseReceiptFilePath: null,
          expenseReceiptFileHash: null,
          advanceSupportingDocumentPath: "expenses/employee-1/advance.pdf",
          advanceSupportingDocumentHash: "advance-hash",
        },
        errorMessage: null,
      })),
    });
    const service = new UpdateClaimByFinanceService({ repository, logger: createLogger() });

    const result = await service.execute({
      claimId: "claim-1",
      actorUserId: "finance-user-1",
      payload: {
        detailType: "expense",
        billNo: "BILL-2",
        vendorName: "Updated Vendor",
        basicAmount: 500,
        totalAmount: 590,
        purpose: "Updated purpose",
        productId: null,
        remarks: null,
        receiptFilePath: null,
        receiptFileHash: null,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Claim detail type mismatch for finance edit request.");
    expect(repository.updateClaimDetailsByFinance).not.toHaveBeenCalled();
  });
});
