import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { X } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../../../../components/ui/accordion";
import { SheetClose, Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ROUTES } from "@/core/config/route-registry";
import {
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_REJECTED_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  isPendingFinanceApprovalStatus,
  isSubmitterDeletableClaimStatus,
} from "@/core/constants/statuses";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import {
  approveClaimAction,
  approveFinanceAction,
  markPaymentDoneAction,
  rejectClaimAction,
  rejectFinanceAction,
  updateClaimByFinanceAction,
  updateOwnClaimAction,
} from "@/modules/claims/actions";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { ClaimRejectWithReasonForm } from "@/modules/claims/ui/claim-reject-with-reason-form";
import { ClaimDecisionActionForm } from "@/modules/claims/ui/claim-decision-action-form";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import { ClaimAuditTimeline } from "@/modules/claims/ui/claim-audit-timeline";
import { CopyableDataCard as DataCard } from "../../../../../modules/claims/ui/copyable-data-card";
import { AiAuditCaption } from "@/components/ui/ai-audit-caption";
import { DeleteClaimButton } from "@/modules/claims/ui/delete-claim-button";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { sanitizeDashboardReturnToPath } from "@/lib/pagination-helpers";
import { getClaimDetailActionPermissions } from "@/modules/claims/utils/get-available-claim-actions";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { getViewerDepartmentIds } from "@/modules/claims/server/is-department-viewer";
import { AdminSoftDeletePanel } from "@/modules/admin/ui/admin-soft-delete-panel";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

const FinanceEditClaimForm = dynamic(
  () =>
    import("@/modules/claims/ui/finance-edit-claim-form").then((mod) => mod.FinanceEditClaimForm),
  {
    loading: () => <Skeleton className="h-96 w-full rounded-xl" />,
  },
);

const ClaimEvidenceViewer = dynamic(
  () =>
    import("@/modules/claims/ui/claim-evidence-viewer").then(
      (module) => module.ClaimEvidenceViewer,
    ),
  {
    loading: () => <EvidenceGallerySkeleton />,
  },
);

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[]; returnTo?: string | string[] }>;
};

type EvidencePath = {
  label: string;
  path: string;
};

type ClaimDetailRecord = NonNullable<
  Awaited<ReturnType<SupabaseClaimRepository["getClaimDetailById"]>>["data"]
>;

function firstSearchParamValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function formatOptionalText(value: string | null | undefined, fallback = "N/A"): string {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
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
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-7 w-32" />
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <article key={`skel-meta-1-${index}`} className="rounded-lg border border-border p-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-32" />
            </article>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <article key={`skel-meta-2-${index}`} className="rounded-lg border border-border p-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-36" />
            </article>
          ))}
        </div>
        <section className="mt-5 rounded-lg border border-border p-4">
          <Skeleton className="h-4 w-32" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`skel-detail-${index}`} className="h-4 w-full" />
            ))}
          </div>
        </section>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-4 h-[460px] w-full" />
      </section>
    </>
  );
}

