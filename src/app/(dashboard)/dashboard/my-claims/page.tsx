import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BackButton } from "@/components/ui/back-button";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import type {
  ClaimAuditLogRecord,
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { GetMyClaimsPaginatedService } from "@/core/domain/claims/GetMyClaimsPaginatedService";
import { GetPendingApprovalsService } from "@/core/domain/claims/GetPendingApprovalsService";
import { logger } from "@/core/infra/logging/logger";
import { formatDate, formatDateTime } from "@/lib/format";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import {
  approveClaimAction,
  approveFinanceAction,
  markPaymentDoneAction,
  rejectClaimAction,
  rejectFinanceAction,
} from "@/modules/claims/actions";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { isDepartmentViewer } from "@/modules/claims/server/is-department-viewer";
import { AdminClaimsSection } from "@/modules/admin/ui/admin-claims-section";
import { DepartmentClaimsSection } from "@/modules/claims/ui/department-claims-section";
import { ClaimDecisionActionForm } from "@/modules/claims/ui/claim-decision-action-form";
import { ClaimRejectWithReasonForm } from "@/modules/claims/ui/claim-reject-with-reason-form";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import { ClaimsFilterBar } from "@/modules/claims/ui/claims-filter-bar";
import { FinanceApprovalsBulkTable } from "@/modules/claims/ui/finance-approvals-bulk-table";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { ApprovalsAuditModeDialog } from "@/modules/claims/ui/approvals-quick-view-sheet";
import { ClaimSemanticDownloadButton } from "@/modules/claims/ui/claim-semantic-download-button";

const PAGE_SIZE = 10;
type SearchParamsValue = string | string[] | undefined;
type ViewMode = "submissions" | "approvals" | "admin" | "department";

export const metadata = {
  title: "My Claims | NxtClaim",
};

function firstParamValue(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function toSearchParams(searchParams?: Record<string, SearchParamsValue>): URLSearchParams {
  const params = new URLSearchParams();
  if (!searchParams) {
    return params;
  }

  for (const [key, value] of Object.entries(searchParams)) {
    const normalized = firstParamValue(value);
    if (normalized) {
      params.set(key, normalized);
    }
  }

  return params;
}

function resolveView(
  value: string | undefined,
  canViewApprovals: boolean,
  isAdminUser: boolean,
  isDeptViewer: boolean,
): ViewMode {
  if (value === "admin" && isAdminUser) {
    return "admin";
  }

  if (value === "department" && isDeptViewer) {
    return "department";
  }

  if (value === "approvals" && canViewApprovals) {
    return "approvals";
  }

  return "submissions";
}

function normalizeSubmissionType(value: string | undefined): ClaimSubmissionType | undefined {
  if (value === "Self" || value === "On Behalf") {
    return value;
  }

  return undefined;
}

function normalizeDateTarget(value: string | undefined): ClaimDateTarget {
  if (value === "finance_closed") {
    return value;
  }

  return "submitted";
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return value;
}

function normalizeSearchField(value: string | undefined): ClaimSearchField | undefined {
  if (value === "claim_id" || value === "employee_name" || value === "employee_id") {
    return value;
  }

  return undefined;
}

function normalizePaymentModeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDepartmentId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLookupId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStatusFilter(value: string | undefined): DbClaimStatus[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is DbClaimStatus => DB_CLAIM_STATUSES.includes(entry as DbClaimStatus));

  if (parsed.length === 0) {
    return undefined;
  }

  return parsed;
}

function buildClaimFilters(searchParams?: Record<string, SearchParamsValue>): GetMyClaimsFilters {
  const submissionType = normalizeSubmissionType(firstParamValue(searchParams?.submission_type));
  const status = normalizeStatusFilter(firstParamValue(searchParams?.status));
  const dateTarget = normalizeDateTarget(firstParamValue(searchParams?.date_target));
  const dateFrom = normalizeDate(firstParamValue(searchParams?.from));
  const dateTo = normalizeDate(firstParamValue(searchParams?.to));
  const searchField = normalizeSearchField(firstParamValue(searchParams?.search_field));
  const paymentModeId = normalizePaymentModeId(firstParamValue(searchParams?.payment_mode_id));
  const departmentId = normalizeDepartmentId(firstParamValue(searchParams?.department_id));
  const locationId = normalizeLookupId(firstParamValue(searchParams?.location_id));
  const productId = normalizeLookupId(firstParamValue(searchParams?.product_id));
  const expenseCategoryId = normalizeLookupId(firstParamValue(searchParams?.expense_category_id));
  const rawSearchQuery = firstParamValue(searchParams?.search_query)?.trim();
  const searchQuery = rawSearchQuery ? rawSearchQuery : undefined;

  return {
    paymentModeId,
    departmentId,
    locationId,
    productId,
    expenseCategoryId,
    submissionType,
    status,
    dateTarget,
    dateFrom,
    dateTo,
    searchField,
    searchQuery,
  };
}

function buildViewHref(
  searchParams: Record<string, SearchParamsValue> | undefined,
  targetView: ViewMode,
): string {
  const params = toSearchParams(searchParams);
  params.delete("cursor");
  params.delete("prevCursor");

  params.set("view", targetView);

  const query = params.toString();
  return query ? `${ROUTES.claims.myClaims}?${query}` : ROUTES.claims.myClaims;
}

function DateWithActor({
  dateValue,
  actorEmail,
}: {
  dateValue: string | null;
  actorEmail: string | null;
}) {
  if (!dateValue && !actorEmail) {
    return <span>-</span>;
  }

  return (
    <div className="flex flex-col">
      <span>{formatDate(dateValue)}</span>
      <span className="text-xs text-muted-foreground">{actorEmail ?? "-"}</span>
    </div>
  );
}

function MyClaimsShellSkeleton() {
  return (
    <>
      <div className="min-h-[140px]">
        <FilterBarSkeleton />
      </div>

      <section className="min-h-[600px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="shimmer-sweep h-4 w-40 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 11 }).map((_, index) => (
            <div
              key={`table-shell-row-${index}`}
              className="shimmer-sweep h-4 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40"
            />
          ))}
        </div>
      </section>
    </>
  );
}

