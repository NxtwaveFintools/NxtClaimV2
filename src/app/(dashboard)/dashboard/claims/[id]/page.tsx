import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { AppShellHeader } from "@/components/app-shell-header";
import { BackButton } from "@/components/ui/back-button";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import {
  approveClaimAction,
  approveFinanceAction,
  markPaymentDoneAction,
  rejectClaimAction,
  rejectFinanceAction,
  updateClaimByFinanceAction,
} from "@/modules/claims/actions";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { ClaimRejectWithReasonForm } from "@/modules/claims/ui/claim-reject-with-reason-form";
import { ClaimDecisionActionForm } from "@/modules/claims/ui/claim-decision-action-form";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import { ClaimAuditTimeline } from "@/modules/claims/ui/claim-audit-timeline";
import { formatDate, formatDateTime } from "@/lib/format";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";
import {
  getAvailableClaimActions,
  type ClaimActionRole,
} from "@/modules/claims/utils/get-available-claim-actions";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { getViewerDepartmentIds } from "@/modules/claims/server/is-department-viewer";
import { AdminSoftDeletePanel } from "@/modules/admin/ui/admin-soft-delete-panel";

const FinanceEditClaimForm = dynamic(
  () =>
    import("@/modules/claims/ui/finance-edit-claim-form").then((mod) => mod.FinanceEditClaimForm),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
    ),
  },
);

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
};

type EvidenceItem = {
  label: string;
  path: string;
  signedUrl: string;
};

type EvidencePath = {
  label: string;
  path: string;
};

type ClaimDetailRecord = NonNullable<
  Awaited<ReturnType<SupabaseClaimRepository["getClaimDetailById"]>>["data"]
>;

const indiaAmountFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(amount: number | null): string {
  if (amount === null) {
    return "N/A";
  }

  return indiaAmountFormatter.format(amount);
}

function formatOptionalText(value: string | null | undefined, fallback = "N/A"): string {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

function isRenderableEvidencePath(path: string | null | undefined): path is string {
  return Boolean(path && path.trim() !== "" && path !== "N/A");
}

function buildEvidencePaths(
  receiptFilePath: string | null | undefined,
  bankStatementFilePath: string | null | undefined,
  supportingDocumentPath: string | null | undefined,
): EvidencePath[] {
  const evidencePaths: EvidencePath[] = [];

  if (isRenderableEvidencePath(receiptFilePath)) {
    evidencePaths.push({ label: "Receipt", path: receiptFilePath });
  }

  if (isRenderableEvidencePath(bankStatementFilePath)) {
    evidencePaths.push({ label: "Bank Statement", path: bankStatementFilePath });
  }

  if (isRenderableEvidencePath(supportingDocumentPath)) {
    evidencePaths.push({
      label: "Supporting Document",
      path: supportingDocumentPath,
    });
  }

  return evidencePaths;
}

function ClaimDetailContentSkeleton() {
  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded-md bg-muted/60" />
            <div className="h-8 w-48 animate-pulse rounded-md bg-muted/60" />
            <div className="h-4 w-56 animate-pulse rounded-md bg-muted/60" />
          </div>
          <div className="h-7 w-32 animate-pulse rounded-md bg-muted/60" />
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <article
              key={`skel-meta-1-${index}`}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
              <div className="mt-2 h-4 w-32 animate-pulse rounded-md bg-muted/60" />
            </article>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <article
              key={`skel-meta-2-${index}`}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
              <div className="mt-2 h-4 w-36 animate-pulse rounded-md bg-muted/60" />
            </article>
          ))}
        </div>
        <section className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="h-4 w-32 animate-pulse rounded-md bg-muted/60" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`skel-detail-${index}`}
                className="h-4 w-full animate-pulse rounded-md bg-muted/60"
              />
            ))}
          </div>
        </section>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="h-4 w-36 animate-pulse rounded-md bg-muted/60" />
        <div className="mt-4 h-[460px] w-full animate-pulse rounded-lg bg-muted/60" />
      </section>
    </>
  );
}