function ClaimAuditHistorySkeleton() {
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <Skeleton className="h-4 w-28" />
      <div className="mt-4 space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`audit-skel-${index}`} className="space-y-2">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

async function FinanceEditClaimSection({
  claim,
  editFlow,
}: {
  claim: ClaimDetailRecord;
  editFlow: "finance" | "own";
}) {
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
  const canEditPaymentMode =
    editFlow === "finance" && claim.status === DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS;

  const updateFinanceDetailFromPage = async (
    formData: FormData,
  ): Promise<{ ok: boolean; error?: string }> => {
    "use server";
    const result = await updateClaimByFinanceAction({ claimId: claim.id, formData });

    if (!result.ok) {
      return {
        ok: false,
        error: result.message ?? "Unable to update claim details.",
      };
    }

    return { ok: true };
  };

  const updateOwnDetailFromPage = async (
    formData: FormData,
  ): Promise<{ ok: boolean; error?: string }> => {
    "use server";
    const result = await updateOwnClaimAction({ claimId: claim.id, formData });

    if (!result.ok) {
      return {
        ok: false,
        error: result.message ?? "Unable to update claim details.",
      };
    }

    return { ok: true };
  };

  return (
    <Sheet>
      <SheetTrigger className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground transition-all hover:bg-background-secondary">
        Edit Claim
      </SheetTrigger>

      <SheetContent
        side="right"
        hideDefaultCloseButton
        className="fixed inset-y-0 right-0 h-full w-full max-w-none sm:max-w-[600px] md:max-w-[700px] flex flex-col p-0 border-l border-border bg-card"
      >
        <SheetClose className="absolute right-5 top-5 z-30 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-background-secondary">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetClose>

        <div className="flex-1 min-h-0">
          <FinanceEditClaimForm
            claim={{
              id: claim.id,
              employeeName: claim.submitterName ?? claim.submitter,
              employeeEmail: claim.submitterEmail,
              detailType: claim.detailType,
              submissionType: claim.submissionType,
              onBehalfEmail: claim.onBehalfEmail,
              onBehalfEmployeeCode: claim.onBehalfEmployeeCode,
              departmentId: claim.departmentId,
              paymentModeId: claim.paymentModeId,
              expense: claim.expense
                ? {
                    id: claim.expense.id,
                    billNo: claim.expense.billNo,
                    expenseCategoryId: claim.expense.expenseCategoryId,
                    locationId: claim.expense.locationId,
                    locationType: claim.expense.locationType,
                    locationDetails: claim.expense.locationDetails,
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
                    aiMetadata: claim.expense.aiMetadata,
                    foreignCurrencyCode:
                      (claim.expense.foreignCurrencyCode as "INR" | "USD" | "EUR" | "CHF" | null) ??
                      null,
                    foreignBasicAmount: claim.expense.foreignBasicAmount,
                    foreignGstAmount: claim.expense.foreignGstAmount,
                    foreignTotalAmount: claim.expense.foreignTotalAmount,
                  }
                : null,
              advance: claim.advance
                ? {
                    id: claim.advance.id,
                    purpose: claim.advance.purpose,
                    totalAmount: claim.advance.totalAmount,
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
            editFlow={editFlow}
            isEditMode
            canEditPaymentMode={canEditPaymentMode}
            requireEditReason={editFlow === "finance"}
            presentation="embedded"
            showSecondaryAction
            action={editFlow === "finance" ? updateFinanceDetailFromPage : updateOwnDetailFromPage}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EvidenceGallerySkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="h-14 border-b border-border px-4 py-3">
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="flex-1 p-3">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

function FinanceEditClaimSkeleton() {
  return <Skeleton className="h-8 w-24" />;
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
    <section>
      <ClaimAuditTimeline logs={claimAuditLogs} visualStyle="minimal" />
      {claimAuditLogsResult.errorMessage ? (
        <p className="mt-2 text-xs text-danger">
          {getUserFriendlyErrorMessage(claimAuditLogsResult.errorMessage, "claim-detail")}
        </p>
      ) : null}
    </section>
  );
}

function EvidenceGallerySection({
  claimId,
  evidencePaths,
}: {
  claimId: string;
  evidencePaths: EvidencePath[];
}) {
  const validItems = evidencePaths.filter((item) => isRenderableEvidencePath(item.path));

  return (
    <ClaimEvidenceViewer
      claimId={claimId}
      items={validItems.map((item) => ({ label: item.label, path: item.path }))}
    />
  );
}

async function ClaimDetailCore({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[]; returnTo?: string | string[] }>;
}) {
  const [resolvedParams, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const claimId = resolvedParams.id;
  const fallbackReturnPath = `${ROUTES.claims.myClaims}?view=approvals`;
  const returnToParam = firstSearchParamValue(resolvedSearchParams.returnTo);
  const returnToPath = sanitizeDashboardReturnToPath(returnToParam) ?? fallbackReturnPath;
  const claimRepository = new SupabaseClaimRepository();

  const [currentUserResult, isAdminUser] = await Promise.all([getCachedCurrentUser(), isAdmin()]);

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const claimResult = await claimRepository.getClaimDetailById(claimId, {
    includeInactive: isAdminUser,
  });

  if (claimResult.errorMessage) {
    return (
      <section className="mx-auto max-w-5xl rounded-xl border border-danger/30 bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">Claim Detail</h1>
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">
          {getUserFriendlyErrorMessage(claimResult.errorMessage, "claim-detail")}
        </p>
        <Link
          href={returnToPath}
          className="mt-4 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
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
  const canViewAsFinance = isFinanceActor;
  const canView =
    currentUserId === claim.submittedBy ||
    currentUserId === claim.onBehalfOfId ||
    isAssignedL1Approver ||
    isAssignedL2Approver ||
    canViewAsFinance ||
    isDepartmentViewerForClaim;
  const isPreHodStatus =
    claim.status === DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS ||
    claim.status === DB_REJECTED_RESUBMISSION_ALLOWED_STATUS;
  const isFinanceStatus = isPendingFinanceApprovalStatus(claim.status);
  const canEditOwnClaim =
    isPreHodStatus && (currentUserId === claim.submittedBy || isAssignedL1Approver);
  const canEditFinanceClaim = isFinanceStatus && isFinanceActor;
  const canEditClaim = canEditOwnClaim || canEditFinanceClaim;
  const isDeptViewerOnly =
    isDepartmentViewerForClaim &&
    currentUserId !== claim.submitter &&
    !isAssignedL1Approver &&
    !isFinanceActor &&
    !isAdminUser;

  if (!canView && !isAdminUser) {
    notFound();
  }

  const {
    canTakeL1Decision,
    canTakeFinanceAuthorizationDecision,
    canTakeFinanceExecutionDecision,
  } = getClaimDetailActionPermissions({
    status: claim.status,
    currentUserId,
    beneficiaryUserId: claim.onBehalfOfId,
    assignedL1ApproverId: claim.assignedL1ApproverId,
    isFinanceActor,
  });
  const isBeneficiary = currentUserId === claim.onBehalfOfId;
  const shouldRenderL1DecisionActions = !isBeneficiary && canTakeL1Decision;
  const shouldRenderFinanceAuthorizationActions =
    !isBeneficiary && canTakeFinanceAuthorizationDecision;
  const shouldRenderFinanceExecutionAction = !isBeneficiary && canTakeFinanceExecutionDecision;
  const canDeleteClaim =
    currentUserId === claim.submittedBy && isSubmitterDeletableClaimStatus(claim.status);

  const approveFromDetail = async () => {
    "use server";
    const result = await approveClaimAction({
      claimId: claim.id,
    });

    if (!result.ok) {
      throw new Error(result.message ?? "Unable to approve claim.");
    }
  };

  const rejectFromDetail = async (formData: FormData) => {
    "use server";
    const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
    const allowResubmission = formData.get("allowResubmission") === "true";
    const result = await rejectClaimAction({
      claimId: claim.id,
      rejectionReason,
      allowResubmission,
    });

    if (!result.ok) {
      throw new Error(result.message ?? "Unable to reject claim.");
    }
  };

  const approveFinanceFromDetail = async () => {
    "use server";
    const result = await approveFinanceAction({
      claimId: claim.id,
    });

    if (!result.ok) {
      throw new Error(result.message ?? "Unable to approve finance step.");
    }
  };

  const rejectFinanceFromDetail = async (formData: FormData) => {
    "use server";
    const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
    const allowResubmission = formData.get("allowResubmission") === "true";
    const result = await rejectFinanceAction({
      claimId: claim.id,
      rejectionReason,
      allowResubmission,
    });

    if (!result.ok) {
      throw new Error(result.message ?? "Unable to reject finance step.");
    }
  };

  const markPaidFromDetail = async () => {
    "use server";
    const result = await markPaymentDoneAction({
      claimId: claim.id,
    });

    if (!result.ok) {
      throw new Error(result.message ?? "Unable to mark payment as done.");
    }
  };

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
  const isPendingFinanceApproval = isPendingFinanceApprovalStatus(claim.status);
  const microGridClassName = "grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3";
  const financialGridClassName = "grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3";
  const wideFactClassName = "sm:col-span-2 2xl:col-span-3";
  const detailHeadingLabel = claim.detailType === "expense" ? "Expense Details" : "Advance Details";
  const formatAmountValue = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return "N/A";
    }

    return formatCurrency(value);
  };
  const formatForeignAmountValue = (
    value: number | null | undefined,
    currencyCode: string | null | undefined,
  ) => {
    if (value === null || value === undefined || !currencyCode) {
      return "N/A";
    }

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };
  const totalAmountValue = claim.expense?.totalAmount ?? claim.advance?.totalAmount ?? null;
  const aiMetadata = canViewAsFinance ? (claim.expense?.aiMetadata ?? null) : null;
  const shouldShowForeignFinancials =
    claim.expense?.foreignCurrencyCode != null && claim.expense.foreignCurrencyCode !== "INR";
  const heroCategoryValue = claim.expense
    ? formatOptionalText(claim.expense.expenseCategoryName)
    : "N/A";
  const heroDepartmentValue = claim.departmentName ?? "Unknown";
  const heroPurposeValue = claim.expense
    ? formatOptionalText(claim.expense.purpose)
    : claim.advance
      ? formatOptionalText(claim.advance.purpose)
      : "N/A";

  return (
    <>
      <section className="sticky top-0 z-20 -mx-4 flex flex-col gap-2 border-b border-border bg-background px-6 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <BackButton
            className="!h-8 !rounded-lg !border-border !bg-card !px-2.5 !py-0 !text-xs !font-semibold !text-foreground hover:!bg-background-secondary"
            fallbackHref={returnToPath}
          />
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Audit &amp; Review
            </p>
            <h1 className="break-words text-sm font-semibold leading-tight text-foreground">
              {claim.id}
            </h1>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          <ClaimStatusBadge status={claim.status} fullStatus />

          {canEditClaim ? (
            <Suspense fallback={<FinanceEditClaimSkeleton />}>
              <FinanceEditClaimSection
                claim={claim}
                editFlow={canEditFinanceClaim ? "finance" : "own"}
              />
            </Suspense>
          ) : null}

          {shouldRenderFinanceExecutionAction ? (
            <ClaimDecisionActionForm
              action={markPaidFromDetail}
              decision="mark-paid"
              compact
              isSubmitter={isBeneficiary}
              loadingMessage="Marking payment as done..."
              successMessage="Claim marked as paid."
              errorMessage="Unable to mark payment as done."
              redirectToHref={returnToPath}
            />
          ) : null}

          {shouldRenderFinanceAuthorizationActions ? (
            <>
              <ClaimDecisionActionForm
                action={approveFinanceFromDetail}
                decision="approve"
                compact
                isSubmitter={isBeneficiary}
                loadingMessage="Approving finance step..."
                successMessage="Finance decision approved."
                errorMessage="Unable to approve finance step."
                redirectToHref={returnToPath}
              />
              <ClaimRejectWithReasonForm
                action={rejectFinanceFromDetail}
                compact
                isSubmitter={isBeneficiary}
                redirectToHref={returnToPath}
              />
            </>
          ) : null}

          {shouldRenderL1DecisionActions ? (
            <>
              <ClaimDecisionActionForm
                action={approveFromDetail}
                decision="approve"
                compact
                isSubmitter={isBeneficiary}
                loadingMessage="Approving claim..."
                successMessage="Claim approved."
                errorMessage="Unable to approve claim."
                redirectToHref={returnToPath}
              />
              <ClaimRejectWithReasonForm
                action={rejectFromDetail}
                compact
                isSubmitter={isBeneficiary}
                redirectToHref={returnToPath}
              />
            </>
          ) : null}

          {canDeleteClaim ? (
            <DeleteClaimButton claimId={claim.id} redirectToHref={returnToPath} compact />
          ) : null}
        </div>
      </section>

      <section className="mt-3 rounded-xl border border-border bg-card p-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="min-w-0 sm:col-span-2 xl:col-span-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Total Amount
            </p>
            <p className="mt-1 break-words text-[26px] font-bold leading-none text-foreground">
              {formatAmountValue(totalAmountValue)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Claim For
            </p>
            <p className="mt-1 break-words text-sm font-semibold text-foreground">
              {claimForDisplayName}
            </p>
            <p className="break-words text-xs text-muted-foreground">{claimForDisplayEmail}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Category
            </p>
            <p className="mt-1 break-words text-sm font-medium text-foreground">
              {heroCategoryValue}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Department
            </p>
            <p className="mt-1 break-words text-sm font-medium text-foreground">
              {heroDepartmentValue}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Purpose
            </p>
            <p className="mt-1 break-words text-sm font-medium text-foreground">
              {heroPurposeValue}
            </p>
          </div>
        </div>
      </section>

      {isAdminUser ? <AdminSoftDeletePanel claimId={claim.id} isActive={claim.isActive} /> : null}
      {isDeptViewerOnly ? (
        <div className="rounded-lg border border-border bg-background-secondary px-3 py-2">
          <p className="text-xs font-semibold text-foreground">Read-only access</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            You can view this claim because it belongs to an assigned department.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 pt-4 lg:grid-cols-[minmax(420px,44%)_minmax(520px,56%)]">
        <section className="relative z-10 flex flex-col gap-3 lg:order-1">
          {DB_REJECTED_STATUSES.some((status) => status === claim.status) &&
          claim.rejectionReason ? (
            <section className="rounded-xl border border-danger/30 bg-danger-muted px-4 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-danger">
                Rejection Reason
              </h2>
              <p className="mt-1 text-sm text-danger">{claim.rejectionReason}</p>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <Accordion
              type="multiple"
              defaultValue={["expense-details", "general-info", "routing-context", "financials"]}
              className="w-full space-y-2"
            >
              <AccordionItem
                value="expense-details"
                className="rounded-xl border border-border bg-card p-3.5"
              >
                <AccordionTrigger className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground hover:no-underline">
                  {detailHeadingLabel}
                </AccordionTrigger>
                <AccordionContent className="pt-3 pb-1">
                  <div className={microGridClassName}>
                    {claim.expense ? (
                      <>
                        <div className="sm:col-span-2 2xl:col-span-2 flex flex-col gap-1">
                          <DataCard
                            label="Bill No"
                            value={formatOptionalText(claim.expense.billNo)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="bill_no" />
                        </div>
                        <DataCard
                          label="Product"
                          value={formatOptionalText(claim.expense.productName)}
                        />
                        <div className="flex flex-col gap-1">
                          <DataCard
                            label="Transaction Date"
                            value={formatDate(claim.expense.transactionDate)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="transaction_date" />
                        </div>
                        <DataCard
                          label="Location"
                          value={formatOptionalText(claim.expense.locationName)}
                        />
                        {claim.expense.locationType ? (
                          <DataCard
                            label="Location Type"
                            value={formatOptionalText(claim.expense.locationType)}
                          />
                        ) : null}
                        {claim.expense.locationDetails ? (
                          <DataCard
                            label="Location Details"
                            value={formatOptionalText(claim.expense.locationDetails)}
                            className={wideFactClassName}
                          />
                        ) : null}
                        <div className="flex flex-col gap-1">
                          <DataCard
                            label="Vendor"
                            value={formatOptionalText(claim.expense.vendorName)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="vendor_name" />
                        </div>
                        <DataCard
                          label="Expense Category"
                          value={formatOptionalText(claim.expense.expenseCategoryName)}
                        />
                        <DataCard
                          label="Purpose"
                          value={formatOptionalText(claim.expense.purpose)}
                          className={wideFactClassName}
                        />
                        <DataCard
                          label="Remarks"
                          value={formatOptionalText(claim.expense.remarks)}
                          className={wideFactClassName}
                        />
                        <DataCard
                          label="People Involved"
                          value={formatOptionalText(claim.expense.peopleInvolved)}
                          className={wideFactClassName}
                        />
                      </>
                    ) : claim.advance ? (
                      <>
                        <DataCard
                          label="Total Amount"
                          value={formatAmountValue(claim.advance.totalAmount)}
                        />
                        <DataCard
                          label="Purpose"
                          value={formatOptionalText(claim.advance.purpose)}
                          className={wideFactClassName}
                        />
                        <DataCard
                          label="Expected Usage Date"
                          value={formatDate(claim.advance.expectedUsageDate)}
                        />
                        <DataCard
                          label="Product"
                          value={formatOptionalText(claim.advance.productId)}
                        />
                        <DataCard
                          label="Location"
                          value={formatOptionalText(claim.advance.locationId)}
                        />
                        <DataCard
                          label="Remarks"
                          value={formatOptionalText(claim.advance.remarks)}
                          className={wideFactClassName}
                        />
                        <DataCard
                          label="Supporting Document"
                          value={formatOptionalText(claim.advance.supportingDocumentPath)}
                          className={wideFactClassName}
                        />
                      </>
                    ) : (
                      <DataCard label="Details" value="N/A" className={wideFactClassName} />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="general-info"
                className="rounded-xl border border-border bg-card p-3.5"
              >
                <AccordionTrigger className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground hover:no-underline">
                  General Info
                </AccordionTrigger>
                <AccordionContent className="pt-3 pb-1">
                  <div className={microGridClassName}>
                    <DataCard label="Claim ID" value={claim.id} className={wideFactClassName} />
                    <DataCard label="Submitted On" value={formatDate(claim.submittedAt)} />
                    <DataCard label="Employee" value={submitterDisplayName} />
                    <DataCard label="Submission Type" value={claim.submissionType} />
                    <DataCard label={employeeIdLabel} value={employeeIdValue} />
                    <DataCard
                      label="Email"
                      value={submitterDisplayEmail}
                      className="sm:col-span-2"
                    />
                    <DataCard
                      label="Claim For"
                      value={`${claimForDisplayName} (${claimForDisplayEmail})`}
                      className="sm:col-span-2"
                    />
                    {claim.submissionType === "On Behalf" ? (
                      <DataCard
                        label="On Behalf Email"
                        value={formatOptionalText(claim.onBehalfEmail)}
                        className="sm:col-span-2"
                      />
                    ) : null}
                    {claim.submissionType === "On Behalf" ? (
                      <DataCard
                        label="On Behalf Employee ID"
                        value={formatOptionalText(claim.onBehalfEmployeeCode)}
                      />
                    ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="routing-context"
                className="rounded-xl border border-border bg-card p-3.5"
              >
                <AccordionTrigger className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground hover:no-underline">
                  Routing Context
                </AccordionTrigger>
                <AccordionContent className="pt-3 pb-1">
                  <div className={microGridClassName}>
                    <DataCard
                      label="Payment Mode"
                      value={formatOptionalText(claim.paymentModeName)}
                    />
                    <DataCard label="Department" value={formatOptionalText(claim.departmentName)} />
                    <DataCard
                      label="Assigned HOD / L1"
                      value={
                        claim.assignedL1ApproverName
                          ? `${claim.assignedL1ApproverName}${claim.assignedL1ApproverEmail ? ` (${claim.assignedL1ApproverEmail})` : ""}`
                          : formatOptionalText(claim.assignedL1ApproverId)
                      }
                    />
                    <DataCard
                      label="Assigned Finance / L2"
                      value={
                        isPendingFinanceApproval
                          ? "Finance Team"
                          : claim.assignedL2ApproverName
                            ? `${claim.assignedL2ApproverName}${claim.assignedL2ApproverEmail ? ` (${claim.assignedL2ApproverEmail})` : ""}`
                            : formatOptionalText(claim.assignedL2ApproverId)
                      }
                    />
                    <DataCard
                      label="Current Workflow Status"
                      value={claim.status}
                      className={wideFactClassName}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="financials"
                className="rounded-xl border border-border bg-card p-3.5"
              >
                <AccordionTrigger className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground hover:no-underline">
                  Financials
                </AccordionTrigger>
                <AccordionContent className="pt-3 pb-1">
                  <div className={financialGridClassName}>
                    {claim.expense ? (
                      <>
                        <div className="flex flex-col gap-1">
                          <DataCard
                            label="Basic Amount"
                            value={formatAmountValue(claim.expense.basicAmount)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="basic_amount" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <DataCard
                            label="CGST Amount"
                            value={formatAmountValue(claim.expense.cgstAmount)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="cgst_amount" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <DataCard
                            label="SGST Amount"
                            value={formatAmountValue(claim.expense.sgstAmount)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="sgst_amount" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <DataCard
                            label="IGST Amount"
                            value={formatAmountValue(claim.expense.igstAmount)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="igst_amount" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <DataCard
                            label="GST Number"
                            value={formatOptionalText(claim.expense.gstNumber)}
                          />
                          <AiAuditCaption aiMetadata={aiMetadata} fieldKey="gst_number" />
                        </div>
                        <DataCard
                          label="Total Amount"
                          value={formatAmountValue(claim.expense.totalAmount)}
                        />
                        {shouldShowForeignFinancials ? (
                          <>
                            <DataCard
                              label="Foreign Currency"
                              value={claim.expense.foreignCurrencyCode ?? "N/A"}
                            />
                            <DataCard
                              label="Foreign Basic Amount"
                              value={formatForeignAmountValue(
                                claim.expense.foreignBasicAmount,
                                claim.expense.foreignCurrencyCode,
                              )}
                            />
                            <DataCard
                              label="Foreign GST Amount"
                              value={formatForeignAmountValue(
                                claim.expense.foreignGstAmount,
                                claim.expense.foreignCurrencyCode,
                              )}
                            />
                            <DataCard
                              label="Foreign Total Amount"
                              value={formatForeignAmountValue(
                                claim.expense.foreignTotalAmount,
                                claim.expense.foreignCurrencyCode,
                              )}
                            />
                          </>
                        ) : null}
                      </>
                    ) : claim.advance ? (
                      <>
                        <DataCard
                          label="Total Amount"
                          value={formatAmountValue(claim.advance.totalAmount)}
                        />
                        <DataCard
                          label="Expected Usage Date"
                          value={formatDate(claim.advance.expectedUsageDate)}
                        />
                      </>
                    ) : (
                      <DataCard label="Amount" value="N/A" />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>

          <Suspense fallback={<ClaimAuditHistorySkeleton />}>
            <ClaimAuditHistorySection claimId={claim.id} />
          </Suspense>
        </section>

        <aside className="order-first h-[460px] overflow-hidden rounded-xl border border-border bg-card sm:h-[520px] lg:order-2 lg:sticky lg:top-[76px] lg:h-[calc(100vh-92px)]">
          <Suspense fallback={<EvidenceGallerySkeleton />}>
            <EvidenceGallerySection claimId={claim.id} evidencePaths={evidencePaths} />
          </Suspense>
        </aside>
      </div>
    </>
  );
}

export default async function ClaimDetailPage({ params, searchParams }: PageProps) {
  const currentUserResult = await getCachedCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] pb-16">
      <Suspense fallback={<ClaimDetailContentSkeleton />}>
        <ClaimDetailCore params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
