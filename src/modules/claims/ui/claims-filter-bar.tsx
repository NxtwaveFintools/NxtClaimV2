"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { getAccessTokenAction } from "@/modules/auth/actions";
import type {
  ClaimDateTarget,
  ClaimDetailType,
  ClaimSearchField,
  ClaimSubmissionType,
} from "@/core/domain/claims/contracts";

const SEARCH_FIELD_OPTIONS: Array<{ value: ClaimSearchField; label: string }> = [
  { value: "claim_id", label: "Claim ID" },
  { value: "employee_name", label: "Employee Name" },
  { value: "employee_id", label: "Employee ID" },
];

const DETAIL_TYPE_OPTIONS: Array<{ value: ClaimDetailType; label: string }> = [
  { value: "expense", label: "Expense" },
  { value: "advance", label: "Advance" },
];

const SUBMISSION_TYPE_OPTIONS: Array<{ value: ClaimSubmissionType; label: string }> = [
  { value: "Self", label: "Self" },
  { value: "On Behalf", label: "On Behalf" },
];

const DATE_TARGET_OPTIONS: Array<{ value: ClaimDateTarget; label: string }> = [
  { value: "submitted", label: "Submitted Date" },
  { value: "finance_closed", label: "Finance Approved/Closed" },
];

function updateUrlWithMutation(
  params: URLSearchParams,
  pathname: string,
  router: ReturnType<typeof useRouter>,
): void {
  const query = params.toString();
  const nextHref = query ? `${pathname}?${query}` : pathname;
  router.push(nextHref);
}

function hasActiveFilterParams(params: URLSearchParams): boolean {
  const dateTarget = params.get("date_target");
  const searchQuery = (params.get("search_query") ?? "").trim();
  const searchField = params.get("search_field");

  if (searchQuery.length > 0) {
    return true;
  }

  if (searchField && searchField !== "claim_id") {
    return true;
  }

  if (dateTarget && dateTarget !== "submitted") {
    return true;
  }

  const trackedFilterKeys = [
    "detail_type",
    "submission_type",
    "payment_mode_id",
    "status",
    "from",
    "to",
  ];
  return trackedFilterKeys.some((key) => {
    const value = params.get(key);
    return Boolean(value && value.trim().length > 0);
  });
}

type ClaimsFilterBarProps = {
  exportScope: "submissions" | "approvals";
  paymentModes: Array<{ id: string; name: string }>;
};

function extractFilenameFromDisposition(dispositionHeader: string | null): string | null {
  if (!dispositionHeader) {
    return null;
  }

  const utf8Match = dispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = dispositionHeader.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return null;
}

