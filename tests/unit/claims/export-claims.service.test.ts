import { ExportClaimsService, EXPORT_HEADERS } from "@/core/domain/claims/ExportClaimsService";
import type { ClaimFullExportRecord } from "@/core/domain/claims/contracts";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";

function createBaseRecord(overrides?: Partial<ClaimFullExportRecord>): ClaimFullExportRecord {
  return {
    claimId: "CLAIM-EMP001-20260324-0001",
    status: DB_CLAIM_STATUSES[0],
    submissionType: "Self",
    detailType: "expense",
    submittedBy: "user-1",
    onBehalfOfId: "user-1",
    employeeId: "EMP001",
    ccEmails: "finance@nxtwave.co.in",
    onBehalfEmail: null,
    onBehalfEmployeeCode: null,
    departmentId: "dept-1",
    departmentName: "Engineering",
    paymentModeId: "pm-1",
    paymentModeName: "Reimbursement",
    assignedL1ApproverId: "l1-1",
    assignedL2ApproverId: "l2-1",
    submittedAt: "2026-03-24T10:00:00.000Z",
    hodActionAt: "2026-03-24T12:00:00.000Z",
    financeActionAt: null,
    rejectionReason: null,
    isResubmissionAllowed: false,
    createdAt: "2026-03-24T10:00:00.000Z",
    updatedAt: "2026-03-24T10:05:00.000Z",
    submitterName: "Submitter One",
    submitterEmail: "submitter@nxtwave.co.in",
    beneficiaryName: "Submitter One",
    beneficiaryEmail: "submitter@nxtwave.co.in",
    pettyCashBalance: 2400.5,
    l1ApproverName: "HOD One",
    l1ApproverEmail: "hod@nxtwave.co.in",
    l2ApproverName: "Finance One",
    l2ApproverEmail: "finance@nxtwave.co.in",
    expenseBillNo: "BILL-1",
    expenseTransactionId: "TXN-1",
    expensePurpose: "Client visit",
    expenseCategoryId: "cat-1",
    expenseCategoryName: "Travel",
    expenseProductId: "prod-1",
    expenseProductName: "Product X",
    expenseLocationId: "loc-1",
    expenseLocationName: "Hyderabad",
    expenseIsGstApplicable: true,
    expenseGstNumber: "GST1234",
    expenseTransactionDate: "2026-03-22",
    expenseBasicAmount: 100,
    expenseCgstAmount: 9,
    expenseSgstAmount: 9,
    expenseIgstAmount: 0,
    expenseTotalAmount: 118,
    expenseCurrencyCode: "INR",
    expenseVendorName: "Vendor A",
    expensePeopleInvolved: "Alice",
    expenseRemarks: "N/A",
    expenseReceiptFilePath: "expenses/user-1/receipt.pdf",
    expenseBankStatementFilePath: "expenses/user-1/bank.pdf",
    advanceRequestedAmount: null,
    advanceBudgetMonth: null,
    advanceBudgetYear: null,
    advanceExpectedUsageDate: null,
    advancePurpose: null,
    advanceProductId: null,
    advanceProductName: null,
    advanceLocationId: null,
    advanceLocationName: null,
    advanceRemarks: null,
    advanceSupportingDocumentPath: null,
    ...overrides,
  };
}

function createRepository(overrides?: {
  getClaimsForFullExport?: jest.Mock;
  getApprovalViewerContext?: jest.Mock;
  createBulkSignedUrls?: jest.Mock;
}) {
  return {
    getApprovalViewerContext:
      overrides?.getApprovalViewerContext ??
      jest.fn(async () => ({
        data: { isHod: true, isFounder: false, isFinance: false },
        errorMessage: null,
      })),
    getClaimsForFullExport:
      overrides?.getClaimsForFullExport ??
      jest.fn(async () => ({
        data: [createBaseRecord()],
        errorMessage: null,
      })),
    createBulkSignedUrls:
      overrides?.createBulkSignedUrls ??
      jest.fn(async ({ filePaths }: { filePaths: string[] }) => {
        const data: Record<string, string> = {};
        for (const fp of filePaths) {
          data[fp] = `https://example.supabase.co/storage/v1/object/sign/claims/${fp}?token=abc`;
        }
        return { data, errorMessage: null };
      }),
  };
}

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe("ExportClaimsService", () => {
  it("returns typed rows with raw signed URLs (not formula strings) for document columns", async () => {
    const repository = createRepository();
    const service = new ExportClaimsService({ repository, logger: createLogger() });

    const result = await service.execute({
      userId: "user-1",
      scope: "submissions",
      filters: {},
    });

    expect(result.errorMessage).toBeNull();
    expect(result.rowCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.fileName).toMatch(/\.xlsx$/);

    const row = result.rows[0];

    // Core identity fields
    expect(row.claimId).toBe("CLAIM-EMP001-20260324-0001");
    expect(row.employeeName).toBe("Submitter One");
    expect(row.department).toBe("Engineering");

    // URL fields must be raw signed URL strings — never =HYPERLINK(...) formulas
    expect(row.billUrl).toMatch(/^https:\/\//);
    expect(row.billUrl).not.toContain("=HYPERLINK");
    expect(row.bankStatementUrl).toMatch(/^https:\/\//);
    expect(row.bankStatementUrl).not.toContain("=HYPERLINK");
    // expense type: pettyCashPhotoUrl mirrors billUrl (both use receipt path)
    expect(row.pettyCashPhotoUrl).toBe(row.billUrl);
  });

  it("EXPORT_HEADERS has 38 columns matching the ClaimExportRow field order", () => {
    expect(EXPORT_HEADERS).toHaveLength(38);
    expect(EXPORT_HEADERS[0]).toBe("Claim ID");
    expect(EXPORT_HEADERS[31]).toBe("Bank Statement URL");
    expect(EXPORT_HEADERS[32]).toBe("Bill URL");
    expect(EXPORT_HEADERS[33]).toBe("Petty Cash Photo URL");
    expect(EXPORT_HEADERS[37]).toBe("Transaction Remarks");
  });

  it("bypasses pagination by requesting multiple backend batches", async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) =>
      createBaseRecord({ claimId: `CLAIM-1-${index}` }),
    );
    const secondBatch = Array.from({ length: 20 }, (_, index) =>
      createBaseRecord({ claimId: `CLAIM-2-${index}` }),
    );

    const getClaimsForFullExport = jest
      .fn()
      .mockResolvedValueOnce({ data: firstBatch, errorMessage: null })
      .mockResolvedValueOnce({ data: secondBatch, errorMessage: null });

    const repository = createRepository({ getClaimsForFullExport });
    const service = new ExportClaimsService({ repository, logger: createLogger() });

    const result = await service.execute({
      userId: "user-1",
      scope: "submissions",
      filters: {},
    });

    expect(result.errorMessage).toBeNull();
    expect(result.rowCount).toBe(520);
    expect(getClaimsForFullExport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cursor: undefined, limit: 500 }),
    );
    expect(getClaimsForFullExport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { claimId: "CLAIM-1-499", createdAt: "2026-03-24T10:00:00.000Z" },
        limit: 500,
      }),
    );
  });
});
