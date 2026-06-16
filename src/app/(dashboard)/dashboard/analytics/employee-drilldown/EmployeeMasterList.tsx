"use client";

import { useState, useEffect, useTransition } from "react";
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
  expenseCategoryOptions,
  departmentOptions,
  dateFrom,
  dateTo,
  isAdmin,
}: {
  initialRows: EmployeeClaimMasterRow[];
  initialTotalCount: number;
  expenseCategoryOptions: DashboardAnalyticsOption[];
  departmentOptions: DashboardAnalyticsOption[];
  dateFrom: string;
  dateTo: string;
  isAdmin: boolean;
}) {
  const [rows, setRows] = useState<EmployeeClaimMasterRow[]>(initialRows);
  const [totalCount, setTotalCount] = useState<number>(initialTotalCount);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [status, setStatus] = useState<string>(DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS);
  const [page, setPage] = useState(1);
  const limit = 10;

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to page 1 on search change
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    startTransition(async () => {
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
      if (!result.errorMessage) {
        setRows(result.data);
        setTotalCount(result.totalCount);
      }
    });
  }, [debouncedSearch, categoryId, status, page, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  // Extract selected employee details
  const selectedEmployee = rows.find((r) => r.employeeId === selectedEmployeeId);

  return (
    <div className="mt-8 space-y-6">
      {/* Overview & Status Switcher Header */}
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-6 backdrop-blur-xl md:flex-row md:items-center md:justify-between shadow-2xl">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-sky-500" />
            Employee Analytics
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wider text-sky-400 uppercase">
            Status
          </span>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-[280px] appearance-none rounded-xl border border-zinc-800/50 bg-zinc-800/80 p-2.5 pr-8 text-sm font-medium text-white shadow-inner backdrop-blur-md transition-all focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="all">All Statuses</option>
              {DB_CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
              <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6 items-start w-full">
        {/* Left Column: Leaderboard List */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold tracking-widest text-zinc-400 uppercase">
              Leaderboard
            </h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                placeholder="Search..."
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                className="w-full h-10 bg-zinc-950/50 border border-zinc-800/50 rounded-lg pl-10 pr-4 text-sm text-zinc-200 placeholder-zinc-500 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all focus:outline-none"
              />
            </div>
          </div>

          <div className="relative flex flex-col rounded-xl border border-zinc-800/50 bg-zinc-900/30 backdrop-blur-xl shadow-2xl overflow-hidden">
            {isPending && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/50 backdrop-blur-sm">
                <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
              </div>
            )}

            {rows.length === 0 && !isPending ? (
              <div className="p-10 text-center text-sm text-zinc-500">
                No employees found matching the criteria.
              </div>
            ) : (
              <ul className="flex h-[700px] flex-col overflow-y-auto divide-y divide-zinc-800/50 py-2">
                {rows.map((row, index) => {
                  const isSelected = selectedEmployeeId === row.employeeId;
                  const rank = (page - 1) * limit + index + 1;

                  return (
                    <li key={row.employeeId}>
                      <button
                        onClick={() => setSelectedEmployeeId(row.employeeId)}
                        className={`group relative flex w-full items-center justify-between px-5 py-4 transition-colors duration-200 ease-in-out hover:bg-sky-500/10 ${isSelected ? "border-l-2 border-sky-500 bg-sky-500/10" : "border-l-2 border-transparent"}`}
                      >
                        <div className="flex items-center gap-4 overflow-hidden">
                          <div className="flex w-5 justify-center text-xs font-bold text-zinc-500">
                            {rank}
                          </div>
                          <div className="flex flex-col items-start overflow-hidden text-left">
                            <span className="truncate font-semibold text-white">
                              {row.employeeName}
                            </span>
                            <span className="text-xs text-zinc-400 mt-0.5">
                              {row.claimCount} Claims Pending
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                          <span
                            className={`font-mono text-sm font-bold ${isSelected ? "text-sky-400" : "text-emerald-400"}`}
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
              <div className="flex items-center justify-between border-t border-zinc-800/50 bg-black/20 p-4 text-xs font-medium text-zinc-400">
                <span>
                  {(page - 1) * limit + 1} - {Math.min(page * limit, totalCount)} of {totalCount}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="h-8 w-8 p-0 border border-zinc-800/50 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-8 w-8 p-0 border border-zinc-800/50 hover:bg-zinc-800 text-zinc-300 disabled:opacity-50"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Details Panel */}
        <div className="xl:sticky xl:top-4 xl:self-start">
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
