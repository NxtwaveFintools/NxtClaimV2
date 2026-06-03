"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardAnalyticsOption } from "@/core/domain/dashboard/contracts";
import { normalizeIsoDateOnly } from "@/lib/date-only";

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

const ANALYTICS_FIELD_CLASS_NAME =
  "h-[38px] rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none ring-0 transition focus:border-accent focus:ring-[3px] focus:ring-accent/20";

const ANALYTICS_COLOR_SCHEME_CLASS_NAME = "[color-scheme:light] dark:[color-scheme:dark]";

const ANALYTICS_NATIVE_SELECT_CLASS_NAME = `${ANALYTICS_COLOR_SCHEME_CLASS_NAME} dark:[&_option]:bg-card dark:[&_option]:text-foreground`;

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
  const normalizedFrom = normalizeIsoDateOnly(from);
  const normalizedTo = normalizeIsoDateOnly(to);

  if (normalizedFrom && normalizedTo) {
    next.set("from", normalizedFrom);
    next.set("to", normalizedTo);
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

  const [isPending, startTransition] = useTransition();

  const [selectedPreset, setSelectedPreset] = useState<QuickPresetValue>(
    detectPresetValue(fromDate, toDate),
  );
  const [draftFromDate, setDraftFromDate] = useState(normalizeIsoDateOnly(fromDate) ?? "");
  const [draftToDate, setDraftToDate] = useState(normalizeIsoDateOnly(toDate) ?? "");
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
    startTransition(() => {
      router.push(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
    });
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
    <div className="relative w-full space-y-2 rounded-xl border border-border bg-card p-3">
      {isPending ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-card/90">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span>Applying filters...</span>
          </div>
        </div>
      ) : null}
      <div className={`grid gap-2 ${gridClassName}`}>
        <label className="flex flex-col gap-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
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
            className={`${ANALYTICS_FIELD_CLASS_NAME} ${ANALYTICS_NATIVE_SELECT_CLASS_NAME}`}
          >
            {QUICK_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          From
          <input
            type="date"
            value={draftFromDate}
            onChange={(event) => {
              const nextFromDate = event.target.value;
              setDraftFromDate(nextFromDate);
              setSelectedPreset("custom");
            }}
            className={`${ANALYTICS_FIELD_CLASS_NAME} ${ANALYTICS_COLOR_SCHEME_CLASS_NAME}`}
          />
        </label>

        <label className="flex flex-col gap-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          To
          <input
            type="date"
            value={draftToDate}
            onChange={(event) => {
              const nextToDate = event.target.value;
              setDraftToDate(nextToDate);
              setSelectedPreset("custom");
            }}
            className={`${ANALYTICS_FIELD_CLASS_NAME} ${ANALYTICS_COLOR_SCHEME_CLASS_NAME}`}
          />
        </label>

        {canUseScopeFilters ? (
          <>
            <label className="flex flex-col gap-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Department
              <select
                value={draftDepartmentId}
                onChange={(event) => setDraftDepartmentId(event.target.value)}
                className={`${ANALYTICS_FIELD_CLASS_NAME} ${ANALYTICS_NATIVE_SELECT_CLASS_NAME}`}
              >
                <option value="">All Departments</option>
                {departmentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Expense Category
              <select
                value={draftExpenseCategoryId}
                onChange={(event) => setDraftExpenseCategoryId(event.target.value)}
                className={`${ANALYTICS_FIELD_CLASS_NAME} ${ANALYTICS_NATIVE_SELECT_CLASS_NAME}`}
              >
                <option value="">All Expense Categories</option>
                {expenseCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Product
              <select
                value={draftProductId}
                onChange={(event) => setDraftProductId(event.target.value)}
                className={`${ANALYTICS_FIELD_CLASS_NAME} ${ANALYTICS_NATIVE_SELECT_CLASS_NAME}`}
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
            <label className="flex flex-col gap-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Finance Approver
              <select
                value={draftFinanceApproverId}
                onChange={(event) => setDraftFinanceApproverId(event.target.value)}
                className={`${ANALYTICS_FIELD_CLASS_NAME} ${ANALYTICS_NATIVE_SELECT_CLASS_NAME}`}
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
          disabled={isPending}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={applyFilters}
          disabled={isPending}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Applying..." : "Apply Filters"}
        </button>
      </div>
    </div>
  );
}
