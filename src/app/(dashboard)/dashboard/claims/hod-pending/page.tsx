import { notFound, redirect } from "next/navigation";
import { AppShellHeader } from "@/components/app-shell-header";
import { BackButton } from "@/components/ui/back-button";
import { ROUTES } from "@/core/config/route-registry";
import { DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS } from "@/core/constants/statuses";
import type {
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { normalizeIsoDateOnly } from "@/lib/date-only";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";
import { firstParamValue, toSearchParams } from "@/lib/pagination-helpers";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { getCachedPendingApprovalsViewerContext } from "@/modules/claims/server/get-pending-approvals-viewer-context";
import { ClaimsApprovalsSection } from "@/modules/claims/ui/claims-approvals-section";

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
      <div
        className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
      >
        <AppShellHeader currentEmail={currentUserResult.user.email ?? null} />

        <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <main className="space-y-5">
            <BackButton className="w-fit" fallbackHref={ROUTES.claims.myClaims} />

            <section className="rounded-[28px] border border-rose-200 bg-white/92 px-5 py-6 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] dark:border-rose-900/50 dark:bg-zinc-900/92 dark:shadow-black/25">
              <h1 className="dashboard-font-display text-xl font-bold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
                HOD Pending Claims
              </h1>
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                Unable to load finance observability view. {viewerContext.errorMessage}
              </p>
            </section>
          </main>
        </div>
      </div>
    );
  }

  if (viewerContext.activeScope !== "finance") {
    notFound();
  }

  const filters = buildClaimFilters(resolvedSearchParams);

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
    >
      <AppShellHeader currentEmail={currentUserResult.user.email ?? null} />

      <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <main className="space-y-5">
          <BackButton className="w-fit" fallbackHref={ROUTES.claims.myClaims} />

          <section className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-white/88 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.14),0_8px_24px_-8px_rgba(99,102,241,0.05)] backdrop-blur-lg transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/88 dark:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.40)]">
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />

            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="dashboard-font-display text-xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-2xl lg:text-3xl dark:text-zinc-50">
                    HOD Pending Claims
                  </h1>
                  <p className="mt-1 text-xs text-zinc-500 sm:text-sm dark:text-zinc-400">
                    Read-only finance observability for claims still awaiting L1 approval
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-300">
                  Read Only
                </span>
              </div>
            </div>
          </section>

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
        </main>
      </div>
    </div>
  );
}
