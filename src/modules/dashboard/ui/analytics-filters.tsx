"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardAnalyticsOption } from "@/core/domain/dashboard/contracts";

type AnalyticsFiltersProps = {
  fromDate: string;
  toDate: string;
  selectedDepartmentId: string;
  selectedExpenseCategoryId: string;
  selectedProductId: string;
  selectedFinanceApproverId: string;
  canUseScopeFilters: boolean;
  canUseFinanceApproverFilter: boolean;
  departmentOptions: DashboardAnalyticsOption[];
  expenseCategoryOptions: DashboardAnalyticsOption[];
  productOptions: DashboardAnalyticsOption[];
  financeApproverOptions: DashboardAnalyticsOption[];
};

type QuickPresetValue = "custom" | "1m" | "2m" | "3m" | "6m";

const QUICK_PRESET_OPTIONS: Array<{ value: QuickPresetValue; label: string; months?: number }> = [
  { value: "custom", label: "Custom" },
  { value: "1m", label: "Last 1 Month", months: 1 },
  { value: "2m", label: "Last 2 Months", months: 2 },
  { value: "3m", label: "Last 3 Months", months: 3 },
  { value: "6m", label: "Last 6 Months", months: 6 },
];

function formatDateForInput(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPresetRange(months: number): { from: string; to: string } {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - months);

  return {
    from: formatDateForInput(start),
    to: formatDateForInput(end),
  };
}

function detectPresetValue(fromDate: string, toDate: string): QuickPresetValue {
  if (!fromDate || !toDate) {
    return "custom";
  }

  for (const preset of QUICK_PRESET_OPTIONS) {
    if (!preset.months) {
      continue;
    }

    const range = buildPresetRange(preset.months);
    if (range.from === fromDate && range.to === toDate) {
      return preset.value;
    }
  }

  return "custom";
}

function applyDateParams(next: URLSearchParams, from: string, to: string): void {
  if (from && to) {
    next.set("from", from);
    next.set("to", to);
  } else {
    next.delete("from");
    next.delete("to");
  }
}

