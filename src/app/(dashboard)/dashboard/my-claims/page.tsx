import Link from "next/link";
import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  MyClaimsContentSkeleton,
  MyClaimsFilterSkeleton,
  MyClaimsPageSkeleton,
} from "./_skeletons";
import { CirclePlus } from "lucide-react";
import { RouterLink } from "@/components/ui/router-link";
import { ROUTES } from "@/core/config/route-registry";
import {
  CLAIM_STATUSES,
  DB_CLAIM_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  isSubmitterDeletableClaimStatus,
  mapCanonicalStatusToDbStatuses,
  type ClaimStatus,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import type {
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { GetMyClaimsPaginatedService } from "@/core/domain/claims/GetMyClaimsPaginatedService";
import { getDefaultApprovalsStatusFilter } from "@/core/domain/claims/GetPendingApprovalsService";
import { logger } from "@/core/infra/logging/logger";
import { formatDate } from "@/lib/format";
import { normalizeIsoDateOnly } from "@/lib/date-only";
import { appendReturnToParam, buildPathWithSearchParams } from "@/lib/pagination-helpers";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { isDepartmentViewer } from "@/modules/claims/server/is-department-viewer";
import { getCachedPendingApprovalsViewerContext } from "@/modules/claims/server/get-pending-approvals-viewer-context";
import { AdminClaimsSection } from "@/modules/admin/ui/admin-claims-section";
import { ClaimsApprovalsSection } from "@/modules/claims/ui/claims-approvals-section";
import { DepartmentClaimsSection } from "@/modules/claims/ui/department-claims-section";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { DeleteClaimButton } from "@/modules/claims/ui/delete-claim-button";

const PAGE_SIZE = 5;
const CLAIM_ID_LINK_CLASSES =
  "block max-w-full break-words text-primary hover:underline font-medium cursor-pointer leading-snug";
const VIEW_LINK_CLASSES =
  "inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-background-secondary";
type SearchParamsValue = string | string[] | undefined;
type ViewMode = "submissions" | "approvals" | "admin" | "admin-deleted" | "department";

export const metadata = {
  title: "Claims | NxtClaim",
};

const ClaimsFilterBar = dynamic(
  () => import("@/modules/claims/ui/claims-filter-bar").then((module) => module.ClaimsFilterBar),
  {
    loading: () => <MyClaimsFilterSkeleton />,
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

  if (value === "admin-deleted" && isAdminUser) {
    return "admin-deleted";
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
  return normalizeIsoDateOnly(value);
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
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      if (DB_CLAIM_STATUSES.includes(entry as DbClaimStatus)) {
        return [entry as DbClaimStatus];
      }

      if (CLAIM_STATUSES.includes(entry as ClaimStatus)) {
        return mapCanonicalStatusToDbStatuses(entry as ClaimStatus);
      }

      return [];
    });

  const deduplicated = [...new Set(parsed)];

  if (deduplicated.length === 0) {
    return undefined;
  }

  return deduplicated;
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
  params.delete("page");

  params.set("view", targetView);

  const query = params.toString();
  return query ? `${ROUTES.claims.myClaims}?${query}` : ROUTES.claims.myClaims;
}

function buildApprovalsViewHref(
  searchParams: Record<string, SearchParamsValue> | undefined,
  scope: "l1" | "finance" | null,
): string {
  const params = toSearchParams(searchParams);
  params.delete("cursor");
  params.delete("prevCursor");
  params.delete("page");
  params.set("view", "approvals");
  const defaultStatus = getDefaultApprovalsStatusFilter(scope);
  if (defaultStatus) {
    params.set("status", defaultStatus);
  } else {
    params.delete("status");
  }
  const query = params.toString();
  return query ? `${ROUTES.claims.myClaims}?${query}` : ROUTES.claims.myClaims;
}

function MyClaimsShellSkeleton() {
  return <MyClaimsContentSkeleton />;
}

function MyClaimsFullPageSkeleton() {
  return <MyClaimsPageSkeleton />;
}

function TableHeader({ showActions }: { showActions: boolean }) {
  return (
    <thead className="bg-background-secondary text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
      <tr>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">CLAIM</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">SUBMITTER / BENEFICIARY</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">DEPARTMENT</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">TYPE</th>
        <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">AMOUNT</th>
        <th className="whitespace-nowrap px-3 py-2.5 text-center font-semibold">STATUS</th>
        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">SUBMITTED</th>
        {showActions ? (
          <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Actions</th>
        ) : null}
      </tr>
    </thead>
  );
}

async function ClaimsCommandCenterTable({
  userId,
  cursor,
  previousCursorToken,
  searchParams,
  filters,
}: {
  userId: string;
  cursor: string | null;
  previousCursorToken: string | null;
  searchParams?: Record<string, SearchParamsValue>;
  filters: GetMyClaimsFilters;
}) {
  const claimRepository = new SupabaseClaimRepository();
  const claimsService = new GetMyClaimsPaginatedService({ repository: claimRepository, logger });
  const listReturnToPath = buildPathWithSearchParams(
    ROUTES.claims.myClaims,
    toSearchParams(searchParams).toString(),
  );

  const claimsResult = await claimsService.execute({
    userId,
    cursor,
    limit: PAGE_SIZE,
    filters,
  });

  const rows = claimsResult.data;
  const submissionsSummaryText = `Showing ${rows.length} of ${claimsResult.totalCount} claims`;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          My Submissions
        </h2>
        {claimsResult.errorMessage || claimsResult.totalCount === 0 ? (
          <p className="text-xs text-muted-foreground">{submissionsSummaryText}</p>
        ) : (
          <MyClaimsPaginationControls
            hasNextPage={claimsResult.hasNextPage}
            currentCursor={cursor}
            nextCursor={claimsResult.nextCursor}
            prevCursor={previousCursorToken}
            summaryText={submissionsSummaryText}
            position="inline"
            searchParams={searchParams}
          />
        )}
      </div>

      {claimsResult.errorMessage ? (
        <div className="px-4 py-6">
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
            Could not load claims. {claimsResult.errorMessage}
          </p>
        </div>
      ) : claimsResult.totalCount === 0 ? (
        <div className="grid place-items-center px-4 py-14 text-center">
          <p className="text-sm font-medium text-foreground">No claims found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try changing filters or clearing the current search.
          </p>
          <Link
            href={ROUTES.claims.new}
            prefetch={false}
            className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-white transition hover:opacity-90"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <CirclePlus className="h-4 w-4" aria-hidden="true" />
            New Claim
          </Link>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed divide-y divide-border text-left text-sm">
              <colgroup>
                <col className="w-[21%]" />
                <col className="w-[19%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[15%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
              </colgroup>
              <TableHeader showActions />
              <tbody className="divide-y divide-border bg-card text-[13px] text-foreground">
                {rows.map((claim) => {
                  const canDeleteClaim = isSubmitterDeletableClaimStatus(claim.status);
                  const detailHref = appendReturnToParam(
                    ROUTES.claims.detail(claim.id),
                    listReturnToPath,
                  );
                  const primarySubmitter = claim.submitterEmail?.trim() || claim.employeeName;
                  const onBehalfValue =
                    claim.onBehalfEmail?.trim() || claim.onBehalfEmployeeCode?.trim() || "";
                  const hasOnBehalf = onBehalfValue.length > 0;

                  return (
                    <tr
                      key={claim.id}
                      className="group transition-colors hover:bg-background-secondary"
                    >
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        <RouterLink
                          href={detailHref}
                          className={CLAIM_ID_LINK_CLASSES}
                          title={claim.id}
                        >
                          {claim.id}
                        </RouterLink>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {claim.employeeId}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-block max-w-full truncate align-bottom"
                          title={primarySubmitter}
                        >
                          {hasOnBehalf ? `Submitter: ${primarySubmitter}` : primarySubmitter}
                        </span>
                        <div
                          className="mt-0.5 max-w-full truncate text-xs text-muted-foreground"
                          title={hasOnBehalf ? onBehalfValue : "On behalf: N/A"}
                        >
                          {hasOnBehalf ? `For: ${onBehalfValue}` : "On behalf: N/A"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-block max-w-full truncate align-bottom"
                          title={claim.departmentName}
                        >
                          {claim.departmentName}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-block max-w-full truncate align-bottom"
                          title={claim.typeOfClaim}
                        >
                          {claim.typeOfClaim}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-foreground">
                        {claim.formattedTotalAmount}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <ClaimStatusBadge status={claim.status} fullWidth fullStatus />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[13px]">
                        {formatDate(claim.submittedAt)}
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          HOD: {formatDate(claim.hodActionDate)}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Finance: {formatDate(claim.financeActionDate)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Link href={detailHref} className={VIEW_LINK_CLASSES}>
                            View
                          </Link>
                          {canDeleteClaim ? <DeleteClaimButton claimId={claim.id} compact /> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border md:hidden">
            {rows.map((claim) => {
              const canDeleteClaim = isSubmitterDeletableClaimStatus(claim.status);
              const detailHref = appendReturnToParam(
                ROUTES.claims.detail(claim.id),
                listReturnToPath,
              );
              const primarySubmitter = claim.submitterEmail?.trim() || claim.employeeName;
              const onBehalfValue =
                claim.onBehalfEmail?.trim() || claim.onBehalfEmployeeCode?.trim() || "";

              return (
                <article key={claim.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <RouterLink href={detailHref} className={CLAIM_ID_LINK_CLASSES}>
                      {claim.id}
                    </RouterLink>
                    <ClaimStatusBadge status={claim.status} fullStatus />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{claim.formattedTotalAmount}</p>
                    <p className="text-xs text-muted-foreground">{claim.typeOfClaim}</p>
                  </div>
                  <dl className="grid gap-1 text-xs text-muted-foreground">
                    <div>Submitted {formatDate(claim.submittedAt)}</div>
                    <div>Department: {claim.departmentName}</div>
                    <div className="truncate">
                      {onBehalfValue
                        ? `Submitter: ${primarySubmitter} / For: ${onBehalfValue}`
                        : primarySubmitter}
                    </div>
                  </dl>
                  <div className="flex items-center gap-2">
                    <Link href={detailHref} className={VIEW_LINK_CLASSES}>
                      View
                    </Link>
                    {canDeleteClaim ? <DeleteClaimButton claimId={claim.id} compact /> : null}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {submissionsSummaryText}
          </div>
        </>
      )}
    </section>
  );
}

function FilterBarSkeleton() {
  return <MyClaimsFilterSkeleton />;
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
  const cursor = firstParamValue(resolvedSearchParams?.cursor) ?? null;
  const previousCursor = firstParamValue(resolvedSearchParams?.prevCursor) ?? null;
  const previousCursorToken = previousCursor ?? (cursor ? "__first__" : null);

  const filters = buildClaimFilters(resolvedSearchParams);

  if (activeView === "admin") {
    return (
      <AdminClaimsSection
        searchParams={resolvedSearchParams}
        pagination={{ cursor, prevCursor: previousCursorToken }}
        mode="active"
        defaultFiltersExpanded={viewerContextResult.activeScope === "finance"}
      />
    );
  }

  if (activeView === "admin-deleted") {
    return (
      <AdminClaimsSection
        searchParams={resolvedSearchParams}
        pagination={{ cursor, prevCursor: previousCursorToken }}
        mode="deleted"
        defaultFiltersExpanded={viewerContextResult.activeScope === "finance"}
      />
    );
  }

  if (activeView === "department") {
    return (
      <DepartmentClaimsSection
        searchParams={resolvedSearchParams}
        pagination={{ cursor, prevCursor: previousCursorToken }}
        defaultFiltersExpanded={viewerContextResult.activeScope === "finance"}
      />
    );
  }

  if (activeView === "approvals") {
    return (
      <ClaimsApprovalsSection
        userId={userId}
        viewerContext={viewerContextResult}
        searchParams={resolvedSearchParams}
        filters={filters}
        defaultFiltersExpanded={viewerContextResult.activeScope === "finance"}
      />
    );
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

      <Suspense key={JSON.stringify(resolvedSearchParams)} fallback={<MyClaimsContentSkeleton />}>
        <ClaimsCommandCenterTable
          userId={userId}
          cursor={cursor}
          previousCursorToken={previousCursorToken}
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

  if (
    !requestedView &&
    requestedOrDefaultView === "approvals" &&
    !firstParamValue(searchParams?.status)
  ) {
    const defaultStatus = getDefaultApprovalsStatusFilter(viewerContextResult.activeScope);
    if (defaultStatus) {
      const params = toSearchParams(searchParams);
      params.delete("cursor");
      params.delete("prevCursor");
      params.delete("page");
      params.set("view", "approvals");
      params.set("status", defaultStatus);
      redirect(`${ROUTES.claims.myClaims}?${params.toString()}`);
    }
  }

  const activeView = resolveView(
    requestedOrDefaultView,
    viewerContextResult.canViewApprovals,
    isAdminUser,
    isDeptViewer,
  );

  const submissionsHref = buildViewHref(searchParams, "submissions");
  const approvalsHref = buildApprovalsViewHref(searchParams, viewerContextResult.activeScope);
  const adminHref = buildViewHref(searchParams, "admin");
  const adminDeletedHref = buildViewHref(searchParams, "admin-deleted");
  const departmentHref = buildViewHref(searchParams, "department");
  const approvalsLabel =
    viewerContextResult.activeScope === "finance" ? "Finance Queue" : "Approvals";
  const availableViewModes: Array<{ mode: ViewMode; href: string; label: string }> = [
    { mode: "submissions", href: submissionsHref, label: "My Submissions" },
    ...(viewerContextResult.canViewApprovals
      ? [{ mode: "approvals" as const, href: approvalsHref, label: approvalsLabel }]
      : []),
    ...(isAdminUser
      ? [
          { mode: "admin" as const, href: adminHref, label: "Admin Active" },
          { mode: "admin-deleted" as const, href: adminDeletedHref, label: "Admin Deleted" },
        ]
      : []),
    ...(isDeptViewer
      ? [{ mode: "department" as const, href: departmentHref, label: "Department Claims" }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="dashboard-font-display text-2xl font-semibold leading-tight text-foreground">
              Claims
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Command center for submissions and approvals
            </p>
          </div>
          <Link
            href={ROUTES.claims.new}
            prefetch={false}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium text-white transition hover:opacity-90"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <CirclePlus className="h-4 w-4" aria-hidden="true" />
            New Claim
          </Link>
        </div>

        {availableViewModes.length > 1 ? (
          <div
            className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
            role="tablist"
            aria-label="Claim views"
          >
            {availableViewModes.map((item) => (
              <Link
                key={item.mode}
                href={item.href}
                prefetch={false}
                role="tab"
                aria-selected={activeView === item.mode}
                aria-current={activeView === item.mode ? "page" : undefined}
                className={`inline-flex h-[34px] items-center whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors ${
                  activeView === item.mode
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-border bg-card text-muted-foreground hover:bg-background-secondary hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <Suspense fallback={<MyClaimsShellSkeleton />}>
        <MyClaimsDashboardPageContent
          searchParams={searchParams}
          activeView={activeView}
          viewerContextResult={viewerContextResult}
          userId={userId}
        />
      </Suspense>
    </div>
  );
}

async function ClaimsDataComponent({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}) {
  const [resolvedSearchParams, currentUserResult] = await Promise.all([
    searchParams,
    getCachedCurrentUser(),
  ]);

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }
  const userId = currentUserResult.user.id;

  return (
    <div className="mx-auto w-full max-w-[1600px] pb-16">
      <Suspense fallback={<MyClaimsFullPageSkeleton />}>
        <MyClaimsDashboardResolvedContent searchParams={resolvedSearchParams} userId={userId} />
      </Suspense>
    </div>
  );
}

export default function MyClaimsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}) {
  return (
    <Suspense fallback={<MyClaimsFullPageSkeleton />}>
      <ClaimsDataComponent searchParams={searchParams} />
    </Suspense>
  );
}
