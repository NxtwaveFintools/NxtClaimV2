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
  }): Promise<{ data: ClaimFullExportRecord[]; errorMessage: string | null }>;
  getClaimEvidencePublicUrl(input: {
    filePath: string;
  }): Promise<{ data: string | null; errorMessage: string | null }>;
};

type ExportClaimsServiceDependencies = {
  repository: ExportClaimsRepository;
  logger: ClaimDomainLogger;
};

type ExportClaimsServiceInput = {
  userId: string;
  scope: "submissions" | "approvals";
  filters?: GetMyClaimsFilters;
};

type ExportClaimsServiceResult = {
  csvData: string;
  fileName: string;
  rowCount: number;
  errorMessage: string | null;
};

const EXPORT_BATCH_SIZE = 500;

const CSV_HEADERS = [
  "Claim ID",
  "Transaction ID",
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

function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  const stringValue = value == null ? "" : String(value);

  if (
    stringValue.includes('"') ||
    stringValue.includes(",") ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function buildCsvRow(values: Array<string | number | boolean | null | undefined>): string {
  return values.map((value) => escapeCsvValue(value)).join(",");
}

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

function toExcelHyperlink(value: string | null): string {
  if (!value || value.trim().length === 0) {
    return "N/A";
  }

  const normalized = value.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    return "N/A";
  }

  const escapedUrl = normalized.replace(/"/g, '""');
  return `=HYPERLINK("${escapedUrl}", "View Document")`;
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
    const viewerContextResult = await this.repository.getApprovalViewerContext(input.userId);

    if (viewerContextResult.errorMessage) {
      return {
        csvData: buildCsvRow([...CSV_HEADERS]) + "\n",
        fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
        rowCount: 0,
        errorMessage: viewerContextResult.errorMessage,
      };
    }

    const fetchScope = resolveExportScope(input, viewerContextResult.data);

    if (!fetchScope) {
      return {
        csvData: buildCsvRow([...CSV_HEADERS]) + "\n",
        fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
        rowCount: 0,
        errorMessage: null,
      };
    }

    const rows: ClaimFullExportRecord[] = [];
    let cursor: { createdAt: string; claimId: string } | undefined;

    while (true) {
      const batchResult = await this.repository.getClaimsForFullExport({
        userId: input.userId,
        fetchScope,
        filters: input.filters,
        limit: EXPORT_BATCH_SIZE,
        cursor,
      });

      if (batchResult.errorMessage) {
        return {
          csvData: buildCsvRow([...CSV_HEADERS]) + "\n",
          fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
          rowCount: 0,
          errorMessage: batchResult.errorMessage,
        };
      }

      if (batchResult.data.length === 0) {
        break;
      }

      rows.push(...batchResult.data);

      if (batchResult.data.length < EXPORT_BATCH_SIZE) {
        break;
      }

      const lastRecord = batchResult.data[batchResult.data.length - 1];
      cursor = {
        createdAt: lastRecord.createdAt,
        claimId: lastRecord.claimId,
      };
    }

    const csvLines: string[] = [buildCsvRow([...CSV_HEADERS])];

    for (const row of rows) {
      const receiptUrlResult = row.expenseReceiptFilePath
        ? await this.repository.getClaimEvidencePublicUrl({ filePath: row.expenseReceiptFilePath })
        : { data: null, errorMessage: null };
      const bankStatementUrlResult = row.expenseBankStatementFilePath
        ? await this.repository.getClaimEvidencePublicUrl({
            filePath: row.expenseBankStatementFilePath,
          })
        : { data: null, errorMessage: null };
      const supportingUrlResult = row.advanceSupportingDocumentPath
        ? await this.repository.getClaimEvidencePublicUrl({
            filePath: row.advanceSupportingDocumentPath,
          })
        : { data: null, errorMessage: null };

      if (
        receiptUrlResult.errorMessage ||
        bankStatementUrlResult.errorMessage ||
        supportingUrlResult.errorMessage
      ) {
        this.logger.warn("claims.export.public_url_resolution_failed", {
          claimId: row.claimId,
          receiptError: receiptUrlResult.errorMessage,
          bankStatementError: bankStatementUrlResult.errorMessage,
          supportingError: supportingUrlResult.errorMessage,
        });
      }

      const totalAmountRaw =
        row.detailType === "expense"
          ? formatAmountDisplay(row.expenseTotalAmount)
          : formatAmountDisplay(row.advanceRequestedAmount);
      const workflowStatuses = deriveWorkflowStatuses({
        status: row.status,
        financeActionAt: row.financeActionAt,
      });
      const beneficiaryName = row.beneficiaryName ?? row.submitterName;
      const beneficiaryEmail = row.beneficiaryEmail ?? row.submitterEmail;
      const submitter = row.submitterName ?? row.submitterEmail;
      const purpose = row.detailType === "expense" ? row.expensePurpose : row.advancePurpose;
      const product =
        row.detailType === "expense" ? row.expenseProductName : row.advanceProductName;
      const location =
        row.detailType === "expense" ? row.expenseLocationName : row.advanceLocationName;
      const transactionRemarks =
        row.detailType === "expense" ? row.expenseRemarks : row.advanceRemarks;
      const approvedAmount =
        row.status === DB_CLAIM_STATUSES[2] || row.status === DB_CLAIM_STATUSES[3]
          ? totalAmountRaw
          : "N/A";
      const billDate =
        row.detailType === "expense"
          ? formatBusinessDate(row.expenseTransactionDate)
          : formatBusinessDate(row.advanceExpectedUsageDate);
      const billUrl = receiptUrlResult.data;
      const pettyCashPhotoUrl =
        row.detailType === "expense" ? receiptUrlResult.data : supportingUrlResult.data;

      csvLines.push(
        buildCsvRow([
          row.claimId,
          toTextValue(row.expenseTransactionId),
          toTextValue(beneficiaryEmail),
          toTextValue(beneficiaryName),
          toTextValue(row.departmentName),
          formatAmountDisplay(row.pettyCashBalance),
          toTextValue(submitter),
          toTextValue(row.paymentModeName),
          row.submissionType,
          toTextValue(purpose),
          formatBusinessDate(row.submittedAt),
          formatBusinessDate(row.hodActionAt),
          formatBusinessDate(row.financeActionAt),
          billDate,
          row.status,
          workflowStatuses.hodStatus,
          workflowStatuses.financeStatus,
          workflowStatuses.billStatus,
          toTextValue(row.expenseBillNo),
          formatAmountDisplay(row.expenseBasicAmount),
          formatAmountDisplay(row.expenseCgstAmount),
          formatAmountDisplay(row.expenseSgstAmount),
          formatAmountDisplay(row.expenseIgstAmount),
          totalAmountRaw,
          toTextValue(row.expenseCurrencyCode ?? "INR"),
          approvedAmount,
          toTextValue(row.expenseVendorName),
          toTextValue(row.expenseCategoryName),
          toTextValue(product),
          toTextValue(location),
          "N/A",
          toExcelHyperlink(bankStatementUrlResult.data),
          toExcelHyperlink(billUrl),
          toExcelHyperlink(pettyCashPhotoUrl),
          toPettyCashRequestMonth(row.advanceBudgetMonth, row.advanceBudgetYear),
          "1",
          toTextValue(row.rejectionReason),
          toTextValue(transactionRemarks),
        ]),
      );
    }

    return {
      csvData: `${csvLines.join("\n")}\n`,
      fileName: `claims_export_${resolveFilenameDateTag()}.csv`,
      rowCount: rows.length,
      errorMessage: null,
    };
  }
}
