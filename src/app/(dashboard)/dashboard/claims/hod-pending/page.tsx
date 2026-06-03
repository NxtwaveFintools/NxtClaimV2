import { notFound, redirect } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS } from "@/core/constants/statuses";
import type {
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { normalizeIsoDateOnly } from "@/lib/date-only";
import { firstParamValue, toSearchParams } from "@/lib/pagination-helpers";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { getCachedPendingApprovalsViewerContext } from "@/modules/claims/server/get-pending-approvals-viewer-context";
import { ClaimsApprovalsSection } from "@/modules/claims/ui/claims-approvals-section";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

type SearchParamsValue = string | string[] | undefined;

export const metadata = {
  title: "HOD Pending Claims | NxtClaim",
};

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

function buildClaimFilters(searchParams?: Record<string, SearchParamsValue>): GetMyClaimsFilters {
  const submissionType = normalizeSubmissionType(firstParamValue(searchParams?.submission_type));
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
  const paymentModeId = normalizeLookupId(firstParamValue(searchParams?.payment_mode_id));
  const departmentId = normalizeLookupId(firstParamValue(searchParams?.department_id));
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
    status: [DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS],
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

function buildCanonicalHref(searchParams: Record<string, SearchParamsValue>): string {
  const params = toSearchParams(searchParams);
  const currentStatus = params.get("status");

  params.delete("view");
  params.set("status", DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS);

  if (currentStatus !== DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS) {
    params.delete("cursor");
    params.delete("prevCursor");
    params.delete("page");
  }

  const query = params.toString();
  return query ? `${ROUTES.claims.hodPending}?${query}` : ROUTES.claims.hodPending;
}

export default async function FinanceHodPendingClaimsPage({
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

  const canonicalHref = buildCanonicalHref(resolvedSearchParams);
  const currentHref = (() => {
    const params = toSearchParams(resolvedSearchParams).toString();
    return params ? `${ROUTES.claims.hodPending}?${params}` : ROUTES.claims.hodPending;
  })();

  if (canonicalHref !== currentHref) {
    redirect(canonicalHref);
  }

  const viewerContext = await getCachedPendingApprovalsViewerContext(currentUserResult.user.id);

  if (viewerContext.errorMessage) {
    return (
      <div className="mx-auto w-full max-w-[1600px] pb-16">
        <section className="rounded-xl border border-rose-200 bg-card px-4 py-5 dark:border-rose-900/50">
          <h1 className="dashboard-font-display text-xl font-bold text-foreground">
            HOD Pending Claims
          </h1>
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {getUserFriendlyErrorMessage(viewerContext.errorMessage, "claim-list")}
          </p>
        </section>
      </div>
    );
  }

  if (viewerContext.activeScope !== "finance") {
    notFound();
  }

  const filters = buildClaimFilters(resolvedSearchParams);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-3 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="dashboard-font-display text-2xl font-semibold leading-tight text-foreground">
            HOD Pending Claims
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only finance observability for claims still awaiting L1 approval
          </p>
        </div>
        <span className="inline-flex h-[28px] items-center rounded-full border border-amber-200 bg-amber-50 px-[10px] text-xs font-semibold text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-300">
          Read Only
        </span>
      </div>

      <ClaimsApprovalsSection
        userId={currentUserResult.user.id}
        viewerContext={viewerContext}
        searchParams={resolvedSearchParams}
        filters={filters}
        exportScope="finance_hod_pending"
        defaultFiltersExpanded
        showAdvancedFilters
        storageScope="finance_hod_pending"
        lockedStatus={DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS}
        statusFilterMode="disabled"
        readOnly
        dataMode="finance_hod_pending"
      />
    </div>
  );
}
