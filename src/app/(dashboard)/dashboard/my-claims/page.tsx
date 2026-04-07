import Link from "next/link";
import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { Suspense, cache } from "react";
import { CirclePlus } from "lucide-react";
import { AppShellHeader } from "@/components/app-shell-header";
import { BackButton } from "@/components/ui/back-button";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { ROUTES } from "@/core/config/route-registry";
import {
  DB_CLAIM_STATUSES,
  isPendingFinanceApprovalStatus,
  isSubmitterDeletableClaimStatus,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import type {
  ClaimAuditLogRecord,
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { GetMyClaimsPaginatedService } from "@/core/domain/claims/GetMyClaimsPaginatedService";
import {
  GetPendingApprovalsService,
  type PendingApprovalsViewerContext,
} from "@/core/domain/claims/GetPendingApprovalsService";
import { logger } from "@/core/infra/logging/logger";
import { formatDate, formatDateTime } from "@/lib/format";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
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
import {
  CLAIM_STATUS_COLUMN_WIDTH_CLASSES,
  ClaimStatusBadge,
} from "@/modules/claims/ui/claim-status-badge";
import { MyClaimsOffsetPaginationControls } from "@/modules/claims/ui/my-claims-offset-pagination-controls";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { ApprovalsAuditModeDialog } from "@/modules/claims/ui/approvals-quick-view-sheet";
import { DeleteClaimButton } from "@/modules/claims/ui/delete-claim-button";

const PAGE_SIZE = 10;
type SearchParamsValue = string | string[] | undefined;
type ViewMode = "submissions" | "approvals" | "admin" | "department";

const pendingApprovalsRepository = new SupabaseClaimRepository();
const pendingApprovalsViewerContextService = new GetPendingApprovalsService({
  repository: pendingApprovalsRepository,
  logger,
});

const getCachedPendingApprovalsViewerContext = cache(
  async (userId: string): Promise<PendingApprovalsViewerContext> => {
    return pendingApprovalsViewerContextService.getViewerContext({ userId });
  },
);

export const metadata = {
  title: "My Claims | NxtClaim",
};

const ClaimsFilterBar = dynamic(
  () => import("@/modules/claims/ui/claims-filter-bar").then((module) => module.ClaimsFilterBar),
  {
    loading: () => <FilterBarSkeleton />,
  },
);

const FinanceApprovalsBulkTable = dynamic(
  () =>
    import("@/modules/claims/ui/finance-approvals-bulk-table").then(
      (module) => module.FinanceApprovalsBulkTable,
    ),
  {
    loading: () => <TableSkeleton />,
  },
);

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
  if (value === "finance_closed" || value === "hod_action") {
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
  if (
    value === "claim_id" ||
    value === "employee_name" ||
    value === "employee_id" ||
    value === "employee_email"
  ) {
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

function normalizeAmountFilter(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
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
  const submittedFrom = normalizeDate(firstParamValue(searchParams?.adv_sub_from));
  const submittedTo = normalizeDate(firstParamValue(searchParams?.adv_sub_to));
  const hodActionFrom = normalizeDate(firstParamValue(searchParams?.adv_hod_from));
  const hodActionTo = normalizeDate(firstParamValue(searchParams?.adv_hod_to));
  const financeActionFrom = normalizeDate(firstParamValue(searchParams?.adv_fin_from));
  const financeActionTo = normalizeDate(firstParamValue(searchParams?.adv_fin_to));
  const minAmount = normalizeAmountFilter(firstParamValue(searchParams?.min_amt));
  const maxAmount = normalizeAmountFilter(firstParamValue(searchParams?.max_amt));
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
    submittedFrom,
    submittedTo,
    hodActionFrom,
    hodActionTo,
    financeActionFrom,
    financeActionTo,
    minAmount,
    maxAmount,
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

function FinanceTeamQueueBadge() {
  return (
    <span className="inline-flex w-fit rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      Finance Team
    </span>
  );
}

function MyClaimsShellSkeleton() {
  return (
    <>
      <div className="min-h-[140px]">
        <FilterBarSkeleton />
      </div>

      <section className="min-h-[600px] overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
        <div className="border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800">
          <div className="shimmer-sweep h-4 w-40 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        </div>
        <div className="space-y-3 p-5">
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
    <thead className="bg-zinc-50/80 text-[11px] uppercase tracking-[0.14em] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
      <tr>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">CLAIM ID</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">EMPLOYEE ID</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">EMPLOYEE NAME</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">DEPARTMENT</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">TYPE OF CLAIM</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">AMOUNT</th>
        <th
          className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} whitespace-nowrap px-3 py-2.5 font-semibold`}
        >
          STATUS
        </th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">SUBMITTED ON</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">HOD ACTION DATE</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">FINANCE ACTION DATE</th>
        {showActions ? (
          <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Review</th>
        ) : null}
      </tr>
    </thead>
  );
}

async function ClaimsCommandCenterTable({
  userId,
  view,
  approvalScope,
  viewerContext,
  searchParams,
  filters,
}: {
  userId: string;
  view: ViewMode;
  approvalScope: "l1" | "finance" | null;
  viewerContext: PendingApprovalsViewerContext;
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
      viewerContext,
    });

    const rows = approvalsResult.data;
    const claimIds = rows.map((claim) => claim.id);
    const approvalCurrentPage = cursor
      ? Math.max(1, Number(firstParamValue(searchParams?.page)) || 1)
      : 1;
    const approvalPageStart = rows.length > 0 ? (approvalCurrentPage - 1) * PAGE_SIZE + 1 : 0;
    const approvalPageEnd =
      rows.length > 0
        ? Math.min((approvalCurrentPage - 1) * PAGE_SIZE + rows.length, approvalsResult.totalCount)
        : 0;
    const approvalsSummaryText = `Showing ${approvalPageStart} to ${approvalPageEnd} of ${approvalsResult.totalCount} claims`;

    if (approvalScope === "finance" || approvalScope === "l1") {
      const [evidenceSignedUrlByClaimId, auditLogsByClaimId] = await Promise.all([
        resolveApprovalEvidenceUrls(claimRepository, rows),
        resolveAuditLogsByClaimId(claimRepository, claimIds),
      ]);

      return (
        <section className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
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
              <MyClaimsPaginationControls
                hasNextPage={approvalsResult.hasNextPage}
                hasPreviousPage={Boolean(previousCursorToken)}
                currentCursor={cursor}
                nextCursor={approvalsResult.nextCursor}
                previousCursor={previousCursorToken}
                currentPage={approvalCurrentPage}
                summaryText={approvalsSummaryText}
                position="top"
                searchParams={searchParams}
              />

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
                    formattedHodActionDate: claim.formattedHodActionDate,
                    formattedFinanceActionDate: claim.formattedFinanceActionDate,
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
      <section className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
        <div className="border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800">
          <p
            aria-hidden="true"
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400"
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
            <MyClaimsPaginationControls
              hasNextPage={approvalsResult.hasNextPage}
              hasPreviousPage={Boolean(previousCursorToken)}
              currentCursor={cursor}
              nextCursor={approvalsResult.nextCursor}
              previousCursor={previousCursorToken}
              currentPage={approvalCurrentPage}
              summaryText={approvalsSummaryText}
              position="top"
              searchParams={searchParams}
            />

            <div className="nxt-scroll w-full overflow-x-auto">
              <table className="min-w-345 divide-y divide-zinc-200/80 text-left text-sm dark:divide-zinc-800">
                <TableHeader showActions />
                <tbody className="divide-y divide-zinc-100/80 bg-white/50 text-xs text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
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
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                          <Link
                            href={ROUTES.claims.detail(claim.id)}
                            className="text-indigo-500 hover:text-indigo-400 hover:underline"
                          >
                            {claim.id}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span>{claim.employeeId}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-block max-w-[150px] truncate align-bottom">
                            {claim.submitter}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-block max-w-[130px] truncate align-bottom">
                            {claim.departmentName ?? "Unknown Department"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-block max-w-[140px] truncate align-bottom">
                            {claim.paymentModeName}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-100">
                          {claim.formattedTotalAmount}
                        </td>
                        <td className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} px-3 py-2 align-top`}>
                          <ClaimStatusBadge status={claim.status} fullWidth />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {claim.formattedSubmittedAt}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">N/A</td>
                        <td className="whitespace-nowrap px-3 py-2">N/A</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <div className="flex min-w-28 justify-end">
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
                              {actionMode !== "none" ? renderActions(false) : undefined}
                            </ApprovalsAuditModeDialog>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    );
  }

  const currentPage = Math.max(1, Number(firstParamValue(searchParams?.page)) || 1);

  const claimsResult = await claimsService.execute({
    userId,
    page: currentPage,
    limit: PAGE_SIZE,
    filters,
  });

  const rows = claimsResult.data;
  const claimIds = rows.map((claim) => claim.id);
  // All claim detail fields (submitter, category, purpose, file paths) are now
  // returned directly by getMyClaimsPaginated via the enriched view —
  // no secondary getClaimListDetails fetch needed.
  const [submissionAuditLogsByClaimId, submissionEvidenceSignedUrlByClaimId] = await Promise.all([
    resolveAuditLogsByClaimId(claimRepository, claimIds),
    resolveApprovalEvidenceUrls(
      claimRepository,
      rows.map((claim) => ({
        id: claim.id,
        expenseReceiptFilePath: claim.expenseReceiptFilePath,
        expenseBankStatementFilePath: claim.expenseBankStatementFilePath,
        advanceSupportingDocumentPath: claim.advanceSupportingDocumentPath,
      })),
    ),
  ]);

  return (
    <section className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
      <div className="border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          My Submissions
        </h2>
      </div>

      {claimsResult.errorMessage ? (
        <div className="px-4 py-6">
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Unable to load claims. {claimsResult.errorMessage}
          </p>
        </div>
      ) : claimsResult.totalCount === 0 ? (
        <div className="grid place-items-center px-4 py-14 text-center">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No claims found</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Submit a new claim to see it here.
          </p>
        </div>
      ) : (
        <>
          <MyClaimsOffsetPaginationControls
            totalCount={claimsResult.totalCount}
            page={currentPage}
            limit={PAGE_SIZE}
            position="top"
            searchParams={searchParams}
          />

          <div className="nxt-scroll overflow-x-auto">
            <table className="min-w-325 divide-y divide-zinc-200/80 text-left text-sm dark:divide-zinc-800">
              <TableHeader showActions />
              <tbody className="divide-y divide-zinc-100/80 bg-white/50 text-xs text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                {rows.map((claim) => {
                  const evidenceSignedUrls = submissionEvidenceSignedUrlByClaimId[claim.id] ?? {
                    expenseReceiptSignedUrl: null,
                    expenseBankStatementSignedUrl: null,
                    advanceSupportingDocumentSignedUrl: null,
                  };
                  const canDeleteClaim = isSubmitterDeletableClaimStatus(claim.status);

                  return (
                    <tr
                      key={claim.id}
                      className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                    >
                      <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                        <Link
                          href={ROUTES.claims.detail(claim.id)}
                          className="whitespace-nowrap text-indigo-500 hover:text-indigo-400 hover:underline"
                        >
                          {claim.id}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span>{claim.employeeId}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block max-w-[150px] truncate align-bottom">
                          {claim.employeeName}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block max-w-[130px] truncate align-bottom">
                          {claim.departmentName}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block max-w-[140px] truncate align-bottom">
                          {claim.typeOfClaim}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-100">
                        {claim.formattedTotalAmount}
                      </td>
                      <td className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} px-3 py-2 align-top`}>
                        <ClaimStatusBadge status={claim.status} fullWidth />
                      </td>
                      <td className="px-3 py-2">
                        <DateWithActor
                          dateValue={claim.submittedAt}
                          actorEmail={claim.submitterEmail}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <DateWithActor
                          dateValue={claim.hodActionDate}
                          actorEmail={claim.hodEmail}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {isPendingFinanceApprovalStatus(claim.status) ? (
                          <div className="flex flex-col gap-1">
                            <span>-</span>
                            <FinanceTeamQueueBadge />
                          </div>
                        ) : (
                          <DateWithActor
                            dateValue={claim.financeActionDate}
                            actorEmail={claim.financeEmail}
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canDeleteClaim ? <DeleteClaimButton claimId={claim.id} compact /> : null}
                          <ApprovalsAuditModeDialog
                            claimId={claim.id}
                            detailType={claim.detailType}
                            submitter={claim.submitterLabel ?? claim.employeeName}
                            amountLabel={claim.formattedTotalAmount}
                            categoryName={claim.categoryName ?? "Uncategorized"}
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
                            auditLogs={submissionAuditLogsByClaimId[claim.id] ?? []}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function FilterBarSkeleton() {
  return (
    <section className="rounded-[28px] border border-zinc-200/80 bg-white/92 p-5 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
      <div className="grid gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`filter-placeholder-${index}`} className="space-y-2">
            <div className="shimmer-sweep h-3 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-10 w-full rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="shimmer-sweep h-10 w-28 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        <div className="shimmer-sweep h-10 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
      </div>
    </section>
  );
}

async function FilterBarWithData({
  exportScope,
  defaultFiltersExpanded,
  showAdvancedFilters,
}: {
  exportScope: "submissions" | "approvals" | "admin" | "department";
  defaultFiltersExpanded: boolean;
  showAdvancedFilters?: boolean;
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
      isAdmin={showAdvancedFilters === true}
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
  activeView,
  viewerContextResult,
  userId,
}: {
  searchParams: Record<string, SearchParamsValue>;
  activeView: ViewMode;
  viewerContextResult: {
    canViewApprovals: boolean;
    activeScope: "l1" | "finance" | null;
    errorMessage: string | null;
  };
  userId: string;
}) {
  const resolvedSearchParams = searchParams;

  const filters = buildClaimFilters(resolvedSearchParams);

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
          showAdvancedFilters={viewerContextResult.activeScope === "finance"}
        />
      </Suspense>

      {activeView === "approvals" ? (
        <h2 className="sr-only" aria-label="Approvals History">
          Approvals History
        </h2>
      ) : null}

      <Suspense key={JSON.stringify(resolvedSearchParams)} fallback={<TableSkeleton />}>
        <ClaimsCommandCenterTable
          userId={userId}
          view={activeView}
          approvalScope={viewerContextResult.activeScope}
          viewerContext={viewerContextResult}
          searchParams={resolvedSearchParams}
          filters={filters}
        />
      </Suspense>
    </>
  );
}

async function MyClaimsDashboardResolvedContent({
  searchParams,
  userId,
}: {
  searchParams: Record<string, SearchParamsValue>;
  userId: string;
}) {
  const [isAdminUser, isDeptViewer, viewerContextResult] = await Promise.all([
    isAdmin(),
    isDepartmentViewer(),
    getCachedPendingApprovalsViewerContext(userId),
  ]);

  const requestedView = firstParamValue(searchParams?.view);
  const requestedOrDefaultView =
    !requestedView && viewerContextResult.canViewApprovals && !isAdminUser
      ? "approvals"
      : requestedView;

  const activeView = resolveView(
    requestedOrDefaultView,
    viewerContextResult.canViewApprovals,
    isAdminUser,
    isDeptViewer,
  );

  const submissionsHref = buildViewHref(searchParams, "submissions");
  const approvalsHref = buildViewHref(searchParams, "approvals");
  const adminHref = buildViewHref(searchParams, "admin");
  const departmentHref = buildViewHref(searchParams, "department");

  return (
    <>
      <section className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-white/88 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.14),0_8px_24px_-8px_rgba(99,102,241,0.05)] backdrop-blur-lg transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/88 dark:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.40)]">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />

        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="dashboard-font-display text-xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-2xl lg:text-3xl dark:text-zinc-50">
                My Claims
              </h1>
              <p className="mt-1 text-xs text-zinc-500 sm:text-sm dark:text-zinc-400">
                Command Center for submissions and approvals
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isAdminUser ? (
                <Link
                  href={ROUTES.admin.settings}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-4 text-sm font-semibold text-zinc-700 backdrop-blur-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  System Settings
                </Link>
              ) : null}
              <Link
                href={ROUTES.claims.new}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-colors hover:bg-indigo-500 active:scale-[0.98]"
              >
                <CirclePlus className="h-4 w-4" aria-hidden="true" />
                New Claim
              </Link>
            </div>
          </div>

          <div className="mt-4 inline-flex flex-wrap rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-1 dark:border-zinc-700/60 dark:bg-zinc-900/60">
            <Link
              href={submissionsHref}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                activeView === "submissions"
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 dark:bg-indigo-500"
                  : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              My Submissions
            </Link>
            {viewerContextResult.canViewApprovals ? (
              <Link
                href={approvalsHref}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  activeView === "approvals"
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 dark:bg-indigo-500"
                    : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                Approvals History
              </Link>
            ) : null}
            {isAdminUser ? (
              <Link
                href={adminHref}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  activeView === "admin"
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 dark:bg-indigo-500"
                    : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                Admin Overview
              </Link>
            ) : null}
            {isDeptViewer ? (
              <Link
                href={departmentHref}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  activeView === "department"
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 dark:bg-indigo-500"
                    : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                Department Overview
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <Suspense fallback={<MyClaimsShellSkeleton />}>
        <MyClaimsDashboardPageContent
          searchParams={searchParams}
          activeView={activeView}
          viewerContextResult={viewerContextResult}
          userId={userId}
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
  const [resolvedSearchParams, currentUserResult] = await Promise.all([
    searchParams,
    getCachedCurrentUser(),
  ]);

  const currentEmail = currentUserResult.user?.email ?? null;

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
    >
      <AppShellHeader currentEmail={currentEmail} />

      <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <main className="space-y-5">
          <BackButton className="w-fit" />

          <Suspense fallback={<MyClaimsShellSkeleton />}>
            <MyClaimsDashboardResolvedContent
              searchParams={resolvedSearchParams}
              userId={currentUserResult.user.id}
            />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
