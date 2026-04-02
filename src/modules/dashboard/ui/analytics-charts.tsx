"use client";

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
  DashboardAnalyticsPaymentModeBreakdownItem,
  DashboardAnalyticsStatusBreakdownItem,
} from "@/core/domain/dashboard/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AnalyticsChartsProps = {
  statusBreakdown: DashboardAnalyticsStatusBreakdownItem[];
  paymentModeBreakdown: DashboardAnalyticsPaymentModeBreakdownItem[];
  efficiencyByDepartment: DashboardAnalyticsEfficiencyItem[];
  isAdmin: boolean;
};

const PIE_COLORS = ["#0EA5E9", "#14B8A6", "#F97316", "#E11D48", "#6366F1", "#64748B"];
const RADIAN = Math.PI / 180;
const MUTED_FOREGROUND_COLOR = "currentColor";

type PieLabelPayload = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  value?: number | string;
  name?: string;
};

const renderCustomizedLabel = ({
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  value,
  name,
}: PieLabelPayload) => {
  const safeOuterRadius = Number(outerRadius);
  const radius = safeOuterRadius * 1.2;
  const x = Number(cx) + radius * Math.cos(-Number(midAngle) * RADIAN);
  const y = Number(cy) + radius * Math.sin(-Number(midAngle) * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill={MUTED_FOREGROUND_COLOR}
      className="text-xs"
      textAnchor={x > Number(cx) ? "start" : "end"}
      dominantBaseline="central"
    >
      {`${name ?? "Unknown"}: ${value ?? 0}`}
    </text>
  );
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

export function AnalyticsCharts({
  statusBreakdown,
  paymentModeBreakdown,
  efficiencyByDepartment,
  isAdmin,
}: AnalyticsChartsProps) {
  const statusChartData = statusBreakdown.map((item) => ({
    name: item.status,
    count: item.count,
  }));

  const paymentChartData = paymentModeBreakdown.map((item) => ({
    name: item.paymentModeName,
    count: item.count,
  }));

  const efficiencyChartData = efficiencyByDepartment.map((item) => ({
    name: item.departmentName,
    avgDays: item.averageDaysToApproval,
    sampleCount: item.sampleCount,
  }));

  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${isAdmin ? "xl:grid-cols-2" : "xl:grid-cols-1"}`}>
        <Card className="border-white/30 bg-white/60 dark:bg-zinc-900/55">
          <CardHeader>
            <CardTitle>Payment Mode Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full text-muted-foreground">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 20, right: 52, bottom: 20, left: 52 }}>
                  <Pie
                    data={paymentChartData}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={84}
                    label={renderCustomizedLabel}
                    labelLine={{ stroke: MUTED_FOREGROUND_COLOR, strokeWidth: 1 }}
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
          </CardContent>
        </Card>

        {isAdmin ? (
          <Card className="border-white/30 bg-white/60 dark:bg-zinc-900/55">
            <CardHeader>
              <CardTitle>Efficiency: Days to Approve by Department</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full text-muted-foreground">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={efficiencyChartData}
                    margin={{ top: 8, right: 12, left: -8, bottom: 22 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.28)" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: MUTED_FOREGROUND_COLOR, fontSize: 12 }}
                      interval={0}
                      angle={-18}
                      textAnchor="end"
                      height={72}
                    />
                    <YAxis tick={{ fill: MUTED_FOREGROUND_COLOR, fontSize: 12 }} />
                    <Tooltip
                      formatter={(value, _key, payload) => {
                        const sampleCount = Number(payload?.payload?.sampleCount ?? 0);
                        return [
                          `${formatNumber(Number(value))} days`,
                          `${sampleCount} claims sampled`,
                        ];
                      }}
                    />
                    <Bar dataKey="avgDays" fill="#0EA5E9" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="border-white/30 bg-white/60 dark:bg-zinc-900/55">
        <CardHeader>
          <CardTitle>Claims By Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[340px] w-full text-muted-foreground">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData} margin={{ top: 8, right: 8, left: -8, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.28)" />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={72}
                  tick={{ fill: MUTED_FOREGROUND_COLOR, fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: MUTED_FOREGROUND_COLOR, fontSize: 12 }}
                />
                <Tooltip formatter={(value) => formatNumber(Number(value))} />
                <Bar dataKey="count" fill="#6366F1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
