import nextDynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { Suspense, cache } from "react";
import { AppShellHeader } from "@/components/app-shell-header";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/core/config/route-registry";
import { GetAnalyticsService } from "@/core/domain/dashboard/GetAnalyticsService";
import { logger } from "@/core/infra/logging/logger";
import { formatCurrency } from "@/lib/format";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";
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

const DATE_FORMAT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  if (!value) {
    return undefined;
  }

  return DATE_FORMAT_PATTERN.test(value) ? value : undefined;
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
    <Card className="border-rose-200/70 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20">
      <CardContent className="pt-5">
        <p className="text-sm text-rose-700 dark:text-rose-300">
          Unable to load analytics. {analyticsResult.errorMessage}
        </p>
      </CardContent>
    </Card>
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

  return <AnalyticsKpiCards amounts={analytics.amounts} trends={analytics.trends} />;
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
    <>
      <AnalyticsCharts
        statusBreakdown={analytics.statusBreakdown}
        paymentModeBreakdown={analytics.paymentModeBreakdown}
        efficiencyByDepartment={analytics.efficiencyByDepartment}
        isAdmin={isAdmin}
      />

      <div className={`grid gap-4 ${isAdmin ? "xl:grid-cols-2" : "xl:grid-cols-1"}`}>
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>Status Summary (Raw)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {analytics.statusBreakdown.map((item) => (
                <li key={item.status} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{item.status}</span>
                  <span className="text-right font-medium text-foreground">
                    {item.count} claims | {formatCurrency(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {isAdmin ? (
          <Card className="xl:col-span-1">
            <CardHeader>
              <CardTitle>Efficiency Summary (Raw)</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics.efficiencyByDepartment.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approval efficiency records in this period.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {analytics.efficiencyByDepartment.map((item) => (
                    <li key={item.departmentId} className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">{item.departmentName}</span>
                      <span className="text-right font-medium text-foreground">
                        {item.averageDaysToApproval.toFixed(2)} days | {item.sampleCount} claims
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function AnalyticsFiltersSkeleton() {
  return (
    <div className="w-full space-y-3 rounded-2xl border border-white/20 bg-white/40 p-4 backdrop-blur-md dark:bg-zinc-900/40">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={`analytics-filter-skeleton-${index}`} className="space-y-2">
            <div className="shimmer-sweep h-3 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-10 w-full rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <div className="shimmer-sweep h-10 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        <div className="shimmer-sweep h-10 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
      </div>
    </div>
  );
}

function AnalyticsKpiSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card
          key={`analytics-kpi-skeleton-${index}`}
          className="border-white/30 bg-white/60 dark:bg-zinc-900/55"
        >
          <CardHeader className="space-y-3 pb-3">
            <div className="shimmer-sweep h-4 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-6 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          </CardHeader>
          <CardContent>
            <div className="shimmer-sweep h-9 w-40 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AnalyticsChartsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <Card
            key={`analytics-chart-skeleton-${index}`}
            className="border-white/30 bg-white/60 dark:bg-zinc-900/55"
          >
            <CardHeader>
              <div className="shimmer-sweep h-6 w-52 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            </CardHeader>
            <CardContent>
              <div className="shimmer-sweep h-[320px] w-full rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border-white/30 bg-white/60 dark:bg-zinc-900/55">
        <CardHeader>
          <div className="shimmer-sweep h-6 w-44 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        </CardHeader>
        <CardContent>
          <div className="shimmer-sweep h-[300px] w-full rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        </CardContent>
      </Card>
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

  const params = resolveAnalyticsQueryParams(resolvedSearchParams);

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
    >
      <AppShellHeader currentEmail={currentUserResult.user.email ?? null} />

      <main className="mx-auto max-w-400 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <BackButton fallbackHref={ROUTES.dashboard} className="w-fit" />

        <section className="rounded-[30px] border border-white/20 bg-gradient-to-br from-sky-100/55 via-white/72 to-cyan-100/45 p-5 shadow-[0_28px_85px_-42px_rgba(14,116,144,0.45)] backdrop-blur-md dark:from-zinc-900/80 dark:via-zinc-900/70 dark:to-sky-950/50 lg:p-6">
          <div className="space-y-4">
            <div>
              <h1 className="dashboard-font-display text-3xl font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
                Analytics Command Center
              </h1>
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                Enterprise claim intelligence with trend signals and approval-efficiency insights.
              </p>
            </div>

            <Suspense fallback={<AnalyticsFiltersSkeleton />}>
              <AnalyticsFiltersFetcher userId={currentUserResult.user.id} params={params} />
            </Suspense>
          </div>
        </section>

        <Suspense fallback={null}>
          <AnalyticsErrorBannerFetcher userId={currentUserResult.user.id} params={params} />
        </Suspense>

        <Suspense fallback={<AnalyticsKpiSkeleton />}>
          <AnalyticsKpiFetcher userId={currentUserResult.user.id} params={params} />
        </Suspense>

        <Suspense fallback={<AnalyticsChartsSkeleton />}>
          <AnalyticsChartsFetcher userId={currentUserResult.user.id} params={params} />
        </Suspense>
      </main>
    </div>
  );
}
