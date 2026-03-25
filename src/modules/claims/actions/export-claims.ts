"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import { ExportClaimsService } from "@/core/domain/claims/ExportClaimsService";
import type {
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";

const authRepository = new SupabaseServerAuthRepository();
const repository = new SupabaseClaimRepository();
const exportClaimsService = new ExportClaimsService({ repository, logger });

const exportClaimsInputSchema = z.object({
  scope: z.enum(["submissions", "approvals"]),
  searchParams: z.string().default(""),
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

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

export async function exportClaimsCsvAction(input: {
  scope: "submissions" | "approvals";
  searchParams: string;
}): Promise<{
  data: { fileName: string; rowCount: number } | null;
  error: { code: string; message: string } | null;
  meta: { correlationId: string };
}> {
  const correlationId = randomUUID();
  const parseResult = exportClaimsInputSchema.safeParse(input);

  if (!parseResult.success) {
    return {
      data: null,
      error: {
        code: "INVALID_EXPORT_INPUT",
        message: "Invalid export request.",
      },
      meta: { correlationId },
    };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: currentUserResult.errorMessage ?? "Unauthorized session.",
      },
      meta: { correlationId },
    };
  }

  const filters = buildClaimFilters(new URLSearchParams(parseResult.data.searchParams));
  const exportResult = await exportClaimsService.execute({
    userId: currentUserResult.user.id,
    scope: parseResult.data.scope,
    filters,
  });

  if (exportResult.errorMessage) {
    return {
      data: null,
      error: {
        code: "EXPORT_FAILED",
        message: exportResult.errorMessage,
      },
      meta: { correlationId },
    };
  }

  logger.info("claims.export.server_action.success", {
    correlationId,
    userId: currentUserResult.user.id,
    scope: parseResult.data.scope,
    rowCount: exportResult.rowCount,
  });

  return {
    data: {
      fileName: exportResult.fileName,
      rowCount: exportResult.rowCount,
    },
    error: null,
    meta: { correlationId },
  };
}
