import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink, X } from "lucide-react";
import { AppShellHeader } from "@/components/app-shell-header";
import { BackButton } from "@/components/ui/back-button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../../../../components/ui/accordion";
import { SheetClose, Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../components/ui/tabs";
import { ROUTES } from "@/core/config/route-registry";
import {
  DB_CLAIM_STATUSES,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_REJECTED_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  isPendingFinanceApprovalStatus,
  isSubmitterDeletableClaimStatus,
} from "@/core/constants/statuses";
import { isCorporateCardPaymentModeName } from "@/core/constants/payment-modes";
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
import { DeleteClaimButton } from "@/modules/claims/ui/delete-claim-button";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";
import { sanitizeDashboardReturnToPath } from "@/lib/pagination-helpers";
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
  searchParams: Promise<{ view?: string | string[]; returnTo?: string | string[] }>;
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

type EvidenceTabValue = "receipt" | "bank-statement" | "supporting-document";

type ClaimDetailRecord = NonNullable<
  Awaited<ReturnType<SupabaseClaimRepository["getClaimDetailById"]>>["data"]
>;

function EvidenceTabPanel({ item, value }: { item: EvidenceItem; value: EvidenceTabValue }) {
  return (
    <TabsContent
      value={value}
      className="relative mt-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
    >
      <a
        href={item.signedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-4 top-4 z-20 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/85 dark:text-slate-300 dark:hover:bg-slate-900"
      >
        Open in New Tab
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>

      <div className="flex-1 bg-slate-950/40 p-2 pt-14 sm:p-3 sm:pt-16">
        {isPdf(item.path) ? (
          <iframe
            title={item.label}
            src={item.signedUrl}
            className="h-full w-full rounded-lg border border-slate-800"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg border border-slate-800 bg-slate-950/40 p-2">
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
    </TabsContent>
  );
}

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
    : paymentModesResult.data
        .filter((mode) => !isCorporateCardPaymentModeName(mode.name))
        .map((mode) => ({ id: mode.id, name: mode.name }));
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
      <SheetTrigger className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-all duration-200 hover:bg-indigo-100 active:scale-[0.98] dark:border-indigo-600/60 dark:bg-indigo-600/15 dark:text-indigo-200 dark:hover:bg-indigo-600/25">
        Edit Claim
      </SheetTrigger>

      <SheetContent
        side="right"
        hideDefaultCloseButton
        className="fixed inset-y-0 right-0 h-full w-full max-w-none sm:max-w-[600px] md:max-w-[700px] flex flex-col p-0 border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      >
        <SheetClose className="absolute right-5 top-5 z-30 inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 bg-white/90 text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950/90 dark:text-zinc-200 dark:hover:bg-zinc-900">
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
                    id: claim.advance.id,
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
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted/60" />
      </div>
      <div className="flex-1 p-3">
        <div className="h-full w-full animate-pulse rounded-lg bg-muted/60" />
      </div>
    </div>
  );
}

function FinanceEditClaimSkeleton() {
  return <div className="h-8 w-24 animate-pulse rounded-xl bg-muted/60" />;
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

  const receiptItem = evidenceItems.find((item) => item.label === "Receipt");
  const bankStatementItem = evidenceItems.find((item) => item.label === "Bank Statement");
  const supportingDocumentItem = evidenceItems.find((item) => item.label === "Supporting Document");
  const defaultTabValue = receiptItem
    ? "receipt"
    : bankStatementItem
      ? "bank-statement"
      : supportingDocumentItem
        ? "supporting-document"
        : null;

  if (!defaultTabValue) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center border-b border-border px-4">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Evidence Gallery
          </p>
        </div>
        <p className="px-4 py-4 text-sm text-slate-600 dark:text-slate-400">
          {evidenceErrorMessage
            ? `Unable to load evidence files right now. ${evidenceErrorMessage}`
            : "No evidence files attached to this claim."}
        </p>
      </div>
    );
  }

  return (
    <Tabs defaultValue={defaultTabValue} className="flex h-full w-full flex-col">
      <TabsList className="h-14 w-full justify-start rounded-none border-b border-border bg-transparent p-0 px-4">
        {receiptItem ? (
          <TabsTrigger
            value="receipt"
            className="rounded-md px-4 py-2 data-[state=active]:bg-muted/50"
          >
            Receipt
          </TabsTrigger>
        ) : null}

        {bankStatementItem ? (
          <TabsTrigger
            value="bank-statement"
            className="rounded-md px-4 py-2 data-[state=active]:bg-muted/50"
          >
            Bank Statement
          </TabsTrigger>
        ) : null}

        {supportingDocumentItem ? (
          <TabsTrigger
            value="supporting-document"
            className="rounded-md px-4 py-2 data-[state=active]:bg-muted/50"
          >
            Supporting Document
          </TabsTrigger>
        ) : null}
      </TabsList>

      {receiptItem ? <EvidenceTabPanel item={receiptItem} value="receipt" /> : null}
      {bankStatementItem ? (
        <EvidenceTabPanel item={bankStatementItem} value="bank-statement" />
      ) : null}
      {supportingDocumentItem ? (
        <EvidenceTabPanel item={supportingDocumentItem} value="supporting-document" />
      ) : null}
    </Tabs>
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
      <section className="mx-auto max-w-5xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm transition-colors dark:border-rose-900/40 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Claim Detail</h1>
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          Unable to load claim detail. {claimResult.errorMessage}
        </p>
        <Link
          href={returnToPath}
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
  const microGridClassName = "grid grid-cols-2 2xl:grid-cols-3 gap-4";
  const detailHeadingLabel = claim.detailType === "expense" ? "Expense Details" : "Advance Details";
  const formatAmountValue = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return "N/A";
    }

    return formatCurrency(value);
  };
  const heroTotalAmountValue = claim.expense?.totalAmount ?? claim.advance?.requestedAmount ?? null;
  const heroCategoryValue = claim.expense
    ? formatOptionalText(claim.expense.expenseCategoryName)
    : "N/A";
  const heroDepartmentValue = claim.departmentName ?? "Unknown";
  const heroPurposeValue = claim.expense
    ? formatOptionalText(claim.expense.purpose)
    : claim.advance
      ? formatOptionalText(claim.advance.purpose)
      : "N/A";
  const submitterInitials = submitterDisplayName
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <>
      <section className="flex items-center justify-between border-b border-zinc-200/80 py-4 dark:border-zinc-800/80">
        <BackButton className="w-fit" fallbackHref={returnToPath} />

        <div className="ml-4 flex min-w-0 flex-wrap items-center justify-end gap-2">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Audit &amp; Review · {claim.id}
          </p>
          <ClaimStatusBadge status={claim.status} />

          {canEditClaim ? (
            <Suspense fallback={<FinanceEditClaimSkeleton />}>
              <FinanceEditClaimSection
                claim={claim}
                editFlow={canEditFinanceClaim ? "finance" : "own"}
              />
            </Suspense>
          ) : null}

          {canDeleteClaim ? (
            <DeleteClaimButton claimId={claim.id} redirectToHref={ROUTES.claims.myClaims} />
          ) : null}
        </div>
      </section>

      {isAdminUser ? <AdminSoftDeletePanel claimId={claim.id} isActive={claim.isActive} /> : null}
      {isDeptViewerOnly ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            View Only: Department POC
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 pt-4">
        <section className="lg:col-span-5 flex flex-col gap-12 pb-32">
          {DB_REJECTED_STATUSES.some((status) => status === claim.status) &&
          claim.rejectionReason ? (
            <section className="border-l-2 border-rose-500/70 bg-rose-50/55 px-4 py-3 dark:border-rose-500/60 dark:bg-rose-900/10">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">
                Rejection Reason
              </h2>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-200">
                {claim.rejectionReason}
              </p>
            </section>
          ) : null}

          <section className="bg-primary/5 border border-primary/20 rounded-xl p-6 mb-8 flex flex-col gap-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Total Amount</p>
                <p className="text-4xl lg:text-5xl font-black tracking-tight text-foreground">
                  {formatAmountValue(heroTotalAmountValue)}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                  {submitterInitials || "NA"}
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">Submitter</p>
                  <p className="font-medium text-foreground">{submitterDisplayName}</p>
                  <p className="text-sm text-muted-foreground">{submitterDisplayEmail}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-primary/10">
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Category</p>
                <p className="font-medium text-foreground">{heroCategoryValue}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Department</p>
                <p className="font-medium text-foreground">{heroDepartmentValue}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Purpose</p>
                <p className="font-medium text-foreground">{heroPurposeValue}</p>
              </div>
            </div>
          </section>

          <section className="bg-card border border-border/50 shadow-sm rounded-xl p-6 md:p-8 flex flex-col gap-6">
            <Accordion
              type="multiple"
              defaultValue={["general-info", "routing-context", "expense-details", "financials"]}
              className="w-full space-y-4"
            >
              <AccordionItem
                value="general-info"
                className="border-none bg-muted/10 rounded-xl px-4 py-2"
              >
                <AccordionTrigger className="hover:no-underline text-xs uppercase tracking-widest text-muted-foreground font-bold">
                  General Info
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-2">
                  <div className={microGridClassName}>
                    <DataCard
                      label="Claim ID"
                      value={claim.id}
                      className="col-span-2 2xl:col-span-3"
                    />
                    <DataCard label="Submitted On" value={formatDate(claim.submittedAt)} />
                    <DataCard label="Employee" value={submitterDisplayName} />
                    <DataCard label="Submission Type" value={claim.submissionType} />
                    <DataCard label={employeeIdLabel} value={employeeIdValue} />
                    <DataCard
                      label="Email"
                      value={submitterDisplayEmail}
                      className="col-span-2 2xl:col-span-2"
                    />
                    <DataCard
                      label="Claim For"
                      value={`${claimForDisplayName} (${claimForDisplayEmail})`}
                      className="col-span-2 2xl:col-span-2"
                    />
                    {claim.submissionType === "On Behalf" ? (
                      <DataCard
                        label="On Behalf Email"
                        value={formatOptionalText(claim.onBehalfEmail)}
                        className="col-span-2 2xl:col-span-2"
                      />
                    ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="routing-context"
                className="border-none bg-muted/10 rounded-xl px-4 py-2"
              >
                <AccordionTrigger className="hover:no-underline text-xs uppercase tracking-widest text-muted-foreground font-bold">
                  Routing Context
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-2">
                  <div className={microGridClassName}>
                    <DataCard label="Payment Mode" value={claim.paymentModeName ?? "Unknown"} />
                    {isPendingFinanceApproval ? (
                      <DataCard label="Assigned To" value="Finance Team" />
                    ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="expense-details"
                className="border-none bg-muted/10 rounded-xl px-4 py-2"
              >
                <AccordionTrigger className="hover:no-underline text-xs uppercase tracking-widest text-muted-foreground font-bold">
                  {detailHeadingLabel}
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-2">
                  <div className={microGridClassName}>
                    {claim.expense ? (
                      <>
                        <DataCard
                          label="Bill No"
                          value={formatOptionalText(claim.expense.billNo, "-")}
                          className="col-span-2 2xl:col-span-2"
                        />
                        <DataCard
                          label="Product"
                          value={formatOptionalText(claim.expense.productName)}
                        />
                        <DataCard
                          label="Transaction Date"
                          value={formatDate(claim.expense.transactionDate)}
                        />
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
                            className="col-span-2 2xl:col-span-3"
                          />
                        ) : null}
                        <DataCard
                          label="Vendor"
                          value={formatOptionalText(claim.expense.vendorName)}
                        />
                        {claim.expense.remarks ? (
                          <DataCard
                            label="Remarks"
                            value={formatOptionalText(claim.expense.remarks)}
                            className="col-span-2 2xl:col-span-3"
                          />
                        ) : null}
                        <DataCard
                          label="People Involved"
                          value={formatOptionalText(claim.expense.peopleInvolved)}
                        />
                      </>
                    ) : claim.advance ? (
                      <>
                        <DataCard
                          label="Purpose"
                          value={formatOptionalText(claim.advance.purpose)}
                          className="col-span-2 2xl:col-span-3"
                        />
                        <DataCard
                          label="Expected Usage Date"
                          value={formatDate(claim.advance.expectedUsageDate)}
                        />
                      </>
                    ) : (
                      <DataCard label="Details" value="N/A" className="col-span-2 2xl:col-span-3" />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem
                value="financials"
                className="border-none bg-muted/10 rounded-xl px-4 py-2"
              >
                <AccordionTrigger className="hover:no-underline text-xs uppercase tracking-widest text-muted-foreground font-bold">
                  Financials
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-2">
                  <div className={microGridClassName}>
                    {claim.expense ? (
                      <>
                        <DataCard
                          label="Basic Amount"
                          value={formatAmountValue(claim.expense.basicAmount)}
                        />
                        <DataCard
                          label="CGST Amount"
                          value={formatAmountValue(claim.expense.cgstAmount)}
                        />
                        <DataCard
                          label="SGST Amount"
                          value={formatAmountValue(claim.expense.sgstAmount)}
                        />
                        <DataCard
                          label="IGST Amount"
                          value={formatAmountValue(claim.expense.igstAmount)}
                        />
                        <DataCard
                          label="GST Applicable"
                          value={
                            claim.expense.isGstApplicable === null
                              ? "N/A"
                              : claim.expense.isGstApplicable
                                ? "Yes"
                                : "No"
                          }
                        />
                        <DataCard
                          label="GST Number"
                          value={formatOptionalText(claim.expense.gstNumber)}
                        />
                        <DataCard
                          label="Total Amount"
                          value={formatAmountValue(claim.expense.totalAmount)}
                        />
                      </>
                    ) : claim.advance ? (
                      <DataCard
                        label="Requested Amount"
                        value={formatAmountValue(claim.advance.requestedAmount)}
                      />
                    ) : (
                      <DataCard label="Amount" value="N/A" />
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>

          <section className="bg-card border border-border/50 shadow-sm rounded-xl p-6 md:p-8 flex flex-col gap-6">
            <div>
              <Suspense fallback={<ClaimAuditHistorySkeleton />}>
                <ClaimAuditHistorySection claimId={claim.id} />
              </Suspense>
            </div>
          </section>

          {canTakeDecision ? (
            <section className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm z-40 px-8 py-4 flex justify-between items-center">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  {canTakeL1Decision ? "L1 Decision" : "Finance Decision"}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {canTakeL1Decision
                    ? "Approve to route this claim to Finance."
                    : canTakeFinanceExecutionDecision
                      ? "Mark this claim as paid to complete execution."
                      : "Approve or reject after evidence verification."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canTakeFinanceExecutionDecision ? (
                  <ClaimDecisionActionForm
                    action={markPaidFromDetail}
                    decision="mark-paid"
                    loadingMessage="Marking payment as done..."
                    successMessage="Claim marked as paid."
                    errorMessage="Unable to mark payment as done."
                    redirectToHref={returnToPath}
                  />
                ) : canTakeFinanceAuthorizationDecision ? (
                  <>
                    <ClaimDecisionActionForm
                      action={approveFinanceFromDetail}
                      decision="approve"
                      loadingMessage="Approving finance step..."
                      successMessage="Finance decision approved."
                      errorMessage="Unable to approve finance step."
                      redirectToHref={returnToPath}
                    />
                    <ClaimRejectWithReasonForm
                      action={rejectFinanceFromDetail}
                      redirectToHref={returnToPath}
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
                      redirectToHref={returnToPath}
                    />
                    <ClaimRejectWithReasonForm
                      action={rejectFromDetail}
                      redirectToHref={returnToPath}
                    />
                  </>
                )}
              </div>
            </section>
          ) : null}
        </section>

        <aside className="sticky top-8 h-[calc(100vh-6rem)] overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:col-span-7">
          <Suspense fallback={<EvidenceGallerySkeleton />}>
            <EvidenceGallerySection evidencePaths={evidencePaths} />
          </Suspense>
        </aside>
      </div>
    </>
  );
}

export default async function ClaimDetailPage({ params, searchParams }: PageProps) {
  const currentUserResult = await getCachedCurrentUser();
  const currentEmail = currentUserResult.user?.email ?? null;

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg bg-muted/30 dark:bg-background`}
    >
      <AppShellHeader currentEmail={currentEmail} />

      <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <main className="space-y-5">
          {/* Claim detail content */}
          <Suspense fallback={<ClaimDetailContentSkeleton />}>
            <ClaimDetailCore params={params} searchParams={searchParams} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
