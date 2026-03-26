import Link from "next/link";
import { redirect } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
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
import { FinanceApprovalsBulkTable } from "@/modules/claims/ui/finance-approvals-bulk-table";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { ApprovalsAuditModeDialog } from "@/modules/claims/ui/approvals-quick-view-sheet";
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

  if (value === "submissions") {
    return "submissions";
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

  if (targetView === "approvals") {
    params.set("view", "approvals");
  } else {
    params.set("view", "submissions");
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

async function resolveAuditLogsByClaimId(
  claimRepository: SupabaseClaimRepository,
  claimIds: string[],
): Promise<Record<string, ClaimAuditLogRecord[]>> {
  const entries = await Promise.all(
    claimIds.map(async (claimId) => {
      const result = await claimRepository.getClaimAuditLogs(claimId);

      if (result.errorMessage) {
        return [claimId, []] as const;
      }

      return [claimId, result.data] as const;
    }),
  );

  return Object.fromEntries(entries);
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

    if (approvalScope === "finance" || approvalScope === "l1") {
      const totalCount =
        approvalScope === "finance"
          ? claimRepository.getFinancePendingApprovalsCount(userId, filters)
          : claimRepository.getL1PendingApprovalsCount(userId, filters);

      const resolvedTotalCount = await totalCount;
      const evidenceSignedUrlByClaimId = await resolveApprovalEvidenceUrls(claimRepository, rows);
      const auditLogsByClaimId = await resolveAuditLogsByClaimId(
        claimRepository,
        rows.map((claim) => claim.id),
      );

      return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          {approvalsResult.errorMessage ? (
            <div className="px-4 py-6">
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                Unable to load approvals history. {approvalsResult.errorMessage}
              </p>
            </div>
          ) : rows.length === 0 ? (
            <>
              <div className="grid place-items-center px-4 py-14 text-center">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  No approvals history found.
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                  Claims routed to your approval scope will appear here.
                </p>
              </div>
            </>
          ) : (
            <>
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
                  totalAmount: claim.totalAmount,
                  status: claim.status,
                  submittedAt: claim.submittedAt,
                  hodActionDate: null,
                  financeActionDate: null,
                }))}
                totalSelectableCount={
                  resolvedTotalCount.errorMessage ? rows.length : resolvedTotalCount.count
                }
                filters={filters}
                approvalScope={approvalScope}
                evidenceSignedUrlByClaimId={evidenceSignedUrlByClaimId}
                auditLogsByClaimId={auditLogsByClaimId}
              />

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

    const evidenceSignedUrlByClaimId = await resolveApprovalEvidenceUrls(claimRepository, rows);
    const auditLogsByClaimId = await resolveAuditLogsByClaimId(
      claimRepository,
      rows.map((claim) => claim.id),
    );
    const gatedStatuses = {
      l1: DB_CLAIM_STATUSES[0],
      finance: DB_CLAIM_STATUSES[1],
    };

    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <p
            aria-hidden="true"
            className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300"
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
              <table className="min-w-[1720px] divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
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
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                          {formatAmount(claim.totalAmount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <ClaimStatusBadge status={claim.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatDate(claim.submittedAt)}
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
  const submissionDetailEntries = await Promise.all(
    rows.map(async (claim) => {
      const detailResult = await claimRepository.getClaimDetailById(claim.id);
      return [claim.id, detailResult.data] as const;
    }),
  );
  const submissionDetailsByClaimId = Object.fromEntries(submissionDetailEntries);
  const submissionEvidenceSignedUrlByClaimId = await resolveApprovalEvidenceUrls(
    claimRepository,
    rows.map((claim) => {
      const detail = submissionDetailsByClaimId[claim.id];

      return {
        id: claim.id,
        expenseReceiptFilePath: detail?.expense?.receiptFilePath ?? null,
        expenseBankStatementFilePath: detail?.expense?.bankStatementFilePath ?? null,
        advanceSupportingDocumentPath: detail?.advance?.supportingDocumentPath ?? null,
      };
    }),
  );
  const submissionAuditLogsByClaimId = await resolveAuditLogsByClaimId(
    claimRepository,
    rows.map((claim) => claim.id),
  );

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
            <table className="min-w-[1500px] divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
              <TableHeader showActions />
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700 dark:divide-slate-900 dark:bg-zinc-950 dark:text-slate-300">
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
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                        {formatAmount(claim.totalAmount)}
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
                              amountLabel={formatAmount(claim.totalAmount)}
                              categoryName={claim.typeOfClaim}
                              purpose={detail.expense?.purpose ?? detail.advance?.purpose ?? null}
                              submissionType={detail.submissionType}
                              onBehalfEmail={detail.onBehalfEmail}
                              expenseReceiptFilePath={detail.expense?.receiptFilePath ?? null}
                              expenseReceiptSignedUrl={evidenceSignedUrls.expenseReceiptSignedUrl}
                              expenseBankStatementFilePath={
                                detail.expense?.bankStatementFilePath ?? null
                              }
                              expenseBankStatementSignedUrl={
                                evidenceSignedUrls.expenseBankStatementSignedUrl
                              }
                              advanceSupportingDocumentPath={
                                detail.advance?.supportingDocumentPath ?? null
                              }
                              advanceSupportingDocumentSignedUrl={
                                evidenceSignedUrls.advanceSupportingDocumentSignedUrl
                              }
                              auditLogs={submissionAuditLogsByClaimId[claim.id] ?? []}
                            />
                          ) : (
                            <Link
                              href={ROUTES.claims.detail(claim.id)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-zinc-900 dark:text-slate-200 dark:hover:bg-zinc-800"
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
    redirect(ROUTES.login);
  }

  const resolvedSearchParams = await searchParams;
  const filters = buildClaimFilters(resolvedSearchParams);

  const viewerContextResult = await pendingApprovalsService.getViewerContext({
    userId: currentUserResult.user.id,
  });
  const currentEmail = currentUserResult.user.email ?? "Unknown User";
  const canViewApprovals = viewerContextResult.canViewApprovals;
  const requestedView = firstParamValue(resolvedSearchParams?.view);

  if (canViewApprovals && !requestedView) {
    redirect(buildViewHref(resolvedSearchParams, "approvals"));
  }

  const activeView = resolveView(requestedView, canViewApprovals);
  const submissionsHref = buildViewHref(resolvedSearchParams, "submissions");
  const approvalsHref = buildViewHref(resolvedSearchParams, "approvals");

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

        <ClaimsFilterBar
          exportScope={activeView}
          defaultFiltersExpanded={viewerContextResult.activeScope === "finance"}
          paymentModes={paymentModes}
          departments={departments}
          locations={locations}
          products={products}
          expenseCategories={expenseCategories}
        />

        {activeView === "approvals" ? (
          <h2 className="sr-only" aria-label="Approvals History">
            Approvals History
          </h2>
        ) : null}

        <ClaimsCommandCenterTable
          userId={currentUserResult.user.id}
          view={activeView}
          approvalScope={viewerContextResult.activeScope}
          searchParams={resolvedSearchParams}
          filters={filters}
        />
      </main>
    </div>
  );
}
