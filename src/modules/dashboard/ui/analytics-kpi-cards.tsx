"use client";

import { Building2, CheckCircle2, Clock3, Wallet, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import type {
  DashboardAnalyticsAmountSummary,
  DashboardAnalyticsAmountTrendItem,
  DashboardAnalyticsScope,
  DashboardAnalyticsTrendSummary,
} from "@/core/domain/dashboard/contracts";
import { formatCurrency } from "@/lib/format";

type AnalyticsKpiCardsProps = {
  scope: DashboardAnalyticsScope;
  amounts: DashboardAnalyticsAmountSummary;
  trends: DashboardAnalyticsTrendSummary | null;
  overallFinanceTatAverage: number | null;
  overallFinanceTatSampleCount: number;
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
      <span className="inline-flex items-center rounded-full border border-emerald-300/70 bg-emerald-100/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/40 dark:text-emerald-300">
        +{roundedValue}%
      </span>
    );
  }

  if (trend.percentageChange < 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-300/70 bg-rose-100/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/40 dark:text-rose-300">
        -{roundedValue}%
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-zinc-300/70 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
      0.00%
    </span>
  );
}

export function AnalyticsKpiCards({
  scope,
  amounts,
  trends,
  overallFinanceTatAverage,
  overallFinanceTatSampleCount,
}: AnalyticsKpiCardsProps) {
  const visibleKpiConfig =
    scope === "finance" || scope === "admin"
      ? KPI_CONFIG
      : KPI_CONFIG.filter((item) => item.key !== "hodPendingAmount");

  const showFinanceTatCard = scope === "admin" && overallFinanceTatAverage !== null;

  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {visibleKpiConfig.map((item) => {
        const Icon = item.icon;
        const trendItem = trends ? trends[item.trendKey] : null;
        const helperText = item.helperText?.(amounts) ?? null;

        return (
          <div
            key={item.key}
            className="flex flex-col rounded-xl border p-4"
            style={{ minHeight: 104, backgroundColor: "var(--card)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {item.title}
              </span>
              <Icon className={`h-4 w-4 shrink-0 ${item.iconClassName}`} />
            </div>
            <p
              className={`dashboard-font-display mt-2 text-2xl font-bold leading-none ${item.valueClassName}`}
              style={{ lineHeight: 1.1 }}
            >
              {formatCurrency(amounts[item.key])}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <TrendBadge trend={trendItem} />
              {helperText ? (
                <span className="text-xs text-muted-foreground">{helperText}</span>
              ) : null}
            </div>
          </div>
        );
      })}

      {showFinanceTatCard ? (
        <div
          className="flex flex-col rounded-xl border p-4"
          style={{ minHeight: 104, backgroundColor: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Overall Finance Team TAT
            </span>
            <Clock3 className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
          </div>
          <p
            className="dashboard-font-display mt-2 text-2xl font-bold leading-none text-cyan-700 dark:text-cyan-300"
            style={{ lineHeight: 1.1 }}
          >
            {overallFinanceTatAverage.toFixed(2)} days
          </p>
          <span className="mt-1 text-xs text-muted-foreground">
            {overallFinanceTatSampleCount} claim{overallFinanceTatSampleCount === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