function ClaimAuditHistorySkeleton() {
  return (
    <section className="mt-6 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="h-4 w-28 animate-pulse rounded-md bg-muted/60" />
      <div className="mt-4 space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`audit-skel-${index}`} className="space-y-2">
            <div className="h-3 w-36 animate-pulse rounded-md bg-muted/60" />
            <div className="h-4 w-52 animate-pulse rounded-md bg-muted/60" />
            <div className="h-3 w-64 animate-pulse rounded-md bg-muted/60" />
          </div>
        ))}
      </div>
    </section>
  );
}

async function FinanceEditClaimSection({ claim }: { claim: ClaimDetailRecord }) {
  const claimRepository = new SupabaseClaimRepository();

  const [
    productsResult,
    departmentsResult,
    paymentModesResult,
    expenseCategoriesResult,
    locationsResult,
  ] = await Promise.all([
    claimRepository.getActiveProducts(),
    claimRepository.getActiveDepartments(),
    claimRepository.getActivePaymentModes(),
    claimRepository.getActiveExpenseCategories(),
    claimRepository.getActiveLocations(),
  ]);

  const productOptions = productsResult.errorMessage ? [] : productsResult.data;
  const departmentOptions = departmentsResult.errorMessage ? [] : departmentsResult.data;
  const paymentModeOptions = paymentModesResult.errorMessage
    ? []
    : paymentModesResult.data.map((mode) => ({ id: mode.id, name: mode.name }));
  const expenseCategoryOptions = expenseCategoriesResult.errorMessage
    ? []
    : expenseCategoriesResult.data;
  const locationOptions = locationsResult.errorMessage ? [] : locationsResult.data;

  const updateFinanceDetailFromPage = async (formData: FormData) => {
    "use server";
    const result = await updateClaimByFinanceAction({ claimId: claim.id, formData });

    if (!result.ok) {
      throw new Error(result.message ?? "Unable to update claim details.");
    }
  };

  return (
    <FinanceEditClaimForm
      claim={{
        id: claim.id,
        employeeName: claim.submitterName ?? claim.submitter,
        employeeEmail: claim.submitterEmail,
        detailType: claim.detailType,
        submissionType: claim.submissionType,
        departmentId: claim.departmentId,
        paymentModeId: claim.paymentModeId,
        expense: claim.expense
          ? {
              billNo: claim.expense.billNo,
              expenseCategoryId: claim.expense.expenseCategoryId,
              locationId: claim.expense.locationId,
              transactionDate: claim.expense.transactionDate,
              isGstApplicable: claim.expense.isGstApplicable,
              gstNumber: claim.expense.gstNumber,
              basicAmount: claim.expense.basicAmount,
              cgstAmount: claim.expense.cgstAmount,
              sgstAmount: claim.expense.sgstAmount,
              igstAmount: claim.expense.igstAmount,
              totalAmount: claim.expense.totalAmount,
              vendorName: claim.expense.vendorName,
              purpose: claim.expense.purpose,
              productId: claim.expense.productId,
              peopleInvolved: claim.expense.peopleInvolved,
              remarks: claim.expense.remarks,
            }
          : null,
        advance: claim.advance
          ? {
              purpose: claim.advance.purpose,
              requestedAmount: claim.advance.requestedAmount,
              expectedUsageDate: claim.advance.expectedUsageDate,
              productId: claim.advance.productId,
              locationId: claim.advance.locationId,
              remarks: claim.advance.remarks,
            }
          : null,
      }}
      departments={departmentOptions}
      paymentModes={paymentModeOptions}
      expenseCategories={expenseCategoryOptions}
      products={productOptions}
      locations={locationOptions}
      action={updateFinanceDetailFromPage}
    />
  );
}

function EvidenceGallerySkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
      <div className="h-4 w-36 animate-pulse rounded-md bg-muted/60" />
      <div className="mt-4 space-y-6">
        <div className="h-[240px] w-full animate-pulse rounded-xl bg-muted/60" />
        <div className="h-[240px] w-full animate-pulse rounded-xl bg-muted/60" />
      </div>
    </section>
  );
}

