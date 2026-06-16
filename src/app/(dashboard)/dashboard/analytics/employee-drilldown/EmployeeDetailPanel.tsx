"use client";

import { useState, useEffect } from "react";
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
  payload: { categoryName: string; amount: number; count: number };
};

function CategoryTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/90 p-3 shadow-xl backdrop-blur-md">
        <p className="text-xs font-bold text-zinc-400 uppercase">{data.categoryName}</p>
        <p className="text-sm font-semibold text-white mt-1">{formatCurrency(data.amount)}</p>
        <p className="text-xs text-zinc-500 mt-1">{data.count} Claims</p>
      </div>
    );
  }
  return null;
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
      } else {
        setDetail(res.data);
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [employeeId, dateFrom, dateTo, categoryId, status]);

  if (!employeeId) {
    return (
      <div className="flex h-[800px] flex-col items-center justify-center rounded-2xl border border-zinc-800/50 bg-zinc-900/30 p-8 text-center backdrop-blur-xl shadow-2xl relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-tr from-sky-500/5 to-purple-500/5 opacity-50 transition-opacity group-hover:opacity-100" />
        <div className="relative z-10 flex flex-col items-center">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-zinc-800/50 shadow-inner ring-1 ring-zinc-800/50 relative">
            <BarChart3 className="h-10 w-10 text-zinc-500 transition-transform duration-700 ease-in-out group-hover:scale-110" />
            <div className="absolute -inset-2 rounded-full border border-sky-500/20 animate-[spin_4s_linear_infinite] opacity-0 group-hover:opacity-100" />
          </div>
          <h3 className="text-xl font-bold text-white">No Employee Selected</h3>
          <p className="mt-2 text-sm text-zinc-400 max-w-xs">
            Select an employee from the leaderboard to unlock deep analytics, spending behaviors,
            and insights.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[800px] items-center justify-center rounded-2xl border border-zinc-800/50 bg-zinc-900/30 backdrop-blur-xl shadow-2xl">
        <Loader2 className="h-10 w-10 animate-spin text-sky-500" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex h-[800px] flex-col items-center justify-center rounded-2xl border border-rose-500/20 bg-zinc-900/30 p-8 text-center backdrop-blur-xl shadow-2xl">
        <AlertCircle className="mb-4 h-12 w-12 text-rose-500" />
        <h3 className="text-lg font-bold text-white">Unable to load analytics</h3>
        <p className="mt-2 text-sm text-zinc-400">{error}</p>
      </div>
    );
  }

  const totalCategoryCount = detail.categoryBreakdown.reduce((sum, cat) => sum + cat.count, 0);

  // Sort categories highest to lowest
  const sortedCategories = [...detail.categoryBreakdown].sort((a, b) => b.amount - a.amount);

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-zinc-800/50 bg-zinc-900/30 p-6 backdrop-blur-xl shadow-2xl">
      {/* Header */}
      <div className="border-b border-zinc-800/50 pb-6">
        <h3 className="text-xl font-semibold text-zinc-100">
          {employeeName || "Unknown Employee"}
        </h3>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-800/30 p-5 transition-all hover:bg-zinc-800/50">
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-sky-500/10 blur-2xl transition-all group-hover:bg-sky-500/20" />
          <h4 className="text-[10px] font-bold tracking-widest text-sky-400 uppercase">
            Total Pending Claims
          </h4>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold text-white">
              <CountUp start={0} end={detail.totalAmount} duration={2} separator="," prefix="₹" />
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400">{totalCategoryCount} Claims</span> in queue
          </div>
        </div>

        <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-800/30 p-5 transition-all hover:bg-zinc-800/50">
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-emerald-500/10 blur-2xl transition-all group-hover:bg-emerald-500/20" />
          <h4 className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
            Expense Claims
          </h4>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold text-white">
              <CountUp start={0} end={detail.expenseAmount} duration={2} separator="," prefix="₹" />
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            Reimbursements
          </div>
        </div>

        <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-800/30 p-5 transition-all hover:bg-zinc-800/50">
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-purple-500/10 blur-2xl transition-all group-hover:bg-purple-500/20" />
          <h4 className="text-[10px] font-bold tracking-widest text-purple-400 uppercase">
            Advance Claims
          </h4>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold text-white">
              <CountUp start={0} end={detail.advanceAmount} duration={2} separator="," prefix="₹" />
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            Pre-approved funds
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* Left main content */}
        <div className="flex flex-col gap-6">
          {/* Main Bar Chart: Expense Distribution */}
          <div className="flex flex-col rounded-2xl border border-zinc-800/50 bg-zinc-800/30 p-5 min-h-[250px]">
            <h4 className="mb-4 text-[11px] font-bold tracking-widest text-zinc-400 uppercase flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-sky-400" />
              Expense Category Distribution
            </h4>
            <div className="w-full h-[320px] min-h-[320px] mt-4">
              {sortedCategories.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sortedCategories}
                    layout="vertical"
                    margin={{ top: 0, right: 80, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      dataKey="categoryName"
                      type="category"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#a1a1aa", fontSize: 11, fontWeight: 600 }}
                      width={130}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.02)" }}
                      content={<CategoryTooltip />}
                    />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={20} fill="#0ea5e9">
                      <LabelList
                        dataKey="amount"
                        position="right"
                        fill="#94a3b8"
                        fontSize={11}
                        formatter={(val: number) => "₹" + val.toLocaleString("en-IN")}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  No category data
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right side panel */}
        <div className="flex flex-col gap-6">
          {/* Category Insights Box */}
          <div className="flex flex-col rounded-2xl border border-zinc-800/50 bg-zinc-800/30 p-5 flex-1">
            <h4 className="mb-4 text-[11px] font-bold tracking-widest text-zinc-400 uppercase flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-pink-400" />
              Category Insights
            </h4>

            <div className="flex flex-col gap-5 mt-2">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-500/10 text-pink-400 ring-1 ring-pink-500/20">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                    Largest Claim
                  </p>
                  <p className="font-mono text-base font-bold text-white mt-0.5">
                    {formatCurrency(detail.largestClaimAmount)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="overflow-hidden">
                  <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                    Most Frequent
                  </p>
                  <p
                    className="truncate text-sm font-bold text-white mt-1"
                    title={detail.mostFrequentCategory || "None"}
                  >
                    {detail.mostFrequentCategory || "None"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                    Average Claim
                  </p>
                  <p className="font-mono text-base font-bold text-white mt-0.5">
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
    </div>
  );
}
