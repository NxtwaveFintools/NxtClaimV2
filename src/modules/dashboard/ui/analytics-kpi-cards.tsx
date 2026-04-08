"use client";

import CountUp from "react-countup";
import { Building2, CheckCircle2, Clock3, Wallet, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import type {
  DashboardAnalyticsAmountSummary,
  DashboardAnalyticsAmountTrendItem,
  DashboardAnalyticsScope,
  DashboardAnalyticsTrendSummary,
} from "@/core/domain/dashboard/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AnalyticsKpiCardsProps = {
  scope: DashboardAnalyticsScope;
  amounts: DashboardAnalyticsAmountSummary;
  trends: DashboardAnalyticsTrendSummary | null;
};

type DashboardAnalyticsAmountMetricKey = Exclude<
  keyof DashboardAnalyticsAmountSummary,
  "hodPendingCount"
>;

type KpiConfig = {
  key: DashboardAnalyticsAmountMetricKey;
  title: string;
  icon: ComponentType<{ className?: string }>;
  valueClassName: string;
  iconClassName: string;
  trendKey: keyof DashboardAnalyticsTrendSummary;
  helperText?: (amounts: DashboardAnalyticsAmountSummary) => string | null;
};

const KPI_CONFIG: KpiConfig[] = [
  {
    key: "totalAmount",
    title: "Total Amount",
    icon: Wallet,
    valueClassName: "text-zinc-950 dark:text-zinc-50",
    iconClassName: "text-sky-500",
    trendKey: "total",
  },
  {
    key: "approvedAmount",
    title: "Approved Amount",
    icon: CheckCircle2,
    valueClassName: "text-emerald-700 dark:text-emerald-300",
    iconClassName: "text-emerald-500",
    trendKey: "approved",
  },
  {
    key: "pendingAmount",
    title: "Pending Amount",
    icon: Clock3,
    valueClassName: "text-amber-700 dark:text-amber-300",
    iconClassName: "text-amber-500",
    trendKey: "pending",
  },
  {
    key: "hodPendingAmount",
    title: "Pending At HOD",
    icon: Building2,
    valueClassName: "text-orange-700 dark:text-orange-300",
    iconClassName: "text-orange-500",
    trendKey: "hodPending",
    helperText: (amounts) => {
      const claimCount = amounts.hodPendingCount;
      return `${claimCount} claim${claimCount === 1 ? "" : "s"}`;
    },
  },
  {
    key: "rejectedAmount",
    title: "Rejected Amount",
    icon: XCircle,
    valueClassName: "text-rose-700 dark:text-rose-300",
    iconClassName: "text-rose-500",
    trendKey: "rejected",
  },
];

function TrendBadge({ trend }: { trend: DashboardAnalyticsAmountTrendItem | null }) {
  if (!trend) {
    return null;
  }

  if (trend.percentageChange === null) {
    return null;
  }

  const roundedValue = Math.abs(trend.percentageChange).toFixed(2);

  if (trend.percentageChange > 0) {
    return (
      <span className="rounded-full border border-emerald-300/70 bg-emerald-100/80 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/40 dark:text-emerald-300">
        +{roundedValue}%
      </span>
    );
  }

  if (trend.percentageChange < 0) {
    return (
      <span className="rounded-full border border-rose-300/70 bg-rose-100/80 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/40 dark:text-rose-300">
        -{roundedValue}%
      </span>
    );
  }

  return (
    <span className="rounded-full border border-zinc-300/70 bg-white/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
      0.00%
    </span>
  );
}

export function AnalyticsKpiCards({ scope, amounts, trends }: AnalyticsKpiCardsProps) {
  const visibleKpiConfig =
    scope === "finance" || scope === "admin"
      ? KPI_CONFIG
      : KPI_CONFIG.filter((item) => item.key !== "hodPendingAmount");

  const gridColumnsClass = visibleKpiConfig.length > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4";

  return (
    <div className={`grid gap-4 md:grid-cols-2 ${gridColumnsClass}`}>
      {visibleKpiConfig.map((item) => {
        const Icon = item.icon;
        const trendItem = trends ? trends[item.trendKey] : null;
        const helperText = item.helperText?.(amounts) ?? null;

        return (
          <Card key={item.key} className="border-white/30 bg-white/60 dark:bg-zinc-900/55">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xs uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
                  {item.title}
                </CardTitle>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/30 bg-white/80 dark:bg-zinc-900/70">
                  <Icon className={`h-4.5 w-4.5 ${item.iconClassName}`} />
                </span>
              </div>
              <TrendBadge trend={trendItem} />
            </CardHeader>
            <CardContent>
              <p
                className={`dashboard-font-display text-3xl font-semibold tracking-[-0.03em] ${item.valueClassName}`}
              >
                <CountUp
                  end={amounts[item.key]}
                  decimals={2}
                  duration={2}
                  prefix="₹"
                  separator=","
                  preserveValue
                />
              </p>
              {helperText ? (
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                  {helperText}
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