export function AnalyticsFilters({
  fromDate,
  toDate,
  selectedDepartmentId,
  selectedExpenseCategoryId,
  selectedProductId,
  selectedFinanceApproverId,
  canUseScopeFilters,
  canUseFinanceApproverFilter,
  departmentOptions,
  expenseCategoryOptions,
  productOptions,
  financeApproverOptions,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedPreset, setSelectedPreset] = useState<QuickPresetValue>(
    detectPresetValue(fromDate, toDate),
  );
  const [draftFromDate, setDraftFromDate] = useState(fromDate);
  const [draftToDate, setDraftToDate] = useState(toDate);
  const [draftDepartmentId, setDraftDepartmentId] = useState(selectedDepartmentId);
  const [draftExpenseCategoryId, setDraftExpenseCategoryId] = useState(selectedExpenseCategoryId);
  const [draftProductId, setDraftProductId] = useState(selectedProductId);
  const [draftFinanceApproverId, setDraftFinanceApproverId] = useState(selectedFinanceApproverId);

  const hasAdvancedFilters = canUseScopeFilters || canUseFinanceApproverFilter;
  const gridClassName = hasAdvancedFilters
    ? canUseFinanceApproverFilter
      ? "md:grid-cols-3 xl:grid-cols-7"
      : "md:grid-cols-3 xl:grid-cols-6"
    : "md:grid-cols-3";

  function pushParams(next: URLSearchParams) {
    next.delete("month");
    router.push(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
  }

  function applyScopeFilterParams(next: URLSearchParams) {
    if (canUseScopeFilters) {
      if (draftDepartmentId) {
        next.set("department_id", draftDepartmentId);
      } else {
        next.delete("department_id");
      }

      if (draftExpenseCategoryId) {
        next.set("category", draftExpenseCategoryId);
      } else {
        next.delete("category");
      }

      if (draftProductId) {
        next.set("product", draftProductId);
      } else {
        next.delete("product");
      }
    } else {
      next.delete("department_id");
      next.delete("category");
      next.delete("product");
      next.delete("expense_category_id");
      next.delete("product_id");
    }
  }

  function applyFinanceApproverParam(next: URLSearchParams) {
    if (canUseFinanceApproverFilter) {
      if (draftFinanceApproverId) {
        next.set("finance_approver_id", draftFinanceApproverId);
      } else {
        next.delete("finance_approver_id");
      }
    } else {
      next.delete("finance_approver_id");
    }
  }

  function pushDateRange(nextFromDate: string, nextToDate: string) {
    const next = new URLSearchParams(searchParams.toString());

    applyDateParams(next, nextFromDate, nextToDate);

    applyScopeFilterParams(next);
    applyFinanceApproverParam(next);

    pushParams(next);
  }

  function applyFilters() {
    const next = new URLSearchParams(searchParams.toString());

    applyDateParams(next, draftFromDate, draftToDate);

    applyScopeFilterParams(next);
    applyFinanceApproverParam(next);

    pushParams(next);
  }

  function resetFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("month");
    next.delete("from");
    next.delete("to");
    next.delete("department_id");
    next.delete("category");
    next.delete("product");
    next.delete("expense_category_id");
    next.delete("product_id");
    next.delete("finance_approver_id");

    setSelectedPreset("custom");
    setDraftFromDate("");
    setDraftToDate("");
    setDraftDepartmentId("");
    setDraftExpenseCategoryId("");
    setDraftProductId("");
    setDraftFinanceApproverId("");

    pushParams(next);
  }

  return (
    <div className="w-full space-y-3 rounded-2xl border border-white/20 bg-white/40 p-4 backdrop-blur-md dark:bg-zinc-900/40">
      <div className={`grid gap-3 ${gridClassName}`}>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
          Quick Presets
          <select
            value={selectedPreset}
            onChange={(event) => {
              const nextPreset = event.target.value as QuickPresetValue;
              setSelectedPreset(nextPreset);

              const selectedOption = QUICK_PRESET_OPTIONS.find(
                (option) => option.value === nextPreset,
              );
              if (!selectedOption?.months) {
                return;
              }

              const range = buildPresetRange(selectedOption.months);
              setDraftFromDate(range.from);
              setDraftToDate(range.to);
              pushDateRange(range.from, range.to);
            }}
            className="h-10 rounded-xl border border-zinc-300/80 bg-white/80 px-3 text-sm text-zinc-800 outline-hidden ring-0 transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.16)] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
          >
            {QUICK_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
          From
          <input
            type="date"
            value={draftFromDate}
            onChange={(event) => {
              const nextFromDate = event.target.value;
              setDraftFromDate(nextFromDate);
              setSelectedPreset("custom");
              pushDateRange(nextFromDate, draftToDate);
            }}
            className="h-10 rounded-xl border border-zinc-300/80 bg-white/80 px-3 text-sm text-zinc-800 outline-hidden ring-0 transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.16)] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
          To
          <input
            type="date"
            value={draftToDate}
            onChange={(event) => {
              const nextToDate = event.target.value;
              setDraftToDate(nextToDate);
              setSelectedPreset("custom");
              pushDateRange(draftFromDate, nextToDate);
            }}
            className="h-10 rounded-xl border border-zinc-300/80 bg-white/80 px-3 text-sm text-zinc-800 outline-hidden ring-0 transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.16)] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
          />
        </label>

        {canUseScopeFilters ? (
          <>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
              Department
              <select
                value={draftDepartmentId}
                onChange={(event) => setDraftDepartmentId(event.target.value)}
                className="h-10 rounded-xl border border-zinc-300/80 bg-white/80 px-3 text-sm text-zinc-800 outline-hidden ring-0 transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.16)] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
              >
                <option value="">All Departments</option>
                {departmentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
              Expense Category
              <select
                value={draftExpenseCategoryId}
                onChange={(event) => setDraftExpenseCategoryId(event.target.value)}
                className="h-10 rounded-xl border border-zinc-300/80 bg-white/80 px-3 text-sm text-zinc-800 outline-hidden ring-0 transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.16)] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
              >
                <option value="">All Expense Categories</option>
                {expenseCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
              Product
              <select
                value={draftProductId}
                onChange={(event) => setDraftProductId(event.target.value)}
                className="h-10 rounded-xl border border-zinc-300/80 bg-white/80 px-3 text-sm text-zinc-800 outline-hidden ring-0 transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.16)] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
              >
                <option value="">All Products</option>
                {productOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {canUseFinanceApproverFilter ? (
          <>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-300">
              Finance Approver
              <select
                value={draftFinanceApproverId}
                onChange={(event) => setDraftFinanceApproverId(event.target.value)}
                className="h-10 rounded-xl border border-zinc-300/80 bg-white/80 px-3 text-sm text-zinc-800 outline-hidden ring-0 transition focus:border-sky-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.16)] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
              >
                <option value="">All Finance Approvers</option>
                {financeApproverOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={resetFilters}
          className="h-9 rounded-lg border border-zinc-300/80 bg-white/70 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-700 transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={applyFilters}
          className="h-9 rounded-lg border border-sky-400/50 bg-sky-500 px-4 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-sky-600"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
}
