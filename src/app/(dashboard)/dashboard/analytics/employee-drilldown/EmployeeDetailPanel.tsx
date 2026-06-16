"use client";

import { useEffect, useState } from "react";
import { fetchEmployeeClaimDetail } from "./actions";
import { EmployeeClaimDetailPayload } from "@/core/domain/dashboard/contracts";
import { formatCurrency } from "@/lib/format";
import {
  Loader2,
  AlertCircle,
  FileText,
  ArrowUpRight,
  BarChart3,
  TrendingUp,
  HelpCircle,
} from "lucide-react";
import CountUp from "react-countup";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";

type TooltipEntry = {
  payload: {
    categoryName: string;
    amount: number;
    count: number;
  };
};

function CategoryTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;

    return (
      <div className="rounded-xl border border-zinc-200/80 bg-white/90 p-3 shadow-xl backdrop-blur-md dark:border-zinc-800/50 dark:bg-zinc-900/90">
        <p className="text-xs font-bold uppercase text-zinc-500 dark:text-zinc-400">
          {data.categoryName}
        </p>
        <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">
          {formatCurrency(data.amount)}
        </p>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{data.count} Claims</p>
      </div>
    );
  }

  return null;
}

function ShareBar({ pct, colorClass }: { pct: number; colorClass: string }) {
  const width = Math.min(100, Math.max(0, pct * 100));

  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-700/40">
      <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function CategoryTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
}) {
  const full = String(payload?.value ?? "");
  const label = full.length > 18 ? `${full.slice(0, 17)}…` : full;

  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="#71717a" fontSize={11} fontWeight={600}>
      <title>{full}</title>
      {label}
    </text>
  );
}

