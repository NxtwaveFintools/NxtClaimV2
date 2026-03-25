"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { getAccessTokenAction } from "@/modules/auth/actions";
import type {
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
} from "@/core/domain/claims/contracts";

function getFileNameFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const utf8FileNameMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8FileNameMatch?.[1]) {
    return decodeURIComponent(utf8FileNameMatch[1]);
  }

  const quotedFileNameMatch = headerValue.match(/filename="([^"]+)"/i);
  if (quotedFileNameMatch?.[1]) {
    return quotedFileNameMatch[1];
  }

  const plainFileNameMatch = headerValue.match(/filename=([^;]+)/i);
  if (plainFileNameMatch?.[1]) {
    return plainFileNameMatch[1].trim();
  }

  return null;
}

const SEARCH_FIELD_OPTIONS: Array<{ value: ClaimSearchField; label: string }> = [
  { value: "claim_id", label: "Claim ID" },
  { value: "employee_name", label: "Employee Name" },
  { value: "employee_id", label: "Employee ID" },
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
    "submission_type",
    "payment_mode_id",
    "department_id",
    "location_id",
    "product_id",
    "expense_category_id",
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
  defaultFiltersExpanded?: boolean;
  paymentModes: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  expenseCategories: Array<{ id: string; name: string }>;
};

