import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import type {
  ClaimDateTarget,
  ClaimDetailType,
  ClaimSearchField,
  ClaimSubmissionType,
  ClaimsExportFetchScope,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { GetPendingApprovalsService } from "@/core/domain/claims/GetPendingApprovalsService";
import { withAuth, type AuthenticatedContext } from "@/core/http/with-auth";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";

const EXPORT_BATCH_SIZE = 500;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const scopeSchema = z.enum(["submissions", "approvals"]);

function normalizeDetailType(value: string | null): ClaimDetailType | undefined {
  if (value === "expense" || value === "advance") {
    return value;
  }

  return undefined;
}

function normalizeSubmissionType(value: string | null): ClaimSubmissionType | undefined {
  if (value === "Self" || value === "On Behalf") {
    return value;
  }

  return undefined;
}

function normalizeDateTarget(value: string | null): ClaimDateTarget {
  if (value === "finance_closed") {
    return "finance_closed";
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

  return {
    paymentModeId: paymentModeIdRaw ? paymentModeIdRaw : undefined,
    detailType: normalizeDetailType(searchParams.get("detail_type")),
    submissionType: normalizeSubmissionType(searchParams.get("submission_type")),
    status: normalizeStatusFilter(searchParams.get("status")),
    dateTarget: normalizeDateTarget(searchParams.get("date_target")),
    dateFrom: normalizeDate(searchParams.get("from")),
    dateTo: normalizeDate(searchParams.get("to")),
    searchField: normalizeSearchField(searchParams.get("search_field")),
    searchQuery: searchQueryRaw ? searchQueryRaw : undefined,
  };
}

function toExportFetchScope(
  scope: "submissions" | "approvals",
  activeScope: "l1" | "finance" | null,
): ClaimsExportFetchScope {
  if (scope === "submissions") {
    return "submissions";
  }

  return activeScope === "finance" ? "finance_approvals" : "l1_approvals";
}

function formatCsvDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
}

function escapeCsvValue(value: string | number | null | undefined): string {
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

function buildCsvRow(values: Array<string | number | null | undefined>): string {
  return values.map((value) => escapeCsvValue(value)).join(",");
}

function resolveFilenameDateTag(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

const exportClaimsHandler = async (request: NextRequest, context: AuthenticatedContext) => {
  const claimRepository = new SupabaseClaimRepository();
  const approvalsService = new GetPendingApprovalsService({ repository: claimRepository, logger });

  const searchParams = request.nextUrl.searchParams;
  const parsedScope = scopeSchema.safeParse(searchParams.get("scope") ?? "submissions");

  if (!parsedScope.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "INVALID_EXPORT_SCOPE",
          message: "scope must be either submissions or approvals",
        },
        meta: { correlationId: context.correlationId },
      },
      { status: 400 },
    );
  }

  const filters = buildClaimFilters(searchParams);
  const requestedScope = parsedScope.data;

  let activeApprovalScope: "l1" | "finance" | null = null;

  if (requestedScope === "approvals") {
    const viewerContext = await approvalsService.getViewerContext({ userId: context.userId });

    if (viewerContext.errorMessage) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "APPROVAL_SCOPE_RESOLUTION_FAILED",
            message: viewerContext.errorMessage,
          },
          meta: { correlationId: context.correlationId },
        },
        { status: 500 },
      );
    }

    if (!viewerContext.canViewApprovals || !viewerContext.activeScope) {
      activeApprovalScope = null;
    } else {
      activeApprovalScope = viewerContext.activeScope;
    }
  }

  const fetchScope = toExportFetchScope(requestedScope, activeApprovalScope);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const header = buildCsvRow([
          "Claim ID",
          "Employee Name",
          "Employee ID",
          "Department",
          "Request Type",
          "Date",
          "Amount",
          "Status",
          "Bill No",
          "Purpose",
          "Remarks",
        ]);

        controller.enqueue(encoder.encode(`${header}\n`));

        if (requestedScope === "approvals" && !activeApprovalScope) {
          controller.close();
          return;
        }

        let offset = 0;

        while (true) {
          const batchResult = await claimRepository.getClaimsForExport({
            userId: context.userId,
            fetchScope,
            filters,
            limit: EXPORT_BATCH_SIZE,
            offset,
          });

          if (batchResult.errorMessage) {
            throw new Error(batchResult.errorMessage);
          }

          if (batchResult.data.length === 0) {
            break;
          }

          const chunk = `${batchResult.data
            .map((record) =>
              buildCsvRow([
                record.claimId,
                record.employeeName,
                record.employeeId,
                record.departmentName ?? "",
                record.paymentModeName,
                formatCsvDate(record.submittedAt),
                record.amount.toFixed(2),
                record.status,
                record.billNo ?? "",
                record.purpose ?? "",
                record.remarks ?? "",
              ]),
            )
            .join("\n")}\n`;

          controller.enqueue(encoder.encode(chunk));

          if (batchResult.data.length < EXPORT_BATCH_SIZE) {
            break;
          }

          offset += EXPORT_BATCH_SIZE;
        }

        controller.close();
      } catch (error) {
        logger.error("claims.export.stream_failed", {
          correlationId: context.correlationId,
          userId: context.userId,
          message: error instanceof Error ? error.message : "Unknown export failure",
        });
        controller.error(error);
      }
    },
  });

  const dateTag = resolveFilenameDateTag();

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="claims_export_${dateTag}.csv"`,
      "Cache-Control": "no-store",
      "X-Correlation-Id": context.correlationId,
    },
  });
};

export const GET = withAuth(exportClaimsHandler);
