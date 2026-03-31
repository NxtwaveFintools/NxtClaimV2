import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { z } from "zod";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import {
  ExportClaimsService,
  EXPORT_HEADERS,
  type ClaimExportRow,
} from "@/core/domain/claims/ExportClaimsService";
import type {
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { withAuth, type AuthenticatedContext } from "@/core/http/with-auth";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";

const scopeSchema = z.enum(["submissions", "approvals", "admin", "department"]);
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSubmissionType(value: string | null): ClaimSubmissionType | undefined {
  if (value === "Self" || value === "On Behalf") {
    return value;
  }

  return undefined;
}

function normalizeDateTarget(value: string | null): ClaimDateTarget {
  if (value === "finance_closed" || value === "hod_action") {
    return value;
  }

  return "submitted";
}

function normalizeDate(value: string | null): string | undefined {
  if (!value || !dateRegex.test(value)) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return value;
}

function normalizeSearchField(value: string | null): ClaimSearchField | undefined {
  if (value === "claim_id" || value === "employee_name" || value === "employee_id") {
    return value;
  }

  return undefined;
}

function normalizeStatusFilter(value: string | null): DbClaimStatus[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is DbClaimStatus => DB_CLAIM_STATUSES.includes(entry as DbClaimStatus));

  return parsed.length > 0 ? parsed : undefined;
}

function buildClaimFilters(searchParams: URLSearchParams): GetMyClaimsFilters {
  const searchQueryRaw = searchParams.get("search_query")?.trim();
  const paymentModeIdRaw = searchParams.get("payment_mode_id")?.trim();
  const departmentIdRaw = searchParams.get("department_id")?.trim();
  const locationIdRaw = searchParams.get("location_id")?.trim();
  const productIdRaw = searchParams.get("product_id")?.trim();
  const expenseCategoryIdRaw = searchParams.get("expense_category_id")?.trim();

  return {
    paymentModeId: paymentModeIdRaw ? paymentModeIdRaw : undefined,
    departmentId: departmentIdRaw ? departmentIdRaw : undefined,
    locationId: locationIdRaw ? locationIdRaw : undefined,
    productId: productIdRaw ? productIdRaw : undefined,
    expenseCategoryId: expenseCategoryIdRaw ? expenseCategoryIdRaw : undefined,
    submissionType: normalizeSubmissionType(searchParams.get("submission_type")),
    status: normalizeStatusFilter(searchParams.get("status")),
    dateTarget: normalizeDateTarget(searchParams.get("date_target")),
    dateFrom: normalizeDate(searchParams.get("from")),
    dateTo: normalizeDate(searchParams.get("to")),
    searchField: normalizeSearchField(searchParams.get("search_field")),
    searchQuery: searchQueryRaw ? searchQueryRaw : undefined,
  };
}

const exportClaimsHandler = async (request: NextRequest, context: AuthenticatedContext) => {
  const parsedScope = scopeSchema.safeParse(
    request.nextUrl.searchParams.get("scope") ?? "submissions",
  );

  if (!parsedScope.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "INVALID_EXPORT_SCOPE",
          message: "scope must be one of: submissions, approvals, admin, department",
        },
        meta: { correlationId: context.correlationId },
      },
      { status: 400 },
    );
  }

  const claimRepository = new SupabaseClaimRepository();
  const exportService = new ExportClaimsService({ repository: claimRepository, logger });
  const filters = buildClaimFilters(request.nextUrl.searchParams);

  const result = await exportService.execute({
    userId: context.userId,
    scope: parsedScope.data,
    filters,
  });

  if (result.errorMessage) {
    logger.error("claims.export.route.failed", {
      correlationId: context.correlationId,
      userId: context.userId,
      scope: parsedScope.data,
      errorMessage: result.errorMessage,
    });

    return NextResponse.json(
      {
        data: null,
        error: {
          code: "EXPORT_FAILED",
          message: result.errorMessage,
        },
        meta: { correlationId: context.correlationId },
      },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(await buildExcelWorkbook(result.rows)), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
      "X-Correlation-Id": context.correlationId,
    },
  });
};

// Column indices (1-based) for the three document URL columns.
const COL_BANK_STATEMENT = 32;
const COL_BILL_URL = 33;
const COL_PETTY_CASH_PHOTO = 34;

function applyHyperlinkCell(row: ExcelJS.Row, colIndex: number, url: string | null): void {
  const cell = row.getCell(colIndex);
  if (url) {
    cell.value = { text: "View Document", hyperlink: url };
    cell.font = { color: { argb: "FF0563C1" }, underline: true };
  } else {
    cell.value = "Document Unavailable";
  }
}

async function buildExcelWorkbook(rows: ClaimExportRow[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Claims");

  const headerRow = worksheet.addRow([...EXPORT_HEADERS]);
  headerRow.font = { bold: true };

  for (const rowData of rows) {
    const excelRow = worksheet.addRow([
      rowData.claimId,
      rowData.transactionId,
      rowData.employeeEmail,
      rowData.employeeName,
      rowData.department,
      rowData.pettyCashBalance,
      rowData.submitter,
      rowData.paymentMode,
      rowData.submissionType,
      rowData.purpose,
      rowData.claimRaisedDate,
      rowData.hodApprovedDate,
      rowData.financeApprovedDate,
      rowData.billDate,
      rowData.claimStatus,
      rowData.hodStatus,
      rowData.financeStatus,
      rowData.billStatus,
      rowData.billNumber,
      rowData.basicAmount,
      rowData.cgst,
      rowData.sgst,
      rowData.igst,
      rowData.totalAmount,
      rowData.currency,
      rowData.approvedAmount,
      rowData.vendorName,
      rowData.transactionCategory,
      rowData.product,
      rowData.expenseLocation,
      rowData.locationType,
      null, // col 32: Bank Statement URL — set below as native hyperlink
      null, // col 33: Bill URL — set below as native hyperlink
      null, // col 34: Petty Cash Photo URL — set below as native hyperlink
      rowData.pettyCashRequestMonth,
      rowData.transactionCount,
      rowData.claimRemarks,
      rowData.transactionRemarks,
    ]);

    applyHyperlinkCell(excelRow, COL_BANK_STATEMENT, rowData.bankStatementUrl);
    applyHyperlinkCell(excelRow, COL_BILL_URL, rowData.billUrl);
    applyHyperlinkCell(excelRow, COL_PETTY_CASH_PHOTO, rowData.pettyCashPhotoUrl);
  }

  return workbook.xlsx.writeBuffer();
}

export const GET = withAuth(exportClaimsHandler);
