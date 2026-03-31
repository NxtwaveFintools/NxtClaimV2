import { CircleArrowDown, CircleArrowUp, Wallet } from "lucide-react";
import type { WalletSummaryTotals } from "@/core/domain/dashboard/contracts";

type WalletSummaryProps = {
  summary: WalletSummaryTotals;
};

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatInr(value: number): string {
  const formatted = inrFormatter.format(Math.abs(value));
  return value < 0 ? `-${formatted}` : formatted;
}

export function WalletSummary({ summary }: WalletSummaryProps) {
  const isNegativeBalance = summary.pettyCashBalance < 0;
  const metrics = [
    {
      label: "Amount Received",
      value: formatInr(summary.amountReceived),
      supportingText: `Petty Cash: ${formatInr(summary.totalPettyCashReceived)} | Reimbursements: ${formatInr(summary.totalReimbursements)}`,
      icon: CircleArrowDown,
      cardClassName:
        "border-emerald-200 bg-emerald-50/90 dark:border-emerald-900/50 dark:bg-emerald-950/30",
      iconClassName:
        "border-emerald-200 bg-white text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950 dark:text-emerald-300",
      labelClassName: "text-emerald-700 dark:text-emerald-300",
      valueClassName: "text-emerald-950 dark:text-emerald-50",
      supportingClassName: "text-emerald-800/80 dark:text-emerald-200/90",
    },
    {
      label: "Amount Spent",
      value: formatInr(summary.amountSpent),
      supportingText: "Total petty cash utilized across submitted claims",
      icon: CircleArrowUp,
      cardClassName:
        "border-amber-200 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/30",
      iconClassName:
        "border-amber-200 bg-white text-amber-600 dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-300",
      labelClassName: "text-amber-700 dark:text-amber-300",
      valueClassName: "text-amber-950 dark:text-amber-50",
      supportingClassName: "text-amber-800/80 dark:text-amber-200/90",
    },
    {
      label: "Petty Cash Balance",
      value: formatInr(summary.pettyCashBalance),
      supportingText: isNegativeBalance
        ? "Company owed = petty cash spent minus petty cash received"
        : "Available balance = petty cash received minus petty cash spent",
      icon: Wallet,
      cardClassName: "border-sky-200 bg-sky-50/90 dark:border-sky-900/50 dark:bg-sky-950/30",
      iconClassName:
        "border-sky-200 bg-white text-sky-600 dark:border-sky-900/60 dark:bg-sky-950 dark:text-sky-300",
      labelClassName: "text-sky-700 dark:text-sky-300",
      valueClassName: isNegativeBalance
        ? "text-rose-700 dark:text-rose-300"
        : "text-sky-950 dark:text-sky-50",
      supportingClassName: isNegativeBalance
        ? "text-rose-700/90 dark:text-rose-300/90"
        : "text-sky-800/80 dark:text-sky-200/90",
    },
  ];

  return (
    <section className="overflow-hidden rounded-[30px] border border-zinc-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.34)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-black/25">
      <div>
        <h2 className="dashboard-font-display text-2xl font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
          Wallet Summary
        </h2>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <article
              key={metric.label}
              className={`relative overflow-hidden rounded-[26px] border p-5 shadow-sm shadow-zinc-900/5 ${metric.cardClassName}`}
            >
              <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/60 to-transparent dark:from-white/5 dark:to-transparent" />
              <div className="flex items-start justify-between gap-4">
                <div className="relative">
                  <p
                    className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${metric.labelClassName}`}
                  >
                    {metric.label}
                  </p>
                  <p
                    className={`dashboard-font-display mt-4 text-xl font-semibold tracking-[-0.02em] sm:text-2xl ${metric.valueClassName}`}
                  >
                    {metric.value}
                  </p>
                </div>
                <span
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm ${metric.iconClassName}`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
              </div>

              <div className="relative mt-5 border-t border-white/50 pt-4 dark:border-white/10">
                <p className={`text-sm leading-6 ${metric.supportingClassName}`}>
                  {metric.supportingText}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
