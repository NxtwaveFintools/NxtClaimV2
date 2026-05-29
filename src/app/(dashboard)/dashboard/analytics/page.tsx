import nextDynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { Suspense, cache } from "react";
import { FilterToolbarSkeleton, Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/core/config/route-registry";
import { GetAnalyticsService } from "@/core/domain/dashboard/GetAnalyticsService";
import { logger } from "@/core/infra/logging/logger";
import { normalizeIsoDateOnly } from "@/lib/date-only";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";

type SearchParamsValue = string | string[] | undefined;

type AnalyticsQueryParams = {
  from?: string;
  to?: string;
  departmentId?: string;
  expenseCategoryId?: string;
  productId?: string;
  financeApproverId?: string;
  key: string;
};

export const metadata = {
  title: "Analytics Dashboard | NxtClaim",
};

export const dynamic = "force-dynamic";

const dashboardRepository = new SupabaseDashboardRepository();
const getAnalyticsService = new GetAnalyticsService({
  repository: dashboardRepository,
  logger,
});

const AnalyticsCharts = nextDynamic(
  () => import("@/modules/dashboard/ui/analytics-charts").then((module) => module.AnalyticsCharts),
  {
    loading: () => <AnalyticsChartsSkeleton />,
  },
);

const AnalyticsFilters = nextDynamic(
  () =>
    import("@/modules/dashboard/ui/analytics-filters").then((module) => module.AnalyticsFilters),
  {
    loading: () => <AnalyticsFiltersSkeleton />,
  },
);

const AnalyticsKpiCards = nextDynamic(
  () =>
    import("@/modules/dashboard/ui/analytics-kpi-cards").then((module) => module.AnalyticsKpiCards),
  {
    loading: () => <AnalyticsKpiSkeleton />,
  },
);

const getCachedAnalyticsResult = cache(
  async (
    userId: string,
    from: string | undefined,
    to: string | undefined,
    departmentId: string | undefined,
    expenseCategoryId: string | undefined,
    productId: string | undefined,
    financeApproverId: string | undefined,
  ) => {
    return getAnalyticsService.execute({
      userId,
      filter: {
        startDate: from,
        endDate: to,
        departmentId,
        expenseCategoryId,
        productId,
        financeApproverId,
      },
    });
  },
);

function firstParamValue(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeDate(value: string | undefined): string | undefined {
  return normalizeIsoDateOnly(value);
}

function normalizeIdentifier(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveAnalyticsQueryParams(
  resolvedSearchParams: Record<string, SearchParamsValue>,
): AnalyticsQueryParams {
  const from = normalizeDate(firstParamValue(resolvedSearchParams.from));
  const to = normalizeDate(firstParamValue(resolvedSearchParams.to));
  const departmentId = normalizeIdentifier(firstParamValue(resolvedSearchParams.department_id));
  const expenseCategoryId =
    normalizeIdentifier(firstParamValue(resolvedSearchParams.category)) ||
    normalizeIdentifier(firstParamValue(resolvedSearchParams.expense_category_id));
  const productId =
    normalizeIdentifier(firstParamValue(resolvedSearchParams.product)) ||
    normalizeIdentifier(firstParamValue(resolvedSearchParams.product_id));
  const financeApproverId = normalizeIdentifier(
    firstParamValue(resolvedSearchParams.finance_approver_id),
  );

  return {
    from,
    to,
    departmentId,
    expenseCategoryId,
    productId,
    financeApproverId,
    key: `${from ?? ""}-${to ?? ""}-${departmentId ?? ""}-${expenseCategoryId ?? ""}-${productId ?? ""}-${financeApproverId ?? ""}`,
  };
}

async function AnalyticsFiltersFetcher({
  userId,
  params,
}: {
  userId: string;
  params: AnalyticsQueryParams;
}) {
  const analyticsResult = await getCachedAnalyticsResult(
    userId,
    params.from,
    params.to,
    params.departmentId,
    params.expenseCategoryId,
    params.productId,
    params.financeApproverId,
  );

  const analytics = analyticsResult.data;
  const advancedFilters = analytics?.advancedFilters ?? {
    canUseScopeFilters: false,
    canUseFinanceApproverFilter: false,
    departments: [],
    expenseCategories: [],
    products: [],
    financeApprovers: [],
  };

  return (
    <AnalyticsFilters
      key={params.key}
      fromDate={params.from ?? ""}
      toDate={params.to ?? ""}
      selectedDepartmentId={params.departmentId ?? ""}
      selectedExpenseCategoryId={params.expenseCategoryId ?? ""}
      selectedProductId={params.productId ?? ""}
      selectedFinanceApproverId={params.financeApproverId ?? ""}
      canUseScopeFilters={advancedFilters.canUseScopeFilters}
      canUseFinanceApproverFilter={advancedFilters.canUseFinanceApproverFilter}
      departmentOptions={advancedFilters.departments}
      expenseCategoryOptions={advancedFilters.expenseCategories}
      productOptions={advancedFilters.products}
      financeApproverOptions={advancedFilters.financeApprovers}
    />
  );
}

async function AnalyticsErrorBannerFetcher({
  userId,
  params,
}: {
  userId: string;
  params: AnalyticsQueryParams;
}) {
  const analyticsResult = await getCachedAnalyticsResult(
    userId,
    params.from,
    params.to,
    params.departmentId,
    params.expenseCategoryId,
    params.productId,
    params.financeApproverId,
  );

  if (!analyticsResult.errorMessage || analyticsResult.data) {
    return null;
  }

  return (
    <div className="rounded-xl border border-rose-200/70 bg-rose-50/70 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
      <p className="text-sm text-rose-700 dark:text-rose-300">
        Unable to load analytics. {analyticsResult.errorMessage}
      </p>
    </div>
  );
}

async function AnalyticsKpiFetcher({
  userId,
  params,
}: {
  userId: string;
  params: AnalyticsQueryParams;
}) {
  const analyticsResult = await getCachedAnalyticsResult(
    userId,
    params.from,
    params.to,
    params.departmentId,
    params.expenseCategoryId,
    params.productId,
    params.financeApproverId,
  );

  const analytics = analyticsResult.data;
  if (analyticsResult.errorMessage || !analytics) {
    return null;
  }

  return (
    <AnalyticsKpiCards
      scope={analytics.scope}
      amounts={analytics.amounts}
      trends={analytics.trends}
      overallFinanceTatAverage={analytics.overallFinanceTatAverage}
      overallFinanceTatSampleCount={analytics.overallFinanceTatSampleCount}
    />
  );
}

async function AnalyticsChartsFetcher({
  userId,
  params,
}: {
  userId: string;
  params: AnalyticsQueryParams;
}) {
  const analyticsResult = await getCachedAnalyticsResult(
    userId,
    params.from,
    params.to,
    params.departmentId,
    params.expenseCategoryId,
    params.productId,
    params.financeApproverId,
  );

  const analytics = analyticsResult.data;
  if (analyticsResult.errorMessage || !analytics) {
    return null;
  }

  const isAdmin = analytics.scope === "admin";

  return (
    <AnalyticsCharts
      statusBreakdown={analytics.statusBreakdown}
      paymentModeBreakdown={analytics.paymentModeBreakdown}
      efficiencyByDepartment={analytics.efficiencyByDepartment}
      financeApproverTatBreakdown={analytics.financeApproverTatBreakdown}
      isAdmin={isAdmin}
      overallFinanceTatAverage={analytics.overallFinanceTatAverage}
      overallFinanceTatSampleCount={analytics.overallFinanceTatSampleCount}
    />
  );
}

function AnalyticsFiltersSkeleton() {
  return <FilterToolbarSkeleton fields={7} />;
}

function AnalyticsKpiSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={`analytics-kpi-skeleton-${index}`}
          className="rounded-xl border border-border bg-card p-4"
        >
          <Skeleton className="mb-3 h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

function AnalyticsChartsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-h-[320px] rounded-xl border border-border bg-card p-4">
          <Skeleton className="mb-3 h-5 w-44" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Skeleton className="h-[190px] w-[190px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`payment-legend-skeleton-${index}`} className="flex items-center gap-2">
                  <Skeleton className="h-3 w-3 rounded-sm" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-10" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-[320px] rounded-xl border border-border bg-card p-4">
          <Skeleton className="mb-3 h-5 w-36" />
          <div className="space-y-4 pt-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`status-bar-skeleton-${index}`}
                className="grid grid-cols-[120px_1fr] items-center gap-3"
              >
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="grid grid-cols-3 gap-3 p-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={`analytics-summary-cell-${index}`} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function AnalyticsDashboardPage({
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

  const user = currentUserResult.user;
  const params = resolveAnalyticsQueryParams(resolvedSearchParams);

  return (
    <div className="space-y-4">
      <div>
        <h1
          className="dashboard-font-display text-2xl font-semibold tracking-[-0.02em] text-foreground"
          style={{ fontSize: 24 }}
        >
          Analytics
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground" style={{ fontSize: 14 }}>
          Claim intelligence, trends, and approval efficiency.
        </p>
      </div>

      <Suspense fallback={<AnalyticsFiltersSkeleton />}>
        <AnalyticsFiltersFetcher userId={user.id} params={params} />
      </Suspense>

      <Suspense fallback={null}>
        <AnalyticsErrorBannerFetcher userId={user.id} params={params} />
      </Suspense>

      <Suspense fallback={<AnalyticsKpiSkeleton />}>
        <AnalyticsKpiFetcher userId={user.id} params={params} />
      </Suspense>

      <Suspense fallback={<AnalyticsChartsSkeleton />}>
        <AnalyticsChartsFetcher userId={user.id} params={params} />
      </Suspense>
    </div>
  );
}
