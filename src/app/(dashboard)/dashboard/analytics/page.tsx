import { redirect } from "next/navigation";
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
import { AnalyticsCharts } from "@/modules/dashboard/ui/analytics-charts";
import { AnalyticsFilters } from "@/modules/dashboard/ui/analytics-filters";
import { AnalyticsKpiCards } from "@/modules/dashboard/ui/analytics-kpi-cards";

type SearchParamsValue = string | string[] | undefined;

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

  const analyticsResult = await getAnalyticsService.execute({
    userId: currentUserResult.user.id,
    filter: {
      startDate: from,
      endDate: to,
      departmentId,
      expenseCategoryId,
      productId,
      financeApproverId,
    },
  });

  const analytics = analyticsResult.data;
  const isAdmin = analytics?.scope === "admin";
  const advancedFilters = analytics?.advancedFilters ?? {
    canUseScopeFilters: false,
    canUseFinanceApproverFilter: false,
    departments: [],
    expenseCategories: [],
    products: [],
    financeApprovers: [],
  };

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

            <AnalyticsFilters
              key={`${from ?? ""}-${to ?? ""}-${departmentId ?? ""}-${expenseCategoryId ?? ""}-${productId ?? ""}-${financeApproverId ?? ""}`}
              fromDate={from ?? ""}
              toDate={to ?? ""}
              selectedDepartmentId={departmentId ?? ""}
              selectedExpenseCategoryId={expenseCategoryId ?? ""}
              selectedProductId={productId ?? ""}
              selectedFinanceApproverId={financeApproverId ?? ""}
              canUseScopeFilters={advancedFilters.canUseScopeFilters}
              canUseFinanceApproverFilter={advancedFilters.canUseFinanceApproverFilter}
              departmentOptions={advancedFilters.departments}
              expenseCategoryOptions={advancedFilters.expenseCategories}
              productOptions={advancedFilters.products}
              financeApproverOptions={advancedFilters.financeApprovers}
            />
          </div>
        </section>

        {analyticsResult.errorMessage || !analytics ? (
          <Card className="border-rose-200/70 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20">
            <CardContent className="pt-5">
              <p className="text-sm text-rose-700 dark:text-rose-300">
                Unable to load analytics. {analyticsResult.errorMessage}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <AnalyticsKpiCards amounts={analytics.amounts} trends={analytics.trends} />

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
                          <li
                            key={item.departmentId}
                            className="flex items-center justify-between gap-4"
                          >
                            <span className="text-muted-foreground">{item.departmentName}</span>
                            <span className="text-right font-medium text-foreground">
                              {item.averageDaysToApproval.toFixed(2)} days | {item.sampleCount}{" "}
                              claims
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
        )}
      </main>
    </div>
  );
}
