"use client";

import { memo, useMemo, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DashboardAnalyticsEfficiencyItem,
  DashboardAnalyticsFinanceApproverTatItem,
  DashboardAnalyticsPaymentModeBreakdownItem,
  DashboardAnalyticsStatusBreakdownItem,
} from "@/core/domain/dashboard/contracts";
import { formatCurrency } from "@/lib/format";

type AnalyticsChartsProps = {
  statusBreakdown: DashboardAnalyticsStatusBreakdownItem[];
  paymentModeBreakdown: DashboardAnalyticsPaymentModeBreakdownItem[];
  efficiencyByDepartment: DashboardAnalyticsEfficiencyItem[];
  financeApproverTatBreakdown: DashboardAnalyticsFinanceApproverTatItem[];
  isAdmin: boolean;
  overallFinanceTatAverage: number | null;
  overallFinanceTatSampleCount: number;
};

const PIE_COLORS = ["#0EA5E9", "#14B8A6", "#F97316", "#E11D48", "#6366F1", "#64748B"];

const STATUS_BAR_COLORS = ["#0EA5E9", "#14B8A6", "#F59E0B", "#6366F1", "#E11D48", "#64748B"];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

type PaymentModeLegendProps = {
  data: { name: string; count: number }[];
  colors: string[];
};

function PaymentModeLegend({ data, colors }: PaymentModeLegendProps) {
  return (
    <div className="min-w-0 flex-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <th className="pb-2 text-left font-medium">Payment Mode</th>
            <th className="pb-2 text-right font-medium">Claims</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry, index) => (
            <tr key={entry.name} className="border-t border-border">
              <td className="flex items-center gap-2 py-2 text-sm text-foreground">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: colors[index % colors.length] }}
                />
                {entry.name}
              </td>
              <td className="py-2 text-right font-semibold text-foreground">
                {formatNumber(entry.count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type StatusSummaryTableProps = {
  data: DashboardAnalyticsStatusBreakdownItem[];
};

function StatusSummaryTable({ data }: StatusSummaryTableProps) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
            style={{ backgroundColor: "var(--background-secondary)" }}
          >
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Claims</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.status} className="border-t border-border">
              <td className="px-4 py-2.5 text-foreground">{item.status}</td>
              <td className="px-4 py-2.5 text-right text-muted-foreground">
                {item.count} claim{item.count === 1 ? "" : "s"}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                {formatCurrency(item.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type EfficiencyTableProps = {
  title: string;
  data: { name: string; avgDays: number; sampleCount: number }[];
};

function EfficiencyTable({ title, data }: EfficiencyTableProps) {
  if (data.length === 0) {
    return (
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
      >
        <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">No records in this period.</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
            style={{ backgroundColor: "var(--background-secondary)" }}
          >
            <th className="px-4 py-3 text-left font-medium">{title}</th>
            <th className="px-4 py-3 text-right font-medium">Avg Days</th>
            <th className="px-4 py-3 text-right font-medium">Claims</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.name} className="border-t border-border">
              <td className="px-4 py-2.5 text-foreground">{item.name}</td>
              <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                {item.avgDays.toFixed(2)}
              </td>
              <td className="px-4 py-2.5 text-right text-muted-foreground">{item.sampleCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const AnalyticsCharts = memo(function AnalyticsCharts({
  statusBreakdown,
  paymentModeBreakdown,
  efficiencyByDepartment,
  financeApproverTatBreakdown,
  isAdmin,
  overallFinanceTatAverage,
  overallFinanceTatSampleCount,
}: AnalyticsChartsProps) {
  const statusChartData = useMemo(
    () =>
      statusBreakdown
        .map((item) => ({
          name: item.status,
          count: item.count,
        }))
        .sort((a, b) => b.count - a.count),
    [statusBreakdown],
  );

  const paymentChartData = useMemo(
    () =>
      paymentModeBreakdown.map((item) => ({
        name: item.paymentModeName,
        count: item.count,
      })),
    [paymentModeBreakdown],
  );

  const efficiencyChartData = useMemo(
    () =>
      efficiencyByDepartment.map((item) => ({
        name: item.departmentName,
        avgDays: item.averageDaysToApproval,
        sampleCount: item.sampleCount,
      })),
    [efficiencyByDepartment],
  );

  const financeTatChartData = useMemo(
    () =>
      financeApproverTatBreakdown.map((item) => ({
        name: item.financeApproverName,
        avgDays: item.averageDaysToApproval,
        sampleCount: item.sampleCount,
      })),
    [financeApproverTatBreakdown],
  );

  const cardStyle = {
    backgroundColor: "var(--card)",
    borderColor: "var(--border)",
  } as CSSProperties;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-4" style={{ ...cardStyle, minHeight: 320 }}>
          <h3 className="mb-3 text-base font-semibold text-foreground">
            Payment Mode Distribution
          </h3>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-[200px] w-full shrink-0 sm:w-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentChartData}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    isAnimationActive={false}
                  >
                    {paymentChartData.map((entry, index) => (
                      <Cell
                        key={`${entry.name}-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatNumber(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <PaymentModeLegend data={paymentChartData} colors={PIE_COLORS} />
          </div>
        </div>

        <div className="rounded-xl border p-4" style={{ ...cardStyle, minHeight: 320 }}>
          <h3 className="mb-3 text-base font-semibold text-foreground">Claims By Status</h3>
          {statusChartData.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center">
              <p className="text-sm text-muted-foreground">No data for selected filters.</p>
            </div>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={statusChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                  barSize={20}
                  barGap={4}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={220}
                  />
                  <Tooltip formatter={(value) => formatNumber(Number(value))} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {statusChartData.map((entry, index) => (
                      <Cell
                        key={`${entry.name}-${index}`}
                        fill={STATUS_BAR_COLORS[index % STATUS_BAR_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-base font-semibold text-foreground">Status Summary</h3>
        {statusBreakdown.length === 0 ? (
          <div className="flex items-center justify-center rounded-xl border p-8" style={cardStyle}>
            <p className="text-sm text-muted-foreground">
              No data for selected filters. Try changing the date range or filters.
            </p>
          </div>
        ) : (
          <StatusSummaryTable data={statusBreakdown} />
        )}
      </div>

      {isAdmin ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <EfficiencyTable
            title="Efficiency: Days to Approve by Department"
            data={efficiencyChartData}
          />
          <div>
            {overallFinanceTatAverage !== null ? (
              <div className="mb-3 rounded-xl border p-4" style={cardStyle}>
                <h3 className="text-sm font-semibold text-foreground">Overall Finance Team TAT</h3>
                <p className="mt-1 text-lg font-bold text-foreground">
                  {overallFinanceTatAverage.toFixed(2)} days
                </p>
                <p className="text-xs text-muted-foreground">
                  {overallFinanceTatSampleCount} claim
                  {overallFinanceTatSampleCount === 1 ? "" : "s"}
                </p>
              </div>
            ) : null}
            <EfficiencyTable
              title="Efficiency: Days to Approve by Finance Approver"
              data={financeTatChartData}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});