function isRenderableEvidencePath(path: string | null): path is string {
  return Boolean(path && path.trim() !== "" && path !== "N/A");
}

type ApprovalEvidenceSignedUrls = {
  expenseReceiptSignedUrl: string | null;
  expenseBankStatementSignedUrl: string | null;
  advanceSupportingDocumentSignedUrl: string | null;
};

async function resolveApprovalEvidenceUrls(
  claimRepository: SupabaseClaimRepository,
  rows: Array<{
    id: string;
    expenseReceiptFilePath: string | null;
    expenseBankStatementFilePath: string | null;
    advanceSupportingDocumentPath: string | null;
  }>,
): Promise<Record<string, ApprovalEvidenceSignedUrls>> {
  const filePaths = Array.from(
    new Set(
      rows.flatMap((row) =>
        [
          row.expenseReceiptFilePath,
          row.expenseBankStatementFilePath,
          row.advanceSupportingDocumentPath,
        ].filter((path): path is string => isRenderableEvidencePath(path)),
      ),
    ),
  );

  const signedUrlByPath: Record<string, string> =
    filePaths.length === 0
      ? {}
      : await claimRepository
          .createBulkSignedUrls({
            filePaths,
            expiresInSeconds: 60 * 10,
          })
          .then((result) => (result.errorMessage ? {} : result.data))
          .catch(() => ({}));

  return Object.fromEntries(
    rows.map((row) => {
      const expenseReceiptPath = isRenderableEvidencePath(row.expenseReceiptFilePath)
        ? row.expenseReceiptFilePath
        : null;
      const expenseBankStatementPath = isRenderableEvidencePath(row.expenseBankStatementFilePath)
        ? row.expenseBankStatementFilePath
        : null;
      const advanceSupportingDocumentPath = isRenderableEvidencePath(
        row.advanceSupportingDocumentPath,
      )
        ? row.advanceSupportingDocumentPath
        : null;

      return [
        row.id,
        {
          expenseReceiptSignedUrl: expenseReceiptPath
            ? (signedUrlByPath[expenseReceiptPath] ?? null)
            : null,
          expenseBankStatementSignedUrl: expenseBankStatementPath
            ? (signedUrlByPath[expenseBankStatementPath] ?? null)
            : null,
          advanceSupportingDocumentSignedUrl: advanceSupportingDocumentPath
            ? (signedUrlByPath[advanceSupportingDocumentPath] ?? null)
            : null,
        },
      ] as const;
    }),
  );
}

