"use client";

import CountUp from "react-countup";
import { CheckCircle2, Clock3, Wallet, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import type {
  DashboardAnalyticsAmountSummary,
  DashboardAnalyticsAmountTrendItem,
  DashboardAnalyticsTrendSummary,
} from "@/core/domain/dashboard/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AnalyticsKpiCardsProps = {
  amounts: DashboardAnalyticsAmountSummary;
  trends: DashboardAnalyticsTrendSummary | null;
};

type KpiConfig = {
  key: keyof DashboardAnalyticsAmountSummary;
  title: string;
  icon: ComponentType<{ className?: string }>;
  valueClassName: string;
  iconClassName: string;
  trendKey: keyof DashboardAnalyticsTrendSummary;
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

export function AnalyticsKpiCards({ amounts, trends }: AnalyticsKpiCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {KPI_CONFIG.map((item) => {
        const Icon = item.icon;
        const trendItem = trends ? trends[item.trendKey] : null;

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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