export function EmployeeDetailPanel({
  employeeId,
  employeeName,
  dateFrom,
  dateTo,
  categoryId,
  status,
}: {
  employeeId: string | null;
  employeeName?: string;
  dateFrom: string;
  dateTo: string;
  categoryId?: string;
  status?: string;
}) {
  const [detail, setDetail] = useState<EmployeeClaimDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchEmployeeClaimDetail({
      employeeId,
      dateFrom,
      dateTo,
      expenseCategoryId: categoryId,
      status,
    }).then((res) => {
      if (!active) return;

      if (res.errorMessage) {
        setError(res.errorMessage);
        setDetail(null);
      } else {
        setDetail(res.data);
      }

      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [employeeId, dateFrom, dateTo, categoryId, status]);

  const totalCategoryCount = (detail?.categoryBreakdown || []).reduce(
    (sum, cat) => sum + (cat.count || 0),
    0,
  );

  const sortedCategories = [...(detail?.categoryBreakdown || [])]
    .filter((cat) => cat.amount && cat.amount > 0)
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));

  const categoryTotalAmount = sortedCategories.reduce((sum, cat) => sum + (cat.amount || 0), 0);

  const chartHeight = Math.max(280, (sortedCategories.length || 0) * 52);

  const shellClassName =
    "flex w-full min-w-0 flex-1 flex-col gap-6 rounded-2xl border border-zinc-200/60 bg-white/60 p-6 shadow-sm backdrop-blur-xl dark:border-zinc-800/50 dark:bg-zinc-900/30 dark:shadow-2xl";

  if (!employeeId) {
    return (
      <div className={shellClassName}>
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-zinc-200/50 bg-zinc-50/60 p-8 text-center dark:border-zinc-800/40 dark:bg-zinc-950/10">
          <div className="flex flex-col items-center">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-zinc-200/70 shadow-inner ring-1 ring-zinc-200 dark:bg-zinc-800/50 dark:ring-zinc-800/50">
              <BarChart3 className="h-10 w-10 text-zinc-500" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
              No Employee Selected
            </h3>
            <p className="mt-2 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              Select an employee from the list to unlock deep analytics, spending behaviors, and
              insights.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={shellClassName}>
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-zinc-200/50 bg-zinc-50/60 dark:border-zinc-800/40 dark:bg-zinc-950/10">
          <Loader2 className="h-10 w-10 animate-spin text-sky-500" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className={shellClassName}>
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-rose-500/20 bg-zinc-50/60 p-8 text-center dark:bg-zinc-950/10">
          <AlertCircle className="mb-4 h-12 w-12 text-rose-500" />
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
            Unable to load analytics
          </h3>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{error}</p>
        </div>
      </div>
    );
  }

  let kpiTitle = "TOTAL AMOUNT";
  let kpiSub = "total claims";

  if (status) {
    const s = status.toLowerCase();
    if (s.includes("submitted - awaiting hod")) {
      kpiTitle = "PENDING AMOUNT";
      kpiSub = "awaiting HOD";
    } else if (s.includes("hod approved")) {
      kpiTitle = "HOD APPROVED AMOUNT";
      kpiSub = "awaiting finance";
    } else if (s.includes("finance approved")) {
      kpiTitle = "PROCESSING AMOUNT";
      kpiSub = "payment under process";
    } else if (s.includes("payment done") || s.includes("closed")) {
      kpiTitle = "SETTLED AMOUNT";
      kpiSub = "settled";
    } else if (s.includes("rejected")) {
      kpiTitle = "REJECTED AMOUNT";
      kpiSub = "rejected";
    } else {
      kpiTitle = "PENDING AMOUNT";
      kpiSub = "in queue";
    }
  }

  const total = detail.totalAmount || 0;
  const expenseShare = total > 0 ? detail.expenseAmount / total : 0;
  const advanceShare = total > 0 ? detail.advanceAmount / total : 0;

  return (
    <div className={shellClassName}>
      {/* Header */}
      <div className="border-b border-zinc-200/60 pb-5 dark:border-zinc-800/50">
        <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          {employeeName || "Unknown Employee"}
        </h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {totalCategoryCount} {totalCategoryCount === 1 ? "Claim" : "Claims"} •{" "}
          {formatCurrency(detail.totalAmount)} Total
        </p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="group relative overflow-hidden rounded-2xl border border-zinc-200/50 bg-white/70 p-5 transition-all hover:bg-white dark:border-zinc-800/40 dark:bg-zinc-800/30 dark:hover:bg-zinc-800/50">
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-sky-500/10 blur-2xl transition-all group-hover:bg-sky-500/20" />
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">
            {kpiTitle}
          </h4>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold text-zinc-900 dark:text-white">
              <CountUp start={0} end={detail.totalAmount} duration={2} separator="," prefix="₹" />
            </span>
          </div>
          <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-700/40">
            <div className="h-full bg-sky-500" style={{ width: `${expenseShare * 100}%` }} />
            <div className="h-full bg-purple-500" style={{ width: `${advanceShare * 100}%` }} />
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-emerald-600 dark:text-emerald-400">
              {totalCategoryCount} Claims
            </span>{" "}
            {kpiSub}
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-zinc-200/50 bg-white/70 p-5 transition-all hover:bg-white dark:border-zinc-800/40 dark:bg-zinc-800/30 dark:hover:bg-zinc-800/50">
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-emerald-500/10 blur-2xl transition-all group-hover:bg-emerald-500/20" />
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Expense Claims
          </h4>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold text-zinc-900 dark:text-white">
              <CountUp start={0} end={detail.expenseAmount} duration={2} separator="," prefix="₹" />
            </span>
          </div>
          <ShareBar pct={expenseShare} colorClass="bg-sky-500" />
          <div className="mt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Reimbursements • {Math.round(expenseShare * 100)}% of total
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-zinc-200/50 bg-white/70 p-5 transition-all hover:bg-white dark:border-zinc-800/40 dark:bg-zinc-800/30 dark:hover:bg-zinc-800/50">
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-purple-500/10 blur-2xl transition-all group-hover:bg-purple-500/20" />
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400">
            Advance Claims
          </h4>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold text-zinc-900 dark:text-white">
              <CountUp start={0} end={detail.advanceAmount} duration={2} separator="," prefix="₹" />
            </span>
          </div>
          <ShareBar pct={advanceShare} colorClass="bg-purple-500" />
          <div className="mt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Pre-approved • {Math.round(advanceShare * 100)}% of total
          </div>
        </div>
      </div>

      {/* Chart + Insights */}
      <div className="grid min-h-0 grid-cols-1 gap-6 xl:grid-cols-4">
        {/* Chart */}
        <div className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200/50 bg-white/70 p-5 dark:border-zinc-800/40 dark:bg-zinc-800/30 xl:col-span-3">
          <h4 className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            <BarChart3 className="h-4 w-4 text-sky-500" />
            Expense Category Distribution
          </h4>

          <div className="w-full min-w-0">
            {sortedCategories.length > 0 ? (
              <div className="w-full min-w-0 overflow-hidden" style={{ height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                  <BarChart
                    data={sortedCategories}
                    layout="vertical"
                    margin={{ top: 0, right: 110, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      dataKey="categoryName"
                      type="category"
                      axisLine={false}
                      tickLine={false}
                      tick={<CategoryTick />}
                      width={130}
                    />
                    <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={<CategoryTooltip />} />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={20} fill="#0ea5e9">
                      <LabelList
                        dataKey="amount"
                        position="right"
                        fill="#71717a"
                        fontSize={11}
                        formatter={(val: unknown) => {
                          const amount = Number(val);
                          const pct =
                            categoryTotalAmount > 0
                              ? Math.round((amount / categoryTotalAmount) * 100)
                              : 0;
                          return `₹${amount.toLocaleString("en-IN")} • ${pct}%`;
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex min-h-[280px] items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                No category data
              </div>
            )}
          </div>
        </div>

        {/* Insights */}
        <div className="flex min-w-0 flex-col rounded-2xl border border-zinc-200/50 bg-white/70 p-4 dark:border-zinc-800/40 dark:bg-zinc-800/30 xl:col-span-1">
          <h4 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            <HelpCircle className="h-4 w-4 text-pink-500" />
            Category Insights
          </h4>

          <div className="mt-1 flex flex-col gap-3.5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pink-500/10 text-pink-500 ring-1 ring-pink-500/20">
                <ArrowUpRight className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                  Largest Claim
                </p>
                <p className="mt-0.5 font-mono text-base font-bold text-zinc-900 dark:text-white">
                  {formatCurrency(detail.largestClaimAmount)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                  Most Frequent
                </p>
                <p
                  className="mt-1 truncate text-sm font-bold text-zinc-900 dark:text-white"
                  title={detail.mostFrequentCategory || "None"}
                >
                  {detail.mostFrequentCategory || "None"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                  Average Claim
                </p>
                <p className="mt-0.5 font-mono text-base font-bold text-zinc-900 dark:text-white">
                  {totalCategoryCount > 0
                    ? formatCurrency(detail.totalAmount / totalCategoryCount)
                    : "₹0.00"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