type EnrichedAuditLogRecord = ClaimAuditLogRecord & { formattedCreatedAt: string };

async function resolveAuditLogsByClaimId(
  claimRepository: SupabaseClaimRepository,
  claimIds: string[],
): Promise<Record<string, EnrichedAuditLogRecord[]>> {
  if (claimIds.length === 0) {
    return {};
  }

  const result = await claimRepository.getClaimAuditLogsBatch(claimIds);

  if (result.errorMessage) {
    return Object.fromEntries(claimIds.map((claimId) => [claimId, []] as const));
  }

  return Object.fromEntries(
    claimIds.map((claimId) => [
      claimId,
      (result.data[claimId] ?? []).map((log) => ({
        ...log,
        formattedCreatedAt: formatDateTime(log.createdAt),
      })),
    ]),
  );
}

function resolveApprovalActionMode(params: {
  activeScope: "l1" | "finance" | null;
  status: DbClaimStatus;
  gatedStatuses: { l1: string; finance: string };
}): "l1-decision" | "finance-authorization" | "finance-mark-paid" | "none" {
  if (params.activeScope === "l1") {
    return params.status === params.gatedStatuses.l1 ? "l1-decision" : "none";
  }

  if (params.activeScope === "finance") {
    if (params.status === params.gatedStatuses.finance) {
      return "finance-authorization";
    }

    if (params.status === DB_CLAIM_STATUSES[2]) {
      return "finance-mark-paid";
    }
  }

  return "none";
}

function TableHeader({ showActions }: { showActions: boolean }) {
  return (
    <thead className="bg-zinc-50 text-xs uppercase tracking-[0.12em] text-zinc-600 dark:bg-zinc-900/50 dark:text-zinc-400">
      <tr>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">CLAIM ID</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">EMPLOYEE ID</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">EMPLOYEE NAME</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">DEPARTMENT</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">TYPE OF CLAIM</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">AMOUNT</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">STATUS</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">SUBMITTED ON</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">HOD ACTION DATE</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">FINANCE ACTION DATE</th>
        {showActions ? (
          <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Actions</th>
        ) : null}
      </tr>
    </thead>
  );
}

