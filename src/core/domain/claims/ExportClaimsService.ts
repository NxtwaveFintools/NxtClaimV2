import type {
  ClaimDomainLogger,
  ClaimFullExportRecord,
  ClaimsExportFetchScope,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";

type ExportClaimsRepository = {
  getApprovalViewerContext(userId: string): Promise<{
    data: { isHod: boolean; isFounder: boolean; isFinance: boolean };
    errorMessage: string | null;
  }>;
  getClaimsForFullExport(input: {
    userId: string;
    fetchScope: ClaimsExportFetchScope;
    filters?: GetMyClaimsFilters;
    limit: number;
    cursor?: { createdAt: string; claimId: string };
    departmentIds?: string[];
  }): Promise<{ data: ClaimFullExportRecord[]; errorMessage: string | null }>;
  createBulkSignedUrls(input: {
    filePaths: string[];
    expiresInSeconds: number;
  }): Promise<{ data: Record<string, string>; errorMessage: string | null }>;
  isUserAdmin(userId: string): Promise<{ data: boolean; errorMessage: string | null }>;
  getViewerDepartmentIds(userId: string): Promise<{ data: string[]; errorMessage: string | null }>;
};

type ExportClaimsServiceDependencies = {
  repository: ExportClaimsRepository;
  logger: ClaimDomainLogger;
};

type ExportClaimsServiceInput = {
  userId: string;
  scope: "submissions" | "approvals" | "admin" | "department";
  filters?: GetMyClaimsFilters;
};

export type ClaimExportRow = {
  claimId: string;
  employeeEmail: string;
  employeeName: string;
  department: string;
  pettyCashBalance: string;
  submitter: string;
  paymentMode: string;
  submissionType: string;
  purpose: string;
  claimRaisedDate: string;
  hodApprovedDate: string;
  financeApprovedDate: string;
  billDate: string;
  claimStatus: string;
  hodStatus: string;
  financeStatus: string;
  billStatus: string;
  billNumber: string;
  basicAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  totalAmount: string;
  currency: string;
  approvedAmount: string;
  vendorName: string;
  transactionCategory: string;
  product: string;
  expenseLocation: string;
  locationType: string;
  /** Raw signed URL, or null if unavailable. Set as a native hyperlink in the workbook. */
  bankStatementUrl: string | null;
  /** Raw signed URL, or null if unavailable. Set as a native hyperlink in the workbook. */
  billUrl: string | null;
  /** Raw signed URL, or null if unavailable. Set as a native hyperlink in the workbook. */
  pettyCashPhotoUrl: string | null;
  pettyCashRequestMonth: string;
  transactionCount: string;
  claimRemarks: string;
  transactionRemarks: string;
};

type ExportClaimsServiceResult = {
  rows: ClaimExportRow[];
  fileName: string;
  rowCount: number;
  errorMessage: string | null;
};

const EXPORT_BATCH_SIZE = 500;

export const EXPORT_HEADERS = [
  "Claim ID",
  "Employee Email",
  "Employee Name",
  "Department",
  "Petty Cash Balance",
  "Submitter",
  "Payment Mode",
  "Submission Type",
  "Purpose",
  "Claim Raised Date",
  "HOD Approved Date",
  "Finance Approved Date",
  "Bill Date",
  "Claim Status",
  "HOD Status",
  "Finance Status",
  "Bill Status",
  "Bill Number",
  "Basic Amount",
  "CGST",
  "SGST",
  "IGST",
  "Total Amount",
  "Currency",
  "Approved Amount",
  "Vendor Name",
  "Transaction Category",
  "Product",
  "Expense Location",
  "Location Type",
  "Bank Statement URL",
  "Bill URL",
  "Petty Cash Photo URL",
  "Petty Cash Request Month",
  "Transaction Count",
  "Claim Remarks",
  "Transaction Remarks",
] as const;

function formatBusinessDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "N/A";
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatAmountDisplay(value: number | null): string {
  if (value == null) {
    return "N/A";
  }

  return value.toFixed(2);
}

function toTextValue(value: string | null): string {
  if (!value || value.trim().length === 0) {
    return "N/A";
  }

  return value;
}

function deriveWorkflowStatuses(input: { status: DbClaimStatus; financeActionAt: string | null }): {
  hodStatus: string;
  financeStatus: string;
  billStatus: string;
} {
  switch (input.status) {
    case DB_CLAIM_STATUSES[0]:
      return {
        hodStatus: "Pending",
        financeStatus: "Pending",
        billStatus: "Pending",
      };
    case DB_CLAIM_STATUSES[1]:
      return {
        hodStatus: "Approved",
        financeStatus: "Pending",
        billStatus: "Pending",
      };
    case DB_CLAIM_STATUSES[2]:
      return {
        hodStatus: "Approved",
        financeStatus: "Approved",
        billStatus: "Pending",
      };
    case DB_CLAIM_STATUSES[3]:
      return {
        hodStatus: "Approved",
        financeStatus: "Approved",
        billStatus: "Paid",
      };
    case DB_CLAIM_STATUSES[4]:
      return {
        hodStatus: input.financeActionAt ? "Approved" : "Rejected",
        financeStatus: input.financeActionAt ? "Rejected" : "N/A",
        billStatus: "Rejected",
      };
    default:
      return {
        hodStatus: "Pending",
        financeStatus: "Pending",
        billStatus: "Pending",
      };
  }
}

function resolveExportScope(
  input: ExportClaimsServiceInput,
  viewerContext: { isHod: boolean; isFounder: boolean; isFinance: boolean },
): ClaimsExportFetchScope | null {
  if (input.scope === "submissions") {
    return "submissions";
  }

  if (input.scope === "admin") {
    return "admin";
  }

  if (input.scope === "department") {
    return "department_viewer";
  }

  if (viewerContext.isFinance) {
    return "finance_approvals";
  }

  if (viewerContext.isHod || viewerContext.isFounder) {
    return "l1_approvals";
  }

  return null;
}

function resolveFilenameDateTag(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function toPettyCashRequestMonth(month: number | null, year: number | null): string {
  if (!month || !year) {
    return "N/A";
  }

  return `${year}-${String(month).padStart(2, "0")}`;
}

export class ExportClaimsService {
  private readonly repository: ExportClaimsRepository;
  private readonly logger: ClaimDomainLogger;

  constructor(deps: ExportClaimsServiceDependencies) {
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  async execute(input: ExportClaimsServiceInput): Promise<ExportClaimsServiceResult> {
    // ── Admin scope: verify the user is an admin ──
    if (input.scope === "admin") {
      const adminResult = await this.repository.isUserAdmin(input.userId);
      if (adminResult.errorMessage) {
        return {
          rows: [],
          fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
          rowCount: 0,
          errorMessage: adminResult.errorMessage,
        };
      }
      if (!adminResult.data) {
        return {
          rows: [],
          fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
          rowCount: 0,
          errorMessage: "Forbidden: user is not an admin.",
        };
      }
    }

    // ── Department scope: resolve viewer department IDs ──
    let departmentIds: string[] | undefined;
    if (input.scope === "department") {
      const deptResult = await this.repository.getViewerDepartmentIds(input.userId);
      if (deptResult.errorMessage) {
        return {
          rows: [],
          fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
          rowCount: 0,
          errorMessage: deptResult.errorMessage,
        };
      }
      if (deptResult.data.length === 0) {
        return {
          rows: [],
          fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
          rowCount: 0,
          errorMessage: null,
        };
      }
      departmentIds = deptResult.data;
    }

    // ── Standard viewer context for submissions / approvals scopes ──
    const viewerContextResult = await this.repository.getApprovalViewerContext(input.userId);

    if (viewerContextResult.errorMessage) {
      return {
        rows: [],
        fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
        rowCount: 0,
        errorMessage: viewerContextResult.errorMessage,
      };
    }

    const fetchScope = resolveExportScope(input, viewerContextResult.data);

    if (!fetchScope) {
      return {
        rows: [],
        fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
        rowCount: 0,
        errorMessage: null,
      };
    }

    const dbRows: ClaimFullExportRecord[] = [];
    let cursor: { createdAt: string; claimId: string } | undefined;

    while (true) {
      const batchResult = await this.repository.getClaimsForFullExport({
        userId: input.userId,
        fetchScope,
        filters: input.filters,
        limit: EXPORT_BATCH_SIZE,
        cursor,
        departmentIds,
      });

      if (batchResult.errorMessage) {
        return {
          rows: [],
          fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
          rowCount: 0,
          errorMessage: batchResult.errorMessage,
        };
      }

      if (batchResult.data.length === 0) {
        break;
      }

      dbRows.push(...batchResult.data);

      if (batchResult.data.length < EXPORT_BATCH_SIZE) {
        break;
      }

      const lastRecord = batchResult.data[batchResult.data.length - 1];
      cursor = {
        createdAt: lastRecord.createdAt,
        claimId: lastRecord.claimId,
      };
    }

    const SIGNED_URL_EXPIRY_SECONDS = 2592000; // 30 days

    const allFilePaths: string[] = [];
    for (const row of dbRows) {
      if (row.expenseReceiptFilePath) allFilePaths.push(row.expenseReceiptFilePath);
      if (row.expenseBankStatementFilePath) allFilePaths.push(row.expenseBankStatementFilePath);
      if (row.advanceSupportingDocumentPath) allFilePaths.push(row.advanceSupportingDocumentPath);
    }

    const uniquePaths = [...new Set(allFilePaths)];
    let signedUrlMap: Record<string, string> = {};

    if (uniquePaths.length > 0) {
      const signedUrlResult = await this.repository.createBulkSignedUrls({
        filePaths: uniquePaths,
        expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
      });

      if (signedUrlResult.errorMessage) {
        this.logger.warn("claims.export.bulk_signed_url_generation_failed", {
          errorMessage: signedUrlResult.errorMessage,
          pathCount: uniquePaths.length,
        });
      }

      signedUrlMap = signedUrlResult.data;
    }

    const rows: ClaimExportRow[] = dbRows.map((row) => {
      const receiptUrl = row.expenseReceiptFilePath
        ? (signedUrlMap[row.expenseReceiptFilePath] ?? null)
        : null;
      const bankStatementUrl = row.expenseBankStatementFilePath
        ? (signedUrlMap[row.expenseBankStatementFilePath] ?? null)
        : null;
      const supportingUrl = row.advanceSupportingDocumentPath
        ? (signedUrlMap[row.advanceSupportingDocumentPath] ?? null)
        : null;

      const totalAmount =
        row.detailType === "expense"
          ? formatAmountDisplay(row.expenseTotalAmount)
          : formatAmountDisplay(row.advanceRequestedAmount);
      const workflowStatuses = deriveWorkflowStatuses({
        status: row.status,
        financeActionAt: row.financeActionAt,
      });
      const beneficiaryName = row.beneficiaryName ?? row.submitterName;
      const beneficiaryEmail = row.beneficiaryEmail ?? row.submitterEmail;

      return {
        claimId: row.claimId,
        employeeEmail: toTextValue(beneficiaryEmail),
        employeeName: toTextValue(beneficiaryName),
        department: toTextValue(row.departmentName),
        pettyCashBalance: formatAmountDisplay(row.pettyCashBalance),
        submitter: toTextValue(row.submitterName ?? row.submitterEmail),
        paymentMode: toTextValue(row.paymentModeName),
        submissionType: row.submissionType,
        purpose: toTextValue(
          row.detailType === "expense" ? row.expensePurpose : row.advancePurpose,
        ),
        claimRaisedDate: formatBusinessDate(row.submittedAt),
        hodApprovedDate: formatBusinessDate(row.hodActionAt),
        financeApprovedDate: formatBusinessDate(row.financeActionAt),
        billDate:
          row.detailType === "expense"
            ? formatBusinessDate(row.expenseTransactionDate)
            : formatBusinessDate(row.advanceExpectedUsageDate),
        claimStatus: row.status,
        hodStatus: workflowStatuses.hodStatus,
        financeStatus: workflowStatuses.financeStatus,
        billStatus: workflowStatuses.billStatus,
        billNumber: toTextValue(row.expenseBillNo),
        basicAmount: formatAmountDisplay(row.expenseBasicAmount),
        cgst: formatAmountDisplay(row.expenseCgstAmount),
        sgst: formatAmountDisplay(row.expenseSgstAmount),
        igst: formatAmountDisplay(row.expenseIgstAmount),
        totalAmount,
        currency: toTextValue(row.expenseCurrencyCode ?? "INR"),
        approvedAmount:
          row.status === DB_CLAIM_STATUSES[2] || row.status === DB_CLAIM_STATUSES[3]
            ? totalAmount
            : "N/A",
        vendorName: toTextValue(row.expenseVendorName),
        transactionCategory: toTextValue(row.expenseCategoryName),
        product: toTextValue(
          row.detailType === "expense" ? row.expenseProductName : row.advanceProductName,
        ),
        expenseLocation: toTextValue(
          row.detailType === "expense" ? row.expenseLocationName : row.advanceLocationName,
        ),
        locationType: "N/A",
        bankStatementUrl,
        billUrl: receiptUrl,
        pettyCashPhotoUrl: row.detailType === "expense" ? receiptUrl : supportingUrl,
        pettyCashRequestMonth: toPettyCashRequestMonth(
          row.advanceBudgetMonth,
          row.advanceBudgetYear,
        ),
        transactionCount: "1",
        claimRemarks: toTextValue(row.rejectionReason),
        transactionRemarks: toTextValue(
          row.detailType === "expense" ? row.expenseRemarks : row.advanceRemarks,
        ),
      };
    });

    return {
      rows,
      fileName: `claims_export_${resolveFilenameDateTag()}.xlsx`,
      rowCount: rows.length,
      errorMessage: null,
    };
  }
}