export function ClaimsFilterBar({ exportScope, paymentModes }: ClaimsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);

  const currentSearchQuery = currentParams.get("search_query") ?? "";
  const [searchInput, setSearchInput] = useState(currentSearchQuery);
  const [debouncedSearchInput, setDebouncedSearchInput] = useState(currentSearchQuery);
  const [isExporting, setIsExporting] = useState(false);
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(() =>
    hasActiveFilterParams(new URLSearchParams(searchParams.toString())),
  );

  useEffect(() => {
    setSearchInput(currentSearchQuery);
  }, [currentSearchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchInput(searchInput.trim());
    }, 400);

    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    const urlSearchValue = (searchParams.get("search_query") ?? "").trim();

    if (debouncedSearchInput === urlSearchValue) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());

    if (debouncedSearchInput) {
      nextParams.set("search_query", debouncedSearchInput);
      if (!nextParams.get("search_field")) {
        nextParams.set("search_field", "claim_id");
      }
    } else {
      nextParams.delete("search_query");
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    updateUrlWithMutation(nextParams, pathname, router);
  }, [debouncedSearchInput, pathname, router, searchParams]);

  function setParam(name: string, value: string): void {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (value) {
      nextParams.set(name, value);
    } else {
      nextParams.delete(name);
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    updateUrlWithMutation(nextParams, pathname, router);
  }

  function handleSearchFieldChange(nextValue: string): void {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (nextValue) {
      nextParams.set("search_field", nextValue);
    } else {
      nextParams.delete("search_field");
      nextParams.delete("search_query");
      setSearchInput("");
      setDebouncedSearchInput("");
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    updateUrlWithMutation(nextParams, pathname, router);
  }

  function handleDateTargetChange(value: ClaimDateTarget): void {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (value === "submitted") {
      nextParams.delete("date_target");
    } else {
      nextParams.set("date_target", value);
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    updateUrlWithMutation(nextParams, pathname, router);
  }

  async function handleExportCsv(): Promise<void> {
    if (isExporting) {
      return;
    }

    setIsExporting(true);

    try {
      const accessToken = await getAccessTokenAction();

      if (!accessToken) {
        router.push(ROUTES.login);
        return;
      }

      const params = new URLSearchParams(searchParams.toString());
      params.delete("cursor");
      params.delete("prevCursor");
      params.set("scope", exportScope);

      const response = await fetch(`${ROUTES.exportApi.claims}?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }

      const fileBlob = await response.blob();
      const fallbackName = "claims_export.csv";
      const fileName =
        extractFilenameFromDisposition(response.headers.get("content-disposition")) ?? fallbackName;
      const objectUrl = URL.createObjectURL(fileBlob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("claims.export.failed", error);
    } finally {
      setIsExporting(false);
    }
  }

  const selectedSearchField = currentParams.get("search_field") ?? "claim_id";
  const selectedDateTarget =
    (currentParams.get("date_target") as ClaimDateTarget | null) ?? "submitted";
  const selectedDetailType = currentParams.get("detail_type") ?? "";
  const selectedSubmissionType = currentParams.get("submission_type") ?? "";
  const selectedPaymentModeId = currentParams.get("payment_mode_id") ?? "";
  const selectedStatus = currentParams.get("status") ?? "";
  const selectedFromDate = currentParams.get("from") ?? "";
  const selectedToDate = currentParams.get("to") ?? "";
  const hasActiveFilters = hasActiveFilterParams(currentParams);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60">
          {DATE_TARGET_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                handleDateTargetChange(option.value);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                selectedDateTarget === option.value
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsFiltersExpanded((previous) => !previous);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            aria-expanded={isFiltersExpanded}
            aria-controls="claims-filter-panel"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M3 6h18" />
              <path d="M6 12h12" />
              <path d="M10 18h4" />
            </svg>
            Toggle Filters
            {hasActiveFilters ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">
                Active
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => {
              void handleExportCsv();
            }}
            disabled={isExporting}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M12 3v11" />
              <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
              <path d="M4 17.5A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5" />
            </svg>
            {isExporting ? "Exporting..." : "Export CSV"}
          </button>

          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setDebouncedSearchInput("");
              router.push(pathname);
            }}
            className="inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Clear All
          </button>
        </div>
      </div>

      <div
        id="claims-filter-panel"
        className={`overflow-hidden transition-all duration-300 ${
          isFiltersExpanded ? "mt-4 max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Search Category
            <select
              value={selectedSearchField}
              onChange={(event) => {
                handleSearchFieldChange(event.target.value);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {SEARCH_FIELD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300 md:col-span-1 xl:col-span-3">
            Search
            <input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
              }}
              placeholder="Search claims"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Detail Type
            <select
              value={selectedDetailType}
              onChange={(event) => {
                setParam("detail_type", event.target.value);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {DETAIL_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Submission Type
            <select
              value={selectedSubmissionType}
              onChange={(event) => {
                setParam("submission_type", event.target.value);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {SUBMISSION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Payment Mode
            <select
              value={selectedPaymentModeId}
              onChange={(event) => {
                setParam("payment_mode_id", event.target.value);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {paymentModes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Status
            <select
              value={selectedStatus}
              onChange={(event) => {
                setParam("status", event.target.value);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {DB_CLAIM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            From
            <input
              type="date"
              value={selectedFromDate}
              onChange={(event) => {
                setParam("from", event.target.value);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            To
            <input
              type="date"
              value={selectedToDate}
              onChange={(event) => {
                setParam("to", event.target.value);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