async function ClaimsCommandCenterTable({
  userId,
  view,
  approvalScope,
  searchParams,
  filters,
}: {
  userId: string;
  view: ViewMode;
  approvalScope: "l1" | "finance" | null;
  searchParams?: Record<string, SearchParamsValue>;
  filters: GetMyClaimsFilters;
}) {
  const claimRepository = new SupabaseClaimRepository();
  const claimsService = new GetMyClaimsPaginatedService({ repository: claimRepository, logger });
  const pendingApprovalsService = new GetPendingApprovalsService({
    repository: claimRepository,
    logger,
  });

  const cursor = firstParamValue(searchParams?.cursor) ?? null;
  const previousCursor = firstParamValue(searchParams?.prevCursor) ?? null;
  const previousCursorToken = previousCursor ?? (cursor ? "__first__" : null);

  if (view === "approvals") {
    const approvalsResult = await pendingApprovalsService.execute({
      userId,
      cursor,
      limit: PAGE_SIZE,
      filters,
    });

    const rows = approvalsResult.data;
    const claimIds = rows.map((claim) => claim.id);

    if (approvalScope === "finance" || approvalScope === "l1") {
      const [evidenceSignedUrlByClaimId, auditLogsByClaimId] = await Promise.all([
        resolveApprovalEvidenceUrls(claimRepository, rows),
        resolveAuditLogsByClaimId(claimRepository, claimIds),
      ]);

      return (
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
          {approvalsResult.errorMessage ? (
            <div className="px-4 py-6">
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                Unable to load approvals history. {approvalsResult.errorMessage}
              </p>
            </div>
          ) : rows.length === 0 ? (
            <>
              <div className="grid place-items-center px-4 py-14 text-center">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  No approvals history found.
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  Claims routed to your approval scope will appear here.
                </p>
              </div>
            </>
          ) : (
            <>
              <Suspense key={JSON.stringify(searchParams ?? {})} fallback={<TableSkeleton />}>
                <FinanceApprovalsBulkTable
                  rows={rows.map((claim) => ({
                    id: claim.id,
                    employeeId: claim.employeeId,
                    submitter: claim.submitter,
                    departmentName: claim.departmentName,
                    paymentModeName: claim.paymentModeName,
                    detailType: claim.detailType,
                    submissionType: claim.submissionType,
                    onBehalfEmail: claim.onBehalfEmail,
                    purpose: claim.purpose,
                    categoryName: claim.categoryName,
                    expenseReceiptFilePath: claim.expenseReceiptFilePath,
                    expenseBankStatementFilePath: claim.expenseBankStatementFilePath,
                    advanceSupportingDocumentPath: claim.advanceSupportingDocumentPath,
                    formattedTotalAmount: claim.formattedTotalAmount,
                    status: claim.status,
                    formattedSubmittedAt: claim.formattedSubmittedAt,
                    formattedHodActionDate: "N/A",
                    formattedFinanceActionDate: "N/A",
                  }))}
                  actionableIds={rows
                    .filter((row) => {
                      if (approvalScope === "l1") {
                        return row.status === "Submitted - Awaiting HOD approval";
                      }
                      return (
                        row.status === "HOD approved - Awaiting finance approval" ||
                        row.status === "Finance Approved - Payment under process"
                      );
                    })
                    .map((row) => row.id)}
                  totalSelectableCount={
                    approvalsResult.totalCount > 0 ? approvalsResult.totalCount : rows.length
                  }
                  filters={filters}
                  approvalScope={approvalScope}
                  evidenceSignedUrlByClaimId={evidenceSignedUrlByClaimId}
                  auditLogsByClaimId={auditLogsByClaimId}
                />
              </Suspense>

              <MyClaimsPaginationControls
                hasNextPage={approvalsResult.hasNextPage}
                hasPreviousPage={Boolean(previousCursorToken)}
                currentCursor={cursor}
                nextCursor={approvalsResult.nextCursor}
                previousCursor={previousCursorToken}
                searchParams={searchParams}
              />
            </>
          )}
        </section>
      );
    }

    const [evidenceSignedUrlByClaimId, auditLogsByClaimId] = await Promise.all([
      resolveApprovalEvidenceUrls(claimRepository, rows),
      resolveAuditLogsByClaimId(claimRepository, claimIds),
    ]);
    const gatedStatuses = {
      l1: DB_CLAIM_STATUSES[0],
      finance: DB_CLAIM_STATUSES[1],
    };

    return (
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p
            aria-hidden="true"
            className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-300"
          >
            Approvals History
          </p>
        </div>

        {approvalsResult.errorMessage ? (
          <div className="px-4 py-6">
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              Unable to load approvals history. {approvalsResult.errorMessage}
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center px-4 py-14 text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No approvals history found.
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Claims routed to your approval scope will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="w-full overflow-x-auto">
              <table className="min-w-[1720px] divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800">
                <TableHeader showActions />
                <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  {rows.map((claim) => {
                    const evidenceSignedUrls = evidenceSignedUrlByClaimId[claim.id] ?? {
                      expenseReceiptSignedUrl: null,
                      expenseBankStatementSignedUrl: null,
                      advanceSupportingDocumentSignedUrl: null,
                    };

                    const actionMode = resolveApprovalActionMode({
                      activeScope: approvalScope,
                      status: claim.status,
                      gatedStatuses,
                    });

                    const approveFromList = async () => {
                      "use server";
                      await approveClaimAction({ claimId: claim.id });
                    };

                    const rejectFromList = async (formData: FormData) => {
                      "use server";
                      const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
                      const allowResubmission = formData.get("allowResubmission") === "true";
                      await rejectClaimAction({
                        claimId: claim.id,
                        rejectionReason,
                        allowResubmission,
                      });
                    };

                    const approveFinanceFromList = async () => {
                      "use server";
                      await approveFinanceAction({ claimId: claim.id });
                    };

                    const rejectFinanceFromList = async (formData: FormData) => {
                      "use server";
                      const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
                      const allowResubmission = formData.get("allowResubmission") === "true";
                      await rejectFinanceAction({
                        claimId: claim.id,
                        rejectionReason,
                        allowResubmission,
                      });
                    };

                    const markPaidFromList = async () => {
                      "use server";
                      await markPaymentDoneAction({ claimId: claim.id });
                    };

                    const renderActions = (compact: boolean) => {
                      if (actionMode === "l1-decision") {
                        return (
                          <>
                            <ClaimDecisionActionForm
                              action={approveFromList}
                              decision="approve"
                              compact={compact}
                              loadingMessage="Approving claim..."
                              successMessage="Claim approved."
                              errorMessage="Unable to approve claim."
                            />
                            <ClaimRejectWithReasonForm action={rejectFromList} compact={compact} />
                          </>
                        );
                      }

                      if (actionMode === "finance-authorization") {
                        return (
                          <>
                            <ClaimDecisionActionForm
                              action={approveFinanceFromList}
                              decision="approve"
                              compact={compact}
                              loadingMessage="Approving finance step..."
                              successMessage="Finance decision approved."
                              errorMessage="Unable to approve finance step."
                            />
                            <ClaimRejectWithReasonForm
                              action={rejectFinanceFromList}
                              compact={compact}
                            />
                          </>
                        );
                      }

                      if (actionMode === "finance-mark-paid") {
                        return (
                          <ClaimDecisionActionForm
                            action={markPaidFromList}
                            decision="mark-paid"
                            compact={compact}
                            loadingMessage="Marking payment as done..."
                            successMessage="Claim marked as paid."
                            errorMessage="Unable to mark payment as done."
                          />
                        );
                      }

                      return (
                        <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                          No actions
                        </span>
                      );
                    };

                    return (
                      <tr
                        key={claim.id}
                        className="group transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                          <Link
                            href={ROUTES.claims.detail(claim.id)}
                            className="text-indigo-500 hover:text-indigo-400 hover:underline"
                          >
                            {claim.id}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="inline-block max-w-[180px] truncate align-bottom">
                            {claim.employeeId}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block max-w-[220px] truncate align-bottom">
                            {claim.submitter}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block max-w-[200px] truncate align-bottom">
                            {claim.departmentName ?? "Unknown Department"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block max-w-[220px] truncate align-bottom">
                            {claim.paymentModeName}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                          {claim.formattedTotalAmount}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <ClaimStatusBadge status={claim.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {claim.formattedSubmittedAt}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">N/A</td>
                        <td className="whitespace-nowrap px-4 py-3">N/A</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex min-w-[360px] flex-wrap items-start justify-end gap-2">
                            {claim.detailType === "expense" &&
                            evidenceSignedUrls.expenseReceiptSignedUrl ? (
                              <ClaimSemanticDownloadButton
                                url={evidenceSignedUrls.expenseReceiptSignedUrl}
                                semanticName={`${claim.id}-EXP`}
                                label="Expense Receipt"
                                compact
                              />
                            ) : null}
                            {claim.detailType === "expense" &&
                            evidenceSignedUrls.expenseBankStatementSignedUrl ? (
                              <ClaimSemanticDownloadButton
                                url={evidenceSignedUrls.expenseBankStatementSignedUrl}
                                semanticName={`${claim.id}-BNK`}
                                label="Bank Statement"
                                compact
                              />
                            ) : null}
                            {claim.detailType === "advance" &&
                            evidenceSignedUrls.advanceSupportingDocumentSignedUrl ? (
                              <ClaimSemanticDownloadButton
                                url={evidenceSignedUrls.advanceSupportingDocumentSignedUrl}
                                semanticName={`${claim.id}-PCR`}
                                label="Petty Cash Request Document"
                                compact
                              />
                            ) : null}
                            <ApprovalsAuditModeDialog
                              claimId={claim.id}
                              detailType={claim.detailType}
                              submitter={claim.submitter}
                              amountLabel={claim.formattedTotalAmount}
                              categoryName={claim.categoryName}
                              purpose={claim.purpose}
                              submissionType={claim.submissionType}
                              onBehalfEmail={claim.onBehalfEmail}
                              expenseReceiptFilePath={claim.expenseReceiptFilePath}
                              expenseReceiptSignedUrl={evidenceSignedUrls.expenseReceiptSignedUrl}
                              expenseBankStatementFilePath={claim.expenseBankStatementFilePath}
                              expenseBankStatementSignedUrl={
                                evidenceSignedUrls.expenseBankStatementSignedUrl
                              }
                              advanceSupportingDocumentPath={claim.advanceSupportingDocumentPath}
                              advanceSupportingDocumentSignedUrl={
                                evidenceSignedUrls.advanceSupportingDocumentSignedUrl
                              }
                              auditLogs={auditLogsByClaimId[claim.id] ?? []}
                            >
                              {renderActions(false)}
                            </ApprovalsAuditModeDialog>
                            {renderActions(true)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <MyClaimsPaginationControls
              hasNextPage={approvalsResult.hasNextPage}
              hasPreviousPage={Boolean(previousCursorToken)}
              currentCursor={cursor}
              nextCursor={approvalsResult.nextCursor}
              previousCursor={previousCursorToken}
              searchParams={searchParams}
            />
          </>
        )}
      </section>
    );
  }

  const claimsResult = await claimsService.execute({
    userId,
    cursor,
    limit: PAGE_SIZE,
    filters,
  });

  const rows = claimsResult.data;
  const claimIds = rows.map((claim) => claim.id);
  const [submissionDetailResult, submissionAuditLogsByClaimId] = await Promise.all([
    claimRepository.getClaimListDetails(claimIds),
    resolveAuditLogsByClaimId(claimRepository, claimIds),
  ]);
  const submissionDetailsByClaimId = submissionDetailResult.data;
  const submissionEvidenceSignedUrlByClaimId = await resolveApprovalEvidenceUrls(
    claimRepository,
    claimIds.map((claimId) => {
      const detail = submissionDetailsByClaimId[claimId];

      return {
        id: claimId,
        expenseReceiptFilePath: detail?.expenseReceiptFilePath ?? null,
        expenseBankStatementFilePath: detail?.expenseBankStatementFilePath ?? null,
        advanceSupportingDocumentPath: detail?.advanceSupportingDocumentPath ?? null,
      };
    }),
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-300">
          My Submissions
        </h2>
      </div>

      {claimsResult.errorMessage ? (
        <div className="px-4 py-6">
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Unable to load claims. {claimsResult.errorMessage}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center px-4 py-14 text-center">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No claims found</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Submit a new claim to see it here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-[1500px] divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800">
              <TableHeader showActions />
              <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                {rows.map((claim) => {
                  const detail = submissionDetailsByClaimId[claim.id];
                  const evidenceSignedUrls = submissionEvidenceSignedUrlByClaimId[claim.id] ?? {
                    expenseReceiptSignedUrl: null,
                    expenseBankStatementSignedUrl: null,
                    advanceSupportingDocumentSignedUrl: null,
                  };

                  return (
                    <tr
                      key={claim.id}
                      className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                    >
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                        <Link
                          href={ROUTES.claims.detail(claim.id)}
                          className="text-indigo-500 hover:text-indigo-400 hover:underline"
                        >
                          {claim.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block max-w-[180px] truncate align-bottom">
                          {claim.employeeId}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block max-w-[220px] truncate align-bottom">
                          {claim.employeeName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block max-w-[200px] truncate align-bottom">
                          {claim.departmentName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block max-w-[220px] truncate align-bottom">
                          {claim.typeOfClaim}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                        {claim.formattedTotalAmount}
                      </td>
                      <td className="px-4 py-3">
                        <ClaimStatusBadge status={claim.status} />
                      </td>
                      <td className="px-4 py-3">
                        <DateWithActor
                          dateValue={claim.submittedAt}
                          actorEmail={claim.submitterEmail}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <DateWithActor
                          dateValue={claim.hodActionDate}
                          actorEmail={claim.hodEmail}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <DateWithActor
                          dateValue={claim.financeActionDate}
                          actorEmail={claim.financeEmail}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {detail ? (
                            <ApprovalsAuditModeDialog
                              claimId={claim.id}
                              detailType={detail.detailType}
                              submitter={detail.submitter}
                              amountLabel={claim.formattedTotalAmount}
                              categoryName={detail.categoryName}
                              purpose={detail.purpose}
                              submissionType={detail.submissionType}
                              onBehalfEmail={detail.onBehalfEmail}
                              expenseReceiptFilePath={detail.expenseReceiptFilePath}
                              expenseReceiptSignedUrl={evidenceSignedUrls.expenseReceiptSignedUrl}
                              expenseBankStatementFilePath={detail.expenseBankStatementFilePath}
                              expenseBankStatementSignedUrl={
                                evidenceSignedUrls.expenseBankStatementSignedUrl
                              }
                              advanceSupportingDocumentPath={detail.advanceSupportingDocumentPath}
                              advanceSupportingDocumentSignedUrl={
                                evidenceSignedUrls.advanceSupportingDocumentSignedUrl
                              }
                              auditLogs={submissionAuditLogsByClaimId[claim.id] ?? []}
                            />
                          ) : (
                            <Link
                              href={ROUTES.claims.detail(claim.id)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              View
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <MyClaimsPaginationControls
            hasNextPage={claimsResult.hasNextPage}
            hasPreviousPage={Boolean(previousCursorToken)}
            currentCursor={cursor}
            nextCursor={claimsResult.nextCursor}
            previousCursor={previousCursorToken}
            searchParams={searchParams}
          />
        </>
      )}
    </section>
  );
}

function FilterBarSkeleton() {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`filter-placeholder-${index}`} className="space-y-1">
            <div className="shimmer-sweep h-3 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-9 w-full rounded-lg bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="shimmer-sweep h-9 w-24 rounded-lg bg-zinc-200 dark:bg-gray-800/40" />
        <div className="shimmer-sweep h-9 w-20 rounded-lg bg-zinc-200 dark:bg-gray-800/40" />
      </div>
    </section>
  );
}

async function FilterBarWithData({
  exportScope,
  defaultFiltersExpanded,
}: {
  exportScope: "submissions" | "approvals" | "admin" | "department";
  defaultFiltersExpanded: boolean;
}) {
  const claimRepository = new SupabaseClaimRepository();
  const [paymentModesResult, departmentsResult, locationsResult, productsResult, categoriesResult] =
    await Promise.all([
      claimRepository.getActivePaymentModes(),
      claimRepository.getActiveDepartments(),
      claimRepository.getActiveLocations(),
      claimRepository.getActiveProducts(),
      claimRepository.getActiveExpenseCategories(),
    ]);

  const paymentModes = paymentModesResult.data.map((mode) => ({ id: mode.id, name: mode.name }));
  const departments = departmentsResult.data.map((department) => ({
    id: department.id,
    name: department.name,
  }));
  const locations = locationsResult.data.map((location) => ({
    id: location.id,
    name: location.name,
  }));
  const products = productsResult.data.map((product) => ({ id: product.id, name: product.name }));
  const expenseCategories = categoriesResult.data.map((category) => ({
    id: category.id,
    name: category.name,
  }));

  return (
    <ClaimsFilterBar
      exportScope={exportScope}
      defaultFiltersExpanded={defaultFiltersExpanded}
      paymentModes={paymentModes}
      departments={departments}
      locations={locations}
      products={products}
      expenseCategories={expenseCategories}
    />
  );
}

async function MyClaimsDashboardPageContent({
  searchParams,
  isAdminUser,
  isDeptViewer,
}: {
  searchParams: Record<string, SearchParamsValue>;
  isAdminUser: boolean;
  isDeptViewer: boolean;
}) {
  const authRepository = new SupabaseServerAuthRepository();
  const claimRepository = new SupabaseClaimRepository();
  const pendingApprovalsService = new GetPendingApprovalsService({
    repository: claimRepository,
    logger,
  });

  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const resolvedSearchParams = searchParams;

  const filters = buildClaimFilters(resolvedSearchParams);

  const viewerContextResult = await pendingApprovalsService.getViewerContext({
    userId: currentUserResult.user.id,
  });
  const canViewApprovals = viewerContextResult.canViewApprovals;
  const requestedView = firstParamValue(resolvedSearchParams?.view);

  if (canViewApprovals && !requestedView && !isAdminUser) {
    redirect(buildViewHref(resolvedSearchParams, "approvals"));
  }

  const activeView = resolveView(requestedView, canViewApprovals, isAdminUser, isDeptViewer);

  if (activeView === "admin") {
    return <AdminClaimsSection searchParams={resolvedSearchParams} />;
  }

  if (activeView === "department") {
    return <DepartmentClaimsSection searchParams={resolvedSearchParams} />;
  }

  return (
    <>
      <Suspense fallback={<FilterBarSkeleton />}>
        <FilterBarWithData
          exportScope={activeView as "submissions" | "approvals"}
          defaultFiltersExpanded={viewerContextResult.activeScope === "finance"}
        />
      </Suspense>

      {activeView === "approvals" ? (
        <h2 className="sr-only" aria-label="Approvals History">
          Approvals History
        </h2>
      ) : null}

      <Suspense key={JSON.stringify(resolvedSearchParams)} fallback={<TableSkeleton />}>
        <ClaimsCommandCenterTable
          userId={currentUserResult.user.id}
          view={activeView}
          approvalScope={viewerContextResult.activeScope}
          searchParams={resolvedSearchParams}
          filters={filters}
        />
      </Suspense>
    </>
  );
}

export default async function MyClaimsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}) {
  const [resolvedSearchParams, isAdminUser, isDeptViewer] = await Promise.all([
    searchParams,
    isAdmin(),
    isDepartmentViewer(),
  ]);

  const requestedView = firstParamValue(resolvedSearchParams?.view);
  const activeView: ViewMode =
    requestedView === "admin" && isAdminUser
      ? "admin"
      : requestedView === "department" && isDeptViewer
        ? "department"
        : requestedView === "approvals"
          ? "approvals"
          : "submissions";

  const submissionsHref = buildViewHref(resolvedSearchParams, "submissions");
  const approvalsHref = buildViewHref(resolvedSearchParams, "approvals");
  const adminHref = buildViewHref(resolvedSearchParams, "admin");
  const departmentHref = buildViewHref(resolvedSearchParams, "department");

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <BackButton className="w-fit" />
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">My Claims</h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Command Center for submissions and approvals
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {isAdminUser ? (
                <Link
                  href={ROUTES.admin.settings}
                  className="inline-flex items-center rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-all duration-200 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  System Settings
                </Link>
              ) : null}
              <Link
                href={ROUTES.claims.new}
                className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
              >
                + New Claim
              </Link>
            </div>
          </div>

          <div className="mt-4 inline-flex flex-wrap rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900/60">
            <Link
              href={submissionsHref}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                activeView === "submissions"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              My Submissions
            </Link>
            <Link
              href={approvalsHref}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                activeView === "approvals"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              Approvals History
            </Link>
            {isAdminUser ? (
              <Link
                href={adminHref}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  activeView === "admin"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                Admin Overview
              </Link>
            ) : null}
            {isDeptViewer ? (
              <Link
                href={departmentHref}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  activeView === "department"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                Department Overview
              </Link>
            ) : null}
          </div>
        </section>

        <Suspense fallback={<MyClaimsShellSkeleton />}>
          <MyClaimsDashboardPageContent
            searchParams={resolvedSearchParams}
            isAdminUser={isAdminUser}
            isDeptViewer={isDeptViewer}
          />
        </Suspense>
      </main>
    </div>
  );
}
