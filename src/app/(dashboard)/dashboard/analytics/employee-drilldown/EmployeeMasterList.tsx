"use client";

import { useEffect, useState } from "react";
import { fetchEmployeeClaimMaster } from "./actions";
import { EmployeeDetailPanel } from "./EmployeeDetailPanel";
import { formatCurrency } from "@/lib/format";
import { Loader2, Search, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import {
  DashboardAnalyticsOption,
  EmployeeClaimMasterRow,
} from "@/core/domain/dashboard/contracts";
import {
  DB_CLAIM_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
} from "@/core/constants/statuses";
import { Button } from "@/components/ui/button";

export function EmployeeMasterList({
  initialRows,
  initialTotalCount,
  dateFrom,
  dateTo,
}: {
  initialRows: EmployeeClaimMasterRow[];
  initialTotalCount: number;
  expenseCategoryOptions: DashboardAnalyticsOption[];
  departmentOptions: DashboardAnalyticsOption[];
  dateFrom: string;
  dateTo: string;
  isAdmin: boolean;
}) {
  const [rows, setRows] = useState<EmployeeClaimMasterRow[]>(initialRows || []);
  const [totalCount, setTotalCount] = useState<number>(initialTotalCount || 0);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId] = useState<string>("all");
  const [status, setStatus] = useState<string>(DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS);
  const [page, setPage] = useState(1);
  const limit = 10;

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);

    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    let active = true;

    async function load() {
      setIsPending(true);

      try {
        const offset = (page - 1) * limit;
        const result = await fetchEmployeeClaimMaster({
          dateFrom,
          dateTo,
          status: status === "all" ? undefined : status,
          expenseCategoryId: categoryId === "all" ? undefined : categoryId,
          employeeSearch: debouncedSearch || undefined,
          limit,
          offset,
        });

        if (!active) return;

        if (!result.errorMessage) {
          const nextRows = result.data || [];
          setRows(nextRows);
          setTotalCount(result.totalCount || 0);

          setSelectedEmployeeId((current) => {
            if (!nextRows.length) return null;
            const stillExists = current
              ? nextRows.some((row) => row.employeeId === current)
              : false;
            return stillExists ? current : nextRows[0].employeeId;
          });
        }
      } finally {
        if (active) setIsPending(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [debouncedSearch, categoryId, status, page, dateFrom, dateTo, limit]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedEmployeeId(null);
      return;
    }

    const exists = rows.some((row) => row.employeeId === selectedEmployeeId);
    if (!exists) {
      setSelectedEmployeeId(rows[0].employeeId);
    }
  }, [rows, selectedEmployeeId]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const selectedEmployee = rows.find((r) => r.employeeId === selectedEmployeeId);

  return (
    <div className="mt-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-row items-center justify-between gap-4 rounded-xl border border-zinc-200/50 bg-white/60 p-6 shadow-sm backdrop-blur-xl dark:border-zinc-800/40 dark:bg-zinc-900/40 dark:shadow-2xl">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
            <TrendingUp className="h-6 w-6 text-sky-500" />
            Employee Analytics
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
            Status
          </span>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-[280px] appearance-none rounded-xl border border-zinc-300 bg-white p-2.5 pr-8 text-sm font-medium text-zinc-800 shadow-inner transition-all focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-zinc-800/50 dark:bg-zinc-800/80 dark:text-white"
            >
              <option value="all">All Statuses</option>
              {(DB_CLAIM_STATUSES || []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500 dark:text-zinc-400">
              <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex w-full gap-4">
        {/* Left Column: Employee List */}
        <div className="w-[280px] shrink-0 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 dark:border-zinc-800/80 dark:bg-zinc-950/50 dark:text-zinc-200 dark:placeholder:text-zinc-500"
            />
          </div>

          <div className="relative flex flex-col overflow-hidden rounded-xl border border-zinc-200/50 bg-white/60 shadow-sm backdrop-blur-xl dark:border-zinc-800/40 dark:bg-zinc-900/30 dark:shadow-2xl">
            {isPending && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-sm dark:bg-zinc-950/50">
                <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
              </div>
            )}

            {(rows || []).length === 0 && !isPending ? (
              <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No employees found matching the criteria.
              </div>
            ) : (
              <ul className="flex max-h-[700px] flex-col overflow-y-auto py-2">
                {(rows || []).map((row, index) => {
                  const isSelected = selectedEmployeeId === row.employeeId;
                  const rank = (page - 1) * limit + index + 1;

                  return (
                    <li key={row.employeeId}>
                      <button
                        onClick={() => setSelectedEmployeeId(row.employeeId)}
                        className={
                          "group relative flex w-full items-center justify-between px-4 py-2.5 transition-colors " +
                          (isSelected
                            ? "rounded-md border border-sky-500/50 bg-sky-50 dark:bg-sky-500/10"
                            : "border border-transparent border-b-zinc-200/60 hover:bg-zinc-50 dark:border-b-zinc-800/50 dark:hover:bg-zinc-800/30")
                        }
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-4">
                          <div className="flex w-5 shrink-0 justify-center text-xs font-bold text-zinc-400 dark:text-zinc-500">
                            {rank}
                          </div>

                          <div className="flex min-w-0 flex-col items-start text-left">
                            <span className="block w-full truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                              {row.employeeName}
                            </span>
                            <span className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                              {row.claimCount} Claims
                            </span>
                          </div>
                        </div>

                        <div className="pl-3 shrink-0">
                          <span
                            className={`font-mono text-sm font-semibold ${
                              isSelected
                                ? "text-sky-600 dark:text-sky-400"
                                : "text-zinc-600 dark:text-zinc-400"
                            }`}
                          >
                            {formatCurrency(row.totalAmount)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Pagination */}
            {totalCount > 0 && (
              <div className="flex items-center justify-between border-t border-zinc-200/60 bg-zinc-50/50 p-4 text-xs font-medium text-zinc-500 dark:border-zinc-800/50 dark:bg-black/20 dark:text-zinc-400">
                <span>
                  {(page - 1) * limit + 1} - {Math.min(page * limit, totalCount)} of {totalCount}
                </span>

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="h-8 w-8 border border-zinc-200 p-0 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-8 w-8 border border-zinc-200 p-0 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Details Panel */}
        <div className="flex-1 min-w-0">
          <EmployeeDetailPanel
            employeeId={selectedEmployeeId}
            employeeName={selectedEmployee?.employeeName}
            dateFrom={dateFrom}
            dateTo={dateTo}
            categoryId={categoryId === "all" ? undefined : categoryId}
            status={status === "all" ? undefined : status}
          />
        </div>
      </div>
    </div>
  );
}
