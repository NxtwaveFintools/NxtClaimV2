import Link from "next/link";
import { Suspense } from "react";
import { BackButton } from "@/components/ui/back-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import type {
  ClaimDateTarget,
  ClaimDetailType,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { GetMyClaimsPaginatedService } from "@/core/domain/claims/GetMyClaimsPaginatedService";
import { GetPendingApprovalsService } from "@/core/domain/claims/GetPendingApprovalsService";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import {
  approveClaimAction,
  approveFinanceAction,
  markPaymentDoneAction,
  rejectClaimAction,
  rejectFinanceAction,
} from "@/modules/claims/actions";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { ClaimDecisionActionForm } from "@/modules/claims/ui/claim-decision-action-form";
import { ClaimRejectWithReasonForm } from "@/modules/claims/ui/claim-reject-with-reason-form";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import { ClaimsFilterBar } from "@/modules/claims/ui/claims-filter-bar";
import { ClaimsTableSkeleton } from "@/modules/claims/ui/claims-table-skeleton";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { ApprovalsQuickViewSheet } from "@/modules/claims/ui/approvals-quick-view-sheet";
import { ClaimSemanticDownloadButton } from "@/modules/claims/ui/claim-semantic-download-button";

const PAGE_SIZE = 10;

type SearchParamsValue = string | string[] | undefined;
type ViewMode = "submissions" | "approvals";

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

function resolveView(value: string | undefined, canViewApprovals: boolean): ViewMode {
  if (value === "approvals" && canViewApprovals) {
    return "approvals";
  }

  return "submissions";
}