function FinanceEditClaimSkeleton() {
  return (
    <section className="mt-6 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="h-4 w-40 animate-pulse rounded-md bg-muted/60" />
      <div className="mt-4 h-[420px] w-full animate-pulse rounded-xl bg-muted/60" />
    </section>
  );
}

async function ClaimDetailBackButton({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const viewParam = Array.isArray(resolvedSearchParams.view)
    ? resolvedSearchParams.view[0]
    : resolvedSearchParams.view;
  const backHref =
    viewParam === "approvals" ? `${ROUTES.claims.myClaims}?view=approvals` : ROUTES.claims.myClaims;

  return <BackButton className="w-fit" fallbackHref={backHref} />;
}

async function ClaimAuditHistorySection({ claimId }: { claimId: string }) {
  const claimRepository = new SupabaseClaimRepository();
  const claimAuditLogsResult = await claimRepository.getClaimAuditLogs(claimId);
  const claimAuditLogs = claimAuditLogsResult.errorMessage
    ? []
    : claimAuditLogsResult.data.map((log) => ({
        ...log,
        formattedCreatedAt: formatDateTime(log.createdAt),
      }));

  return (
    <section className="mt-6">
      <ClaimAuditTimeline logs={claimAuditLogs} />
      {claimAuditLogsResult.errorMessage ? (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
          Unable to load complete audit history. {claimAuditLogsResult.errorMessage}
        </p>
      ) : null}
    </section>
  );
}

async function EvidenceGallerySection({ evidencePaths }: { evidencePaths: EvidencePath[] }) {
  const claimRepository = new SupabaseClaimRepository();
  const validItems = evidencePaths.filter((item) => isRenderableEvidencePath(item.path));

  let evidenceItems: EvidenceItem[] = [];
  let evidenceErrorMessage: string | null = null;

  if (validItems.length > 0) {
    const uniquePaths = Array.from(new Set(validItems.map((item) => item.path)));
    const signedUrlsResult = await claimRepository.createBulkSignedUrls({
      filePaths: uniquePaths,
      expiresInSeconds: 60 * 10,
    });

    if (signedUrlsResult.errorMessage) {
      evidenceErrorMessage = signedUrlsResult.errorMessage;
    } else {
      evidenceItems = validItems
        .map((item) => {
          const signedUrl = signedUrlsResult.data[item.path];
          if (!signedUrl) {
            return null;
          }

          return {
            label: item.label,
            path: item.path,
            signedUrl,
          };
        })
        .filter((item): item is EvidenceItem => item !== null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300">
        Evidence Gallery
      </h2>
      {evidenceItems.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          {evidenceErrorMessage
            ? `Unable to load evidence files right now. ${evidenceErrorMessage}`
            : "No evidence files attached to this claim."}
        </p>
      ) : (
        <div className="mt-4 flex w-full flex-col gap-6">
          {evidenceItems.map((item) => (
            <article
              key={item.path}
              className="w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
            >
              <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                  {item.label}
                </p>
                <a
                  href={item.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Open in New Tab
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </header>
              <div className="w-full bg-slate-950/40 p-2 sm:p-3">
                {isPdf(item.path) ? (
                  <iframe
                    title={item.label}
                    src={item.signedUrl}
                    className="h-[70vh] min-h-[420px] w-full rounded-lg border border-slate-800 md:min-h-[600px]"
                  />
                ) : (
                  <div className="flex h-[70vh] min-h-[420px] w-full items-center justify-center rounded-lg border border-slate-800 bg-slate-950/40 p-2 md:min-h-[600px]">
                    <Image
                      src={item.signedUrl}
                      alt={item.label}
                      width={1800}
                      height={2200}
                      unoptimized
                      className="h-full w-full object-contain"
                    />
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

async function ClaimDetailCore({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const claimId = resolvedParams.id;
  const claimRepository = new SupabaseClaimRepository();

  const [currentUserResult, claimResult, isAdminUser] = await Promise.all([
    getCachedCurrentUser(),
    claimRepository.getClaimDetailById(claimId),
    isAdmin(),
  ]);

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return (
      <section className="mx-auto max-w-5xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm transition-colors dark:border-rose-900/40 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Claim Detail</h1>
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
      </section>
    );
  }

  if (claimResult.errorMessage) {
    return (
      <section className="mx-auto max-w-5xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm transition-colors dark:border-rose-900/40 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Claim Detail</h1>
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          Unable to load claim detail. {claimResult.errorMessage}
        </p>
        <Link
          href={`${ROUTES.claims.myClaims}?view=approvals`}
          className="mt-4 inline-flex text-sm font-medium text-indigo-500 hover:text-indigo-400"
        >
          Back to approvals
        </Link>
      </section>
    );
  }

  if (!claimResult.data) {
    notFound();
  }

  const claim = claimResult.data;
  const currentUserId = currentUserResult.user.id;
  const evidencePaths = buildEvidencePaths(
    claim.expense?.receiptFilePath,
    claim.expense?.bankStatementFilePath,
    claim.advance?.supportingDocumentPath,
  );
  const [financeApproverIdsResult, viewerDeptIds] = await Promise.all([
    claimRepository.getFinanceApproverIdsForUser(currentUserId),
    getViewerDepartmentIds(currentUserId),
  ]);

  const isFinanceActor =
    !financeApproverIdsResult.errorMessage && financeApproverIdsResult.data.length > 0;
  const isAssignedL1Approver = currentUserId === claim.assignedL1ApproverId;
  const isAssignedL2Approver = currentUserId === claim.assignedL2ApproverId;
  const isDepartmentViewerForClaim =
    claim.departmentId != null && viewerDeptIds.includes(claim.departmentId);
  const canViewAsFinance = isFinanceActor && claim.status !== DB_CLAIM_STATUSES[0];
  const canView =
    currentUserId === claim.submittedBy ||
    currentUserId === claim.onBehalfOfId ||
    isAssignedL1Approver ||
    isAssignedL2Approver ||
    canViewAsFinance ||
    isDepartmentViewerForClaim;
  const canEditByFinance = isFinanceActor;
  const isDeptViewerOnly =
    isDepartmentViewerForClaim &&
    currentUserId !== claim.submittedBy &&
    !isAssignedL1Approver &&
    !isFinanceActor &&
    !isAdminUser;

  if (!canView && !isAdminUser) {
    notFound();
  }

  const effectiveRole: ClaimActionRole | null = isAssignedL1Approver
    ? "HOD"
    : isFinanceActor
      ? "Finance"
      : null;
  const availableActions = effectiveRole
    ? getAvailableClaimActions(claim.status, effectiveRole)
    : { canApprove: false, canReject: false, canMarkPaid: false };
  const canTakeL1Decision =
    effectiveRole === "HOD" && availableActions.canApprove && availableActions.canReject;
  const canTakeFinanceAuthorizationDecision =
    effectiveRole === "Finance" && availableActions.canApprove && availableActions.canReject;
  const canTakeFinanceExecutionDecision =
    effectiveRole === "Finance" && availableActions.canMarkPaid;
  const canTakeDecision =
    canTakeL1Decision || canTakeFinanceAuthorizationDecision || canTakeFinanceExecutionDecision;

  const approveFromDetail = async () => {
    "use server";
    await approveClaimAction({ claimId: claim.id });
  };

  const rejectFromDetail = async (formData: FormData) => {
    "use server";
    const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
    const allowResubmission = formData.get("allowResubmission") === "true";
    await rejectClaimAction({
      claimId: claim.id,
      rejectionReason,
      allowResubmission,
    });
  };

  const approveFinanceFromDetail = async () => {
    "use server";
    await approveFinanceAction({ claimId: claim.id });
  };

  const rejectFinanceFromDetail = async (formData: FormData) => {
    "use server";
    const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
    const allowResubmission = formData.get("allowResubmission") === "true";
    await rejectFinanceAction({
      claimId: claim.id,
      rejectionReason,
      allowResubmission,
    });
  };

  const markPaidFromDetail = async () => {
    "use server";
    await markPaymentDoneAction({ claimId: claim.id });
  };

  const shouldShowExpenseTaxBreakdown =
    !!claim.expense &&
    (claim.expense.isGstApplicable === true ||
      (claim.expense.cgstAmount ?? 0) > 0 ||
      (claim.expense.sgstAmount ?? 0) > 0 ||
      (claim.expense.igstAmount ?? 0) > 0);
  const submitterDisplayName = formatOptionalText(claim.submitterName ?? claim.submitter);
  const submitterDisplayEmail = formatOptionalText(claim.submitterEmail ?? claim.submitter);
  const claimForDisplayName =
    claim.submissionType === "On Behalf"
      ? formatOptionalText(claim.beneficiaryName ?? claim.onBehalfEmail, submitterDisplayName)
      : submitterDisplayName;
  const claimForDisplayEmail =
    claim.submissionType === "On Behalf"
      ? formatOptionalText(claim.beneficiaryEmail ?? claim.onBehalfEmail, submitterDisplayEmail)
      : submitterDisplayEmail;
  const employeeIdLabel =
    claim.submissionType === "On Behalf" ? "Beneficiary Employee ID" : "Employee ID";
  const employeeIdValue =
    claim.submissionType === "On Behalf"
      ? formatOptionalText(claim.onBehalfEmployeeCode, claim.employeeId)
      : claim.employeeId;

  return (
    <>
      {isAdminUser ? <AdminSoftDeletePanel claimId={claim.id} /> : null}
      {isDeptViewerOnly ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            View Only: Department POC
          </span>
        </div>
      ) : null}

      {/* ── Header Card ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Audit Monitoring
            </p>
            <h1 className="mt-1 truncate text-lg font-bold text-slate-900 dark:text-slate-100">
              {claim.id}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Submitted by {submitterDisplayName} ({submitterDisplayEmail})
            </p>
          </div>
          <ClaimStatusBadge status={claim.status} />
        </div>

        {/* ── Key Info Grid ── */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Amount
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
              {formatAmount(claim.expense?.totalAmount ?? claim.advance?.requestedAmount ?? null)}
            </p>
          </article>
          <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Category
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
              {formatOptionalText(
                claim.expense?.expenseCategoryName ?? (claim.advance ? "Advance" : null),
              )}
            </p>
          </article>
          <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Department
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
              {claim.departmentName ?? "Unknown"}
            </p>
          </article>
          <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Submitted On
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
              {formatDate(claim.submittedAt)}
            </p>
          </article>
        </div>

        {/* ── Supplementary Info ── */}
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Payment Mode
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
              {claim.paymentModeName ?? "Unknown"}
            </p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {employeeIdLabel}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
              {employeeIdValue}
            </p>
          </div>
          <div className="px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Submission Type
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
              {claim.submissionType}
            </p>
          </div>
          <div className="col-span-2 px-1 lg:col-span-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Claim For
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
              {claimForDisplayName} ({claimForDisplayEmail})
            </p>
          </div>
        </div>
      </section>

      {claim.status === DB_CLAIM_STATUSES[4] && claim.rejectionReason ? (
        <section className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-700/40 dark:bg-rose-900/10">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">
            Rejection Reason
          </h2>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-200">{claim.rejectionReason}</p>
        </section>
      ) : null}

      {claim.expense ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400">
            Expense Detail
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 md:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Bill No
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.billNo, "-")}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Vendor
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.vendorName)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Expense Category
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.expenseCategoryName)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Product
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.productName)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Location
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.locationName)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Transaction Date
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDate(claim.expense.transactionDate)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                GST Applicable
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {claim.expense.isGstApplicable === null
                  ? "N/A"
                  : claim.expense.isGstApplicable
                    ? "Yes"
                    : "No"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                GST Number
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.gstNumber)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Basic Amount
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatAmount(claim.expense.basicAmount)}
              </p>
            </div>
            {shouldShowExpenseTaxBreakdown ? (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    CGST
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatAmount(claim.expense.cgstAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    SGST
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatAmount(claim.expense.sgstAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    IGST
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatAmount(claim.expense.igstAmount)}
                  </p>
                </div>
              </>
            ) : null}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                Total Amount
              </p>
              <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatAmount(claim.expense.totalAmount)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Purpose
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.purpose)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Remarks
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.remarks)}
              </p>
            </div>
            <div className="col-span-2 md:col-span-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                People Involved
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.peopleInvolved)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {claim.advance ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400">
            Advance Detail
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 md:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Purpose
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {claim.advance.purpose}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                Requested Amount
              </p>
              <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatAmount(claim.advance.requestedAmount)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Expected Usage Date
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDate(claim.advance.expectedUsageDate)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {canTakeDecision ? (
        <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-700/50 dark:bg-amber-900/10">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
            {canTakeL1Decision ? "L1 Decision" : "Finance Decision"}
          </h2>
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-100/80">
            {canTakeL1Decision
              ? "Approve to route this claim to Finance. Reject to close this claim."
              : canTakeFinanceExecutionDecision
                ? "Mark this claim as paid to close payout execution."
                : "Approve to move to payment processing, or reject to close this claim."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {canTakeFinanceExecutionDecision ? (
              <ClaimDecisionActionForm
                action={markPaidFromDetail}
                decision="mark-paid"
                loadingMessage="Marking payment as done..."
                successMessage="Claim marked as paid."
                errorMessage="Unable to mark payment as done."
                redirectToHref={`${ROUTES.claims.myClaims}?view=approvals`}
              />
            ) : canTakeFinanceAuthorizationDecision ? (
              <>
                <ClaimDecisionActionForm
                  action={approveFinanceFromDetail}
                  decision="approve"
                  loadingMessage="Approving finance step..."
                  successMessage="Finance decision approved."
                  errorMessage="Unable to approve finance step."
                  redirectToHref={`${ROUTES.claims.myClaims}?view=approvals`}
                />
                <ClaimRejectWithReasonForm
                  action={rejectFinanceFromDetail}
                  redirectToHref={`${ROUTES.claims.myClaims}?view=approvals`}
                />
              </>
            ) : (
              <>
                <ClaimDecisionActionForm
                  action={approveFromDetail}
                  decision="approve"
                  loadingMessage="Approving claim..."
                  successMessage="Claim approved."
                  errorMessage="Unable to approve claim."
                  redirectToHref={`${ROUTES.claims.myClaims}?view=approvals`}
                />
                <ClaimRejectWithReasonForm
                  action={rejectFromDetail}
                  redirectToHref={`${ROUTES.claims.myClaims}?view=approvals`}
                />
              </>
            )}
          </div>
        </section>
      ) : null}

      {canEditByFinance ? (
        <Suspense fallback={<FinanceEditClaimSkeleton />}>
          <FinanceEditClaimSection claim={claim} />
        </Suspense>
      ) : null}

      <Suspense fallback={<ClaimAuditHistorySkeleton />}>
        <ClaimAuditHistorySection claimId={claim.id} />
      </Suspense>

      <Suspense fallback={<EvidenceGallerySkeleton />}>
        <EvidenceGallerySection evidencePaths={evidencePaths} />
      </Suspense>
    </>
  );
}

export default async function ClaimDetailPage({ params, searchParams }: PageProps) {
  const currentUserResult = await getCachedCurrentUser();
  const currentEmail = currentUserResult.user?.email ?? null;

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
    >
      <AppShellHeader currentEmail={currentEmail} />

      <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <main className="space-y-5">
          {/* Back button */}
          <Suspense
            fallback={<BackButton className="w-fit" fallbackHref={ROUTES.claims.myClaims} />}
          >
            <ClaimDetailBackButton searchParams={searchParams} />
          </Suspense>

          {/* Page header card */}
          <section className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-white/88 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.14),0_8px_24px_-8px_rgba(99,102,241,0.05)] backdrop-blur-lg transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/88 dark:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.40)]">
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />
            <div className="px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                    Claim Detail
                  </p>
                  <h1 className="dashboard-font-display mt-1 text-xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-2xl dark:text-zinc-50">
                    Audit &amp; Review
                  </h1>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Full claim information, evidence, and audit trail
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Claim detail content */}
          <Suspense fallback={<ClaimDetailContentSkeleton />}>
            <ClaimDetailCore params={params} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