export function ClaimsFilterBar({
  exportScope,
  defaultFiltersExpanded = false,
  paymentModes,
  departments,
  locations,
  products,
  expenseCategories,
}: ClaimsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);

  // ---------------------------------------------------------------------------
  // Local state for instant UI (decoupled from URL / server round-trip)
  // ---------------------------------------------------------------------------
  const [searchInput, setSearchInput] = useState(searchParams.get("search_query") ?? "");
  const [debouncedSearchInput, setDebouncedSearchInput] = useState(
    searchParams.get("search_query")?.trim() ?? "",
  );
  const [isExporting, setIsExporting] = useState(false);

  const [localSearchField, setLocalSearchField] = useState(
    searchParams.get("search_field") ?? "claim_id",
  );
  const [localDateTarget, setLocalDateTarget] = useState<ClaimDateTarget>(
    (searchParams.get("date_target") as ClaimDateTarget | null) ?? "submitted",
  );
  const [localSubmissionType, setLocalSubmissionType] = useState(
    searchParams.get("submission_type") ?? "",
  );
  const [localPaymentModeId, setLocalPaymentModeId] = useState(
    searchParams.get("payment_mode_id") ?? "",
  );
  const [localDepartmentId, setLocalDepartmentId] = useState(
    searchParams.get("department_id") ?? "",
  );
  const [localLocationId, setLocalLocationId] = useState(searchParams.get("location_id") ?? "");
  const [localProductId, setLocalProductId] = useState(searchParams.get("product_id") ?? "");
  const [localExpenseCategoryId, setLocalExpenseCategoryId] = useState(
    searchParams.get("expense_category_id") ?? "",
  );
  const [localStatus, setLocalStatus] = useState(searchParams.get("status") ?? "");
  const [localFromDate, setLocalFromDate] = useState(searchParams.get("from") ?? "");
  const [localToDate, setLocalToDate] = useState(searchParams.get("to") ?? "");

  const filtersParam = currentParams.get("filters");
  const isFiltersExpanded =
    filtersParam === "open"
      ? true
      : filtersParam === "closed"
        ? false
        : defaultFiltersExpanded || hasActiveFilterParams(currentParams);

  // ---------------------------------------------------------------------------
  // Sync local state ← URL on external navigation (Back / Forward buttons)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setSearchInput(searchParams.get("search_query") ?? "");
    setLocalSearchField(searchParams.get("search_field") ?? "claim_id");
    setLocalDateTarget((searchParams.get("date_target") as ClaimDateTarget | null) ?? "submitted");
    setLocalSubmissionType(searchParams.get("submission_type") ?? "");
    setLocalPaymentModeId(searchParams.get("payment_mode_id") ?? "");
    setLocalDepartmentId(searchParams.get("department_id") ?? "");
    setLocalLocationId(searchParams.get("location_id") ?? "");
    setLocalProductId(searchParams.get("product_id") ?? "");
    setLocalExpenseCategoryId(searchParams.get("expense_category_id") ?? "");
    setLocalStatus(searchParams.get("status") ?? "");
    setLocalFromDate(searchParams.get("from") ?? "");
    setLocalToDate(searchParams.get("to") ?? "");
  }, [searchParams]);

  // ---------------------------------------------------------------------------
  // Search debounce (400 ms)
  // ---------------------------------------------------------------------------
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
    startTransition(() => {
      updateUrlWithMutation(nextParams, pathname, router);
    });
  }, [debouncedSearchInput, pathname, router, searchParams]);

  // ---------------------------------------------------------------------------
  // Helpers: update local state immediately → push to URL inside startTransition
  // ---------------------------------------------------------------------------
  function setParam(name: string, value: string, localSetter: (v: string) => void): void {
    localSetter(value);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (value) {
      nextParams.set(name, value);
    } else {
      nextParams.delete(name);
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    startTransition(() => {
      updateUrlWithMutation(nextParams, pathname, router);
    });
  }

  function handleSearchFieldChange(nextValue: string): void {
    setLocalSearchField(nextValue);

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
    startTransition(() => {
      updateUrlWithMutation(nextParams, pathname, router);
    });
  }

  function handleDateTargetChange(value: ClaimDateTarget): void {
    setLocalDateTarget(value);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (value === "submitted") {
      nextParams.delete("date_target");
    } else {
      nextParams.set("date_target", value);
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    startTransition(() => {
      updateUrlWithMutation(nextParams, pathname, router);
    });
  }

  async function handleExportCsv(): Promise<void> {
    if (isExporting) {
      return;
    }

    setIsExporting(true);

    try {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("cursor");
      params.delete("prevCursor");
      params.set("scope", exportScope);

      const accessToken = await getAccessTokenAction();
      if (!accessToken) {
        throw new Error("Export failed. Unauthorized session.");
      }

      const response = await fetch(`${ROUTES.exportApi.claims}?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
          meta?: { correlationId?: string };
        } | null;

        const message = errorPayload?.error?.message ?? `Export failed. Status: ${response.status}`;
        const correlationId = errorPayload?.meta?.correlationId;
        const fullMessage = correlationId
          ? `${message} (correlationId: ${correlationId})`
          : message;

        throw new Error(fullMessage);
      }

      const xlsxBuffer = await response.arrayBuffer();
      const headerFileName = getFileNameFromContentDisposition(
        response.headers.get("content-disposition"),
      );
      const fileName = headerFileName || "claims_export.xlsx";

      const fileBlob = new Blob([xlsxBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

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

  const hasActiveFilters = hasActiveFilterParams(currentParams);

  const searchPlaceholder =
    localSearchField === "claim_id"
      ? "Search by Claim ID..."
      : localSearchField === "employee_name"
        ? "Search by Employee Name..."
        : "Search by Employee ID...";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
      {isPending ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
          Updating results…
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60">
          {DATE_TARGET_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                handleDateTargetChange(option.value);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                localDateTarget === option.value
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
              const nextParams = new URLSearchParams(searchParams.toString());
              nextParams.set("filters", isFiltersExpanded ? "closed" : "open");
              nextParams.delete("cursor");
              nextParams.delete("prevCursor");
              startTransition(() => {
                updateUrlWithMutation(nextParams, pathname, router);
              });
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
              setLocalSearchField("claim_id");
              setLocalDateTarget("submitted");
              setLocalSubmissionType("");
              setLocalPaymentModeId("");
              setLocalDepartmentId("");
              setLocalLocationId("");
              setLocalProductId("");
              setLocalExpenseCategoryId("");
              setLocalStatus("");
              setLocalFromDate("");
              setLocalToDate("");

              const nextParams = new URLSearchParams();
              const currentView = searchParams.get("view");
              const currentFilters = searchParams.get("filters");

              if (currentView) {
                nextParams.set("view", currentView);
              }

              if (currentFilters) {
                nextParams.set("filters", currentFilters);
              }

              startTransition(() => {
                updateUrlWithMutation(nextParams, pathname, router);
              });
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
          isFiltersExpanded ? "mt-6 max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="grid gap-5 md:grid-cols-3 xl:grid-cols-3">
          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Search Category
            <select
              value={localSearchField}
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
              placeholder={searchPlaceholder}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Submission Type
            <select
              value={localSubmissionType}
              onChange={(event) => {
                setParam("submission_type", event.target.value, setLocalSubmissionType);
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
              value={localPaymentModeId}
              onChange={(event) => {
                setParam("payment_mode_id", event.target.value, setLocalPaymentModeId);
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
            Department
            <select
              value={localDepartmentId}
              onChange={(event) => {
                setParam("department_id", event.target.value, setLocalDepartmentId);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Location
            <select
              value={localLocationId}
              onChange={(event) => {
                setParam("location_id", event.target.value, setLocalLocationId);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Product
            <select
              value={localProductId}
              onChange={(event) => {
                setParam("product_id", event.target.value, setLocalProductId);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Expense Category
            <select
              value={localExpenseCategoryId}
              onChange={(event) => {
                setParam("expense_category_id", event.target.value, setLocalExpenseCategoryId);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All</option>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            Status
            <select
              value={localStatus}
              onChange={(event) => {
                setParam("status", event.target.value, setLocalStatus);
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
              value={localFromDate}
              onChange={(event) => {
                setParam("from", event.target.value, setLocalFromDate);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>

          <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-300">
            To
            <input
              type="date"
              value={localToDate}
              onChange={(event) => {
                setParam("to", event.target.value, setLocalToDate);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
