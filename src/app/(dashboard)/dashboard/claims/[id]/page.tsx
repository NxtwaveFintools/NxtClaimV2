import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
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
import { FinanceEditClaimForm } from "@/modules/claims/ui/finance-edit-claim-form";
import { ClaimAuditTimeline } from "@/modules/claims/ui/claim-audit-timeline";
import {
  getAvailableClaimActions,
  type ClaimActionRole,
} from "@/modules/claims/utils/get-available-claim-actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
};

type EvidenceItem = {
  label: string;
  path: string;
  signedUrl: string;
};

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

function formatAmount(amount: number | null): string {
  if (amount === null) {
    return "N/A";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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

async function resolveEvidenceUrls(
  claimRepository: SupabaseClaimRepository,
  items: Array<{ label: string; path: string }>,
): Promise<EvidenceItem[]> {
  const validItems = items.filter((item) => isRenderableEvidencePath(item.path));

  const resolved = await Promise.all(
    validItems.map(async (item) => {
      const signed = await claimRepository.getClaimEvidenceSignedUrl({
        filePath: item.path,
        expiresInSeconds: 60 * 10,
      });

      if (signed.errorMessage || !signed.data) {
        return null;
      }

      return {
        label: item.label,
        path: item.path,
        signedUrl: signed.data,
      };
    }),
  );

  return resolved.filter((item): item is EvidenceItem => item !== null);
}

export default async function ClaimDetailPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const viewParam = Array.isArray(resolvedSearchParams.view)
    ? resolvedSearchParams.view[0]
    : resolvedSearchParams.view;
  const backHref =
    viewParam === "approvals" ? `${ROUTES.claims.myClaims}?view=approvals` : ROUTES.claims.myClaims;
  const authRepository = new SupabaseServerAuthRepository();
  const claimRepository = new SupabaseClaimRepository();

  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
        <main className="mx-auto max-w-5xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm transition-colors dark:border-rose-900/40 dark:bg-zinc-950">
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
        </main>
      </div>
    );
  }

  const claimResult = await claimRepository.getClaimDetailById(resolvedParams.id);

  if (claimResult.errorMessage) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
        <main className="mx-auto max-w-5xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm transition-colors dark:border-rose-900/40 dark:bg-zinc-950">
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
        </main>
      </div>
    );
  }

  if (!claimResult.data) {
    notFound();
  }

  const claim = claimResult.data;
  const claimAuditLogsResult = await claimRepository.getClaimAuditLogs(claim.id);
  const claimAuditLogs = claimAuditLogsResult.errorMessage ? [] : claimAuditLogsResult.data;
  const currentUserId = currentUserResult.user.id;
  const financeApproverIdsResult =
    await claimRepository.getFinanceApproverIdsForUser(currentUserId);
  const isFinanceActor =
    !financeApproverIdsResult.errorMessage && financeApproverIdsResult.data.length > 0;
  const isAssignedL1Approver = currentUserId === claim.assignedL1ApproverId;
  const isAssignedL2Approver = currentUserId === claim.assignedL2ApproverId;
  const canViewAsFinance = isFinanceActor && claim.status !== DB_CLAIM_STATUSES[0];
  const canView =
    currentUserId === claim.submittedBy ||
    isAssignedL1Approver ||
    isAssignedL2Approver ||
    canViewAsFinance;
  const canEditByFinance = isFinanceActor;

  if (!canView) {
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
  const [
    productsResult,
    departmentsResult,
    paymentModesResult,
    expenseCategoriesResult,
    locationsResult,
  ] = canEditByFinance
    ? await Promise.all([
        claimRepository.getActiveProducts(),
        claimRepository.getActiveDepartments(),
        claimRepository.getActivePaymentModes(),
        claimRepository.getActiveExpenseCategories(),
        claimRepository.getActiveLocations(),
      ])
    : [
        { data: [], errorMessage: null },
        { data: [], errorMessage: null },
        { data: [], errorMessage: null },
        { data: [], errorMessage: null },
        { data: [], errorMessage: null },
      ];
  const productOptions = productsResult.errorMessage ? [] : productsResult.data;
  const departmentOptions = departmentsResult.errorMessage ? [] : departmentsResult.data;
  const paymentModeOptions = paymentModesResult.errorMessage
    ? []
    : paymentModesResult.data.map((mode) => ({ id: mode.id, name: mode.name }));
  const expenseCategoryOptions = expenseCategoriesResult.errorMessage
    ? []
    : expenseCategoriesResult.data;
  const locationOptions = locationsResult.errorMessage ? [] : locationsResult.data;

  const evidencePaths: Array<{ label: string; path: string }> = [];

  if (isRenderableEvidencePath(claim.expense?.receiptFilePath)) {
    evidencePaths.push({ label: "Receipt", path: claim.expense.receiptFilePath });
  }

  if (isRenderableEvidencePath(claim.expense?.bankStatementFilePath)) {
    evidencePaths.push({ label: "Bank Statement", path: claim.expense.bankStatementFilePath });
  }

  if (isRenderableEvidencePath(claim.advance?.supportingDocumentPath)) {
    evidencePaths.push({
      label: "Supporting Document",
      path: claim.advance.supportingDocumentPath,
    });
  }

  const evidenceItems = await resolveEvidenceUrls(claimRepository, evidencePaths);

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

  const updateFinanceDetailFromPage = async (formData: FormData) => {
    "use server";
    const result = await updateClaimByFinanceAction({ claimId: claim.id, formData });

    if (!result.ok) {
      throw new Error(result.message ?? "Unable to update claim details.");
    }
  };

  const shouldShowExpenseTaxBreakdown =
    !!claim.expense &&
    (claim.expense.isGstApplicable === true ||
      (claim.expense.cgstAmount ?? 0) > 0 ||
      (claim.expense.sgstAmount ?? 0) > 0 ||
      (claim.expense.igstAmount ?? 0) > 0);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <BackButton className="w-fit" fallbackHref={backHref} />
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Claim
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {claim.id}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Employee: {claim.submitter}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ClaimStatusBadge status={claim.status} />
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                Department
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                {claim.departmentName ?? "Unknown"}
              </p>
            </article>
            <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                Payment Mode
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                {claim.paymentModeName ?? "Unknown"}
              </p>
            </article>
            <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                Submitted On
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDate(claim.submittedAt)}
              </p>
            </article>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                Employee ID
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                {claim.employeeId}
              </p>
            </article>
            <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                Submission Type
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                {claim.submissionType}
              </p>
            </article>
          </div>

          {claim.status === DB_CLAIM_STATUSES[4] && claim.rejectionReason ? (
            <section className="mt-4 rounded-xl border border-rose-700/40 bg-rose-900/10 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-rose-300">
                Rejection Reason
              </h2>
              <p className="mt-2 text-sm text-rose-200">{claim.rejectionReason}</p>
            </section>
          ) : null}

          {claim.expense ? (
            <section className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300">
                Expense Detail
              </h2>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Bill No:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.billNo, "-")}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Vendor:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.vendorName)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Expense Category:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.expenseCategoryName)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Product:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.productName)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Location:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.locationName)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Transaction Date:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatDate(claim.expense.transactionDate)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  GST Applicable:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {claim.expense.isGstApplicable === null
                      ? "N/A"
                      : claim.expense.isGstApplicable
                        ? "Yes"
                        : "No"}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  GST Number:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.gstNumber)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Total Amount:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatAmount(claim.expense.totalAmount)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Basic Amount:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatAmount(claim.expense.basicAmount)}
                  </span>
                </p>
                {shouldShowExpenseTaxBreakdown ? (
                  <>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      CGST Amount:{" "}
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatAmount(claim.expense.cgstAmount)}
                      </span>
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      SGST Amount:{" "}
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatAmount(claim.expense.sgstAmount)}
                      </span>
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      IGST Amount:{" "}
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatAmount(claim.expense.igstAmount)}
                      </span>
                    </p>
                  </>
                ) : null}
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Purpose:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.purpose)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Remarks:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.remarks)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  People Involved:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.peopleInvolved)}
                  </span>
                </p>
              </div>
            </section>
          ) : null}

          {claim.advance ? (
            <section className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300">
                Advance Detail
              </h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Purpose:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {claim.advance.purpose}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Requested Amount:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatAmount(claim.advance.requestedAmount)}
                  </span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Expected Usage Date:{" "}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatDate(claim.advance.expectedUsageDate)}
                  </span>
                </p>
              </div>
            </section>
          ) : null}

          {canTakeDecision ? (
            <section className="mt-6 rounded-xl border border-amber-700/50 bg-amber-900/10 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-300">
                {canTakeL1Decision ? "L1 Decision" : "Finance Decision"}
              </h2>
              <p className="mt-2 text-sm text-amber-100/80">
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
          ) : null}

          <div className="mt-6">
            <Link
              href={`${ROUTES.claims.myClaims}?view=approvals`}
              className="text-sm font-medium text-indigo-500 transition-all duration-200 hover:text-indigo-400 active:scale-[0.98]"
            >
              Back to My Claims approvals
            </Link>
          </div>

          <div className="mt-6">
            <ClaimAuditTimeline logs={claimAuditLogs} />
            {claimAuditLogsResult.errorMessage ? (
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                Unable to load complete audit history. {claimAuditLogsResult.errorMessage}
              </p>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 dark:text-slate-300">
            Evidence Gallery
          </h2>
          {evidenceItems.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              No evidence files attached to this claim.
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
      </main>
    </div>
  );
}
