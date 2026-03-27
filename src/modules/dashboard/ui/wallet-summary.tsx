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

  return (
    <section className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 p-4 transition-colors dark:border-zinc-800 dark:bg-zinc-900/70">
      <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Wallet Summary</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
            Amount Received
          </p>
          <p className="mt-2 text-2xl font-semibold text-emerald-900 dark:text-emerald-100">
            {formatInr(summary.amountReceived)}
          </p>
          <p className="mt-2 text-xs text-emerald-800/90 dark:text-emerald-200/90">
            Petty Cash Received: {formatInr(summary.totalPettyCashReceived)} | Reimbursements:{" "}
            {formatInr(summary.totalReimbursements)}
          </p>
        </article>

        <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
            Amount Spent
          </p>
          <p className="mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-100">
            {formatInr(summary.amountSpent)}
          </p>
          <p className="mt-2 text-xs text-amber-800/90 dark:text-amber-200/90">
            Total Petty Cash Utilized
          </p>
        </article>

        <article className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900/60 dark:bg-sky-950/30">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
            Petty Cash Balance
          </p>
          <p
            className={`mt-2 text-2xl font-semibold ${isNegativeBalance ? "text-rose-700 dark:text-rose-300" : "text-sky-900 dark:text-sky-100"}`}
          >
            {formatInr(summary.pettyCashBalance)}
          </p>
          <p
            className={`mt-2 text-xs ${isNegativeBalance ? "text-rose-700/90 dark:text-rose-300/90" : "text-sky-800/90 dark:text-sky-200/90"}`}
          >
            {isNegativeBalance
              ? "Company Owed = Petty Cash Spent - Petty Cash Received"
              : "Balance = Petty Cash Received - Petty Cash Spent"}
          </p>
        </article>
      </div>
    </section>
  );
}