function normalizeDetailType(value: string | undefined): ClaimDetailType | undefined {
  if (value === "expense" || value === "advance") {
    return value;
  }

  return undefined;
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
  const detailType = normalizeDetailType(firstParamValue(searchParams?.detail_type));
  const submissionType = normalizeSubmissionType(firstParamValue(searchParams?.submission_type));
  const status = normalizeStatusFilter(firstParamValue(searchParams?.status));
  const dateTarget = normalizeDateTarget(firstParamValue(searchParams?.date_target));
  const dateFrom = normalizeDate(firstParamValue(searchParams?.from));
  const dateTo = normalizeDate(firstParamValue(searchParams?.to));
  const searchField = normalizeSearchField(firstParamValue(searchParams?.search_field));
  const paymentModeId = normalizePaymentModeId(firstParamValue(searchParams?.payment_mode_id));
  const rawSearchQuery = firstParamValue(searchParams?.search_query)?.trim();
  const searchQuery = rawSearchQuery ? rawSearchQuery : undefined;

  return {
    paymentModeId,
    detailType,
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

  if (targetView === "approvals") {
    params.set("view", "approvals");
  } else {
    params.delete("view");
  }

  const query = params.toString();
  return query ? `${ROUTES.claims.myClaims}?${query}` : ROUTES.claims.myClaims;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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
  const signedEntries = await Promise.all(
    rows.map(async (row) => {
      const [
        expenseReceiptSignedUrl,
        expenseBankStatementSignedUrl,
        advanceSupportingDocumentSignedUrl,
      ] = await Promise.all([
        isRenderableEvidencePath(row.expenseReceiptFilePath)
          ? claimRepository
              .getClaimEvidenceSignedUrl({
                filePath: row.expenseReceiptFilePath,
                expiresInSeconds: 60 * 10,
              })
              .then((result) => {
                if (result.errorMessage) {
                  return null;
                }

                return result.data;
              })
              .catch(() => null)
          : Promise.resolve(null),
        isRenderableEvidencePath(row.expenseBankStatementFilePath)
          ? claimRepository
              .getClaimEvidenceSignedUrl({
                filePath: row.expenseBankStatementFilePath,
                expiresInSeconds: 60 * 10,
              })
              .then((result) => {
                if (result.errorMessage) {
                  return null;
                }

                return result.data;
              })
              .catch(() => null)
          : Promise.resolve(null),
        isRenderableEvidencePath(row.advanceSupportingDocumentPath)
          ? claimRepository
              .getClaimEvidenceSignedUrl({
                filePath: row.advanceSupportingDocumentPath,
                expiresInSeconds: 60 * 10,
              })
              .then((result) => {
                if (result.errorMessage) {
                  return null;
                }

                return result.data;
              })
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      return [
        row.id,
        {
          expenseReceiptSignedUrl,
          expenseBankStatementSignedUrl,
          advanceSupportingDocumentSignedUrl,
        },
      ] as const;
    }),
  );

  return Object.fromEntries(signedEntries);
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
    <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-900/50 dark:text-slate-400">
      <tr>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">Claim ID</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">Employee</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">Dept</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">Request Type</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">Amount</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">Status</th>
        <th className="whitespace-nowrap px-4 py-3 font-semibold">Submitted On</th>
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
    const evidenceSignedUrlByClaimId = await resolveApprovalEvidenceUrls(claimRepository, rows);
    const gatedStatuses = {
      l1: DB_CLAIM_STATUSES[0],
      finance: DB_CLAIM_STATUSES[1],
    };

    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300">
            Approvals History
          </h2>
        </div>

        {approvalsResult.errorMessage ? (
          <div className="px-4 py-6">
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              Unable to load approvals history. {approvalsResult.errorMessage}
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center px-4 py-14 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No approvals history found.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
              Claims routed to your approval scope will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="w-full overflow-x-auto">
              <table className="min-w-[1200px] divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
                <TableHeader showActions />
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700 dark:divide-slate-900 dark:bg-zinc-950 dark:text-slate-300">
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
                      await rejectClaimAction({ claimId: claim.id, rejectionReason });
                    };

                    const approveFinanceFromList = async () => {
                      "use server";
                      await approveFinanceAction({ claimId: claim.id });
                    };

                    const rejectFinanceFromList = async (formData: FormData) => {
                      "use server";
                      const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
                      await rejectFinanceAction({ claimId: claim.id, rejectionReason });
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
                        <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                          No actions
                        </span>
                      );
                    };

                    return (
                      <tr
                        key={claim.id}
                        className="group transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                          <Link
                            href={ROUTES.claims.detail(claim.id)}
                            className="text-indigo-500 hover:text-indigo-400 hover:underline"
                          >
                            {claim.id}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{claim.submitter}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {claim.departmentName ?? "Unknown Department"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{claim.paymentModeName}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                          {formatAmount(claim.totalAmount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <ClaimStatusBadge status={claim.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatDate(claim.submittedAt)}
                        </td>
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
                            <ApprovalsQuickViewSheet
                              claimId={claim.id}
                              detailType={claim.detailType}
                              submitter={claim.submitter}
                              amountLabel={formatAmount(claim.totalAmount)}
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
                            >
                              {renderActions(false)}
                            </ApprovalsQuickViewSheet>
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

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300">
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
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No claims found</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
            Submit a new claim to see it here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
              <TableHeader showActions={false} />
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700 dark:divide-slate-900 dark:bg-zinc-950 dark:text-slate-300">
                {rows.map((claim) => (
                  <tr
                    key={claim.id}
                    className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      <Link
                        href={ROUTES.claims.detail(claim.id)}
                        className="text-indigo-500 hover:text-indigo-400 hover:underline"
                      >
                        {claim.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{claim.submitter}</td>
                    <td className="px-4 py-3">{claim.departmentName ?? "Unknown Department"}</td>
                    <td className="px-4 py-3">{claim.paymentModeName}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {formatAmount(claim.totalAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <ClaimStatusBadge status={claim.status} />
                    </td>
                    <td className="px-4 py-3">{formatDate(claim.submittedAt)}</td>
                  </tr>
                ))}
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

export default async function MyClaimsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}) {
  const authRepository = new SupabaseServerAuthRepository();
  const claimRepository = new SupabaseClaimRepository();
  const pendingApprovalsService = new GetPendingApprovalsService({
    repository: claimRepository,
    logger,
  });

  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
        <main className="mx-auto max-w-6xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm transition-colors dark:border-rose-900/40 dark:bg-zinc-950">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">My Claims</h1>
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Unable to authenticate your session.{" "}
            {currentUserResult.errorMessage ?? "Please log in again."}
          </p>
          <Link
            href={ROUTES.login}
            className="mt-4 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-slate-700 active:scale-[0.98] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Go to Login
          </Link>
        </main>
      </div>
    );
  }

  const resolvedSearchParams = await searchParams;
  const filters = buildClaimFilters(resolvedSearchParams);

  const viewerContextResult = await pendingApprovalsService.getViewerContext({
    userId: currentUserResult.user.id,
  });
  const currentEmail = currentUserResult.user.email ?? "Unknown User";
  const canViewApprovals = viewerContextResult.canViewApprovals;
  const activeView = resolveView(firstParamValue(resolvedSearchParams?.view), canViewApprovals);

  const paymentModesResult = await claimRepository.getActivePaymentModes();
  const paymentModes = paymentModesResult.data.map((mode) => ({ id: mode.id, name: mode.name }));

  const submissionsHref = buildViewHref(resolvedSearchParams, "submissions");
  const approvalsHref = buildViewHref(resolvedSearchParams, "approvals");

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <BackButton className="w-fit" />
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
                My Claims
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Command Center for submissions and approvals
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex max-w-[220px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {currentEmail}
              </span>
              <ThemeToggle />
              <Link
                href={ROUTES.claims.new}
                className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
              >
                + New Claim
              </Link>
            </div>
          </div>

          {canViewApprovals ? (
            <div className="mt-4 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60">
              <Link
                href={submissionsHref}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  activeView === "submissions"
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                My Submissions
              </Link>
              <Link
                href={approvalsHref}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] ${
                  activeView === "approvals"
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                Approvals History
              </Link>
            </div>
          ) : null}
        </section>

        <ClaimsFilterBar exportScope={activeView} paymentModes={paymentModes} />

        <Suspense fallback={<ClaimsTableSkeleton />}>
          <ClaimsCommandCenterTable
            userId={currentUserResult.user.id}
            view={activeView}
            approvalScope={viewerContextResult.activeScope}
            searchParams={resolvedSearchParams}
            filters={filters}
          />
        </Suspense>
      </main>
    </div>
  );
}
