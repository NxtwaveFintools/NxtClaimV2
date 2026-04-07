"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { getAccessTokenAction } from "@/modules/auth/actions";
import { AdvancedFiltersSheet } from "@/modules/claims/ui/advanced-filters-sheet";
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
  { value: "employee_email", label: "Employee Email" },
];

const SUBMISSION_TYPE_OPTIONS: Array<{ value: ClaimSubmissionType; label: string }> = [
  { value: "Self", label: "Self" },
  { value: "On Behalf", label: "On Behalf" },
];

function updateUrlWithMutation(
  params: URLSearchParams,
  pathname: string,
  router: ReturnType<typeof useRouter>,
): void {
  const query = params.toString();
  const nextHref = query ? `${pathname}?${query}` : pathname;
  router.replace(nextHref, { scroll: false });
}

function resolveSmartDateTarget(status: string): ClaimDateTarget {
  if (status === "HOD approved - Awaiting finance approval") {
    return "hod_action";
  }

  if (status === "Finance Approved - Payment under process" || status === "Payment Done - Closed") {
    return "finance_closed";
  }

  return "submitted";
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
    "adv_sub_from",
    "adv_sub_to",
    "adv_hod_from",
    "adv_hod_to",
    "adv_fin_from",
    "adv_fin_to",
    "min_amt",
    "max_amt",
  ];
  return trackedFilterKeys.some((key) => {
    const value = params.get(key);
    return Boolean(value && value.trim().length > 0);
  });
}

type StoredFilterState = {
  searchInput: string;
  localSearchField: string;
  localSubmissionType: string;
  localPaymentModeId: string;
  localDepartmentId: string;
  localLocationId: string;
  localProductId: string;
  localExpenseCategoryId: string;
  localStatus: string;
  localFromDate: string;
  localToDate: string;
};

function setOrDeleteTrimmedParam(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();

  if (trimmed.length > 0) {
    params.set(key, trimmed);
    return;
  }

  params.delete(key);
}

function hasActiveStoredFilterState(filters: StoredFilterState): boolean {
  if (filters.searchInput.trim().length > 0) {
    return true;
  }

  if ((filters.localSearchField || "claim_id") !== "claim_id") {
    return true;
  }

  const trackedValues = [
    filters.localSubmissionType,
    filters.localPaymentModeId,
    filters.localDepartmentId,
    filters.localLocationId,
    filters.localProductId,
    filters.localExpenseCategoryId,
    filters.localStatus,
    filters.localFromDate,
    filters.localToDate,
  ];

  return trackedValues.some((value) => value.trim().length > 0);
}

function applyStoredFiltersToParams(params: URLSearchParams, filters: StoredFilterState): void {
  const searchField = filters.localSearchField.trim() || "claim_id";
  const searchQuery = filters.searchInput.trim();

  if (searchQuery.length > 0) {
    params.set("search_query", searchQuery);
    params.set("search_field", searchField);
  } else {
    params.delete("search_query");

    if (searchField === "claim_id") {
      params.delete("search_field");
    } else {
      params.set("search_field", searchField);
    }
  }

  setOrDeleteTrimmedParam(params, "submission_type", filters.localSubmissionType);
  setOrDeleteTrimmedParam(params, "payment_mode_id", filters.localPaymentModeId);
  setOrDeleteTrimmedParam(params, "department_id", filters.localDepartmentId);
  setOrDeleteTrimmedParam(params, "location_id", filters.localLocationId);
  setOrDeleteTrimmedParam(params, "product_id", filters.localProductId);
  setOrDeleteTrimmedParam(params, "expense_category_id", filters.localExpenseCategoryId);
  setOrDeleteTrimmedParam(params, "status", filters.localStatus);
  setOrDeleteTrimmedParam(params, "from", filters.localFromDate);
  setOrDeleteTrimmedParam(params, "to", filters.localToDate);

  const fromDate = filters.localFromDate.trim();
  const toDate = filters.localToDate.trim();
  const activeStatus = filters.localStatus.trim();

  if (fromDate || toDate) {
    params.set("date_target", resolveSmartDateTarget(activeStatus));
  } else {
    params.delete("date_target");
  }
}

type ClaimsFilterBarProps = {
  exportScope?: "submissions" | "approvals" | "admin" | "department";
  defaultFiltersExpanded?: boolean;
  isAdmin?: boolean;
  paymentModes: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  expenseCategories: Array<{ id: string; name: string }>;
};

export function ClaimsFilterBar({
  exportScope,
  defaultFiltersExpanded = false,
  isAdmin = false,
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
  const storageKeyPrefix = useMemo(
    () => `dashboard-filter-${exportScope ?? "submissions"}`,
    [exportScope],
  );
  const storageKeys = useMemo(
    () => ({
      searchInput: `${storageKeyPrefix}-search-query`,
      debouncedSearchInput: `${storageKeyPrefix}-search-query-debounced`,
      searchField: `${storageKeyPrefix}-search-field`,
      submissionType: `${storageKeyPrefix}-submission-type`,
      paymentModeId: `${storageKeyPrefix}-payment-mode-id`,
      departmentId: `${storageKeyPrefix}-department-id`,
      locationId: `${storageKeyPrefix}-location-id`,
      productId: `${storageKeyPrefix}-product-id`,
      expenseCategoryId: `${storageKeyPrefix}-expense-category-id`,
      status: `${storageKeyPrefix}-status`,
      fromDate: `${storageKeyPrefix}-from-date`,
      toDate: `${storageKeyPrefix}-to-date`,
    }),
    [storageKeyPrefix],
  );

  // ---------------------------------------------------------------------------
  // Local state for instant UI (decoupled from URL / server round-trip)
  // ---------------------------------------------------------------------------
  const [searchInput, setSearchInput] = useSessionStorage(
    storageKeys.searchInput,
    searchParams.get("search_query") ?? "",
  );
  const [debouncedSearchInput, setDebouncedSearchInput] = useSessionStorage(
    storageKeys.debouncedSearchInput,
    searchParams.get("search_query")?.trim() ?? "",
  );
  const [isExporting, setIsExporting] = useState(false);
  const [hasInitializedFilterState, setHasInitializedFilterState] = useState(false);

  const [localSearchField, setLocalSearchField] = useSessionStorage(
    storageKeys.searchField,
    searchParams.get("search_field") ?? "claim_id",
  );
  const [localSubmissionType, setLocalSubmissionType] = useSessionStorage(
    storageKeys.submissionType,
    searchParams.get("submission_type") ?? "",
  );
  const [localPaymentModeId, setLocalPaymentModeId] = useSessionStorage(
    storageKeys.paymentModeId,
    searchParams.get("payment_mode_id") ?? "",
  );
  const [localDepartmentId, setLocalDepartmentId] = useSessionStorage(
    storageKeys.departmentId,
    searchParams.get("department_id") ?? "",
  );
  const [localLocationId, setLocalLocationId] = useSessionStorage(
    storageKeys.locationId,
    searchParams.get("location_id") ?? "",
  );
  const [localProductId, setLocalProductId] = useSessionStorage(
    storageKeys.productId,
    searchParams.get("product_id") ?? "",
  );
  const [localExpenseCategoryId, setLocalExpenseCategoryId] = useSessionStorage(
    storageKeys.expenseCategoryId,
    searchParams.get("expense_category_id") ?? "",
  );
  const [localStatus, setLocalStatus] = useSessionStorage(
    storageKeys.status,
    searchParams.get("status") ?? "",
  );
  const [localFromDate, setLocalFromDate] = useSessionStorage(
    storageKeys.fromDate,
    searchParams.get("from") ?? "",
  );
  const [localToDate, setLocalToDate] = useSessionStorage(
    storageKeys.toDate,
    searchParams.get("to") ?? "",
  );

  const filtersParam = currentParams.get("filters");
  const isFiltersExpanded =
    filtersParam === "open"
      ? true
      : filtersParam === "closed"
        ? false
        : defaultFiltersExpanded || hasActiveFilterParams(currentParams);

  // ---------------------------------------------------------------------------
  // One-time restore from sessionStorage when URL has no active filters.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (hasInitializedFilterState) {
      return;
    }

    const urlHasActiveFilters = hasActiveFilterParams(currentParams);

    if (urlHasActiveFilters) {
      const nextSearchInput = searchParams.get("search_query") ?? "";

      setSearchInput(nextSearchInput);
      setDebouncedSearchInput(nextSearchInput.trim());
      setLocalSearchField(searchParams.get("search_field") ?? "claim_id");
      setLocalSubmissionType(searchParams.get("submission_type") ?? "");
      setLocalPaymentModeId(searchParams.get("payment_mode_id") ?? "");
      setLocalDepartmentId(searchParams.get("department_id") ?? "");
      setLocalLocationId(searchParams.get("location_id") ?? "");
      setLocalProductId(searchParams.get("product_id") ?? "");
      setLocalExpenseCategoryId(searchParams.get("expense_category_id") ?? "");
      setLocalStatus(searchParams.get("status") ?? "");
      setLocalFromDate(searchParams.get("from") ?? "");
      setLocalToDate(searchParams.get("to") ?? "");

      setHasInitializedFilterState(true);
      return;
    }

    const readStoredValue = (key: string, fallback: string): string => {
      try {
        const rawValue = window.sessionStorage.getItem(key);
        if (!rawValue) {
          return fallback;
        }

        const parsed = JSON.parse(rawValue);
        return typeof parsed === "string" ? parsed : fallback;
      } catch {
        return fallback;
      }
    };

    const storedFilters: StoredFilterState = {
      searchInput: readStoredValue(storageKeys.searchInput, ""),
      localSearchField: readStoredValue(storageKeys.searchField, "claim_id"),
      localSubmissionType: readStoredValue(storageKeys.submissionType, ""),
      localPaymentModeId: readStoredValue(storageKeys.paymentModeId, ""),
      localDepartmentId: readStoredValue(storageKeys.departmentId, ""),
      localLocationId: readStoredValue(storageKeys.locationId, ""),
      localProductId: readStoredValue(storageKeys.productId, ""),
      localExpenseCategoryId: readStoredValue(storageKeys.expenseCategoryId, ""),
      localStatus: readStoredValue(storageKeys.status, ""),
      localFromDate: readStoredValue(storageKeys.fromDate, ""),
      localToDate: readStoredValue(storageKeys.toDate, ""),
    };

    if (!hasActiveStoredFilterState(storedFilters)) {
      setHasInitializedFilterState(true);
      return;
    }

    setSearchInput(storedFilters.searchInput);
    setDebouncedSearchInput(storedFilters.searchInput.trim());
    setLocalSearchField(storedFilters.localSearchField || "claim_id");
    setLocalSubmissionType(storedFilters.localSubmissionType);
    setLocalPaymentModeId(storedFilters.localPaymentModeId);
    setLocalDepartmentId(storedFilters.localDepartmentId);
    setLocalLocationId(storedFilters.localLocationId);
    setLocalProductId(storedFilters.localProductId);
    setLocalExpenseCategoryId(storedFilters.localExpenseCategoryId);
    setLocalStatus(storedFilters.localStatus);
    setLocalFromDate(storedFilters.localFromDate);
    setLocalToDate(storedFilters.localToDate);

    const nextParams = new URLSearchParams(searchParams.toString());
    applyStoredFiltersToParams(nextParams, storedFilters);
    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    nextParams.delete("page");

    if (nextParams.toString() !== searchParams.toString()) {
      startTransition(() => {
        updateUrlWithMutation(nextParams, pathname, router);
      });
    }

    setHasInitializedFilterState(true);
    // Setter functions from useSessionStorage are intentionally omitted to avoid
    // effect churn from unstable function identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentParams,
    hasInitializedFilterState,
    pathname,
    router,
    searchParams,
    startTransition,
    storageKeys,
  ]);

  // ---------------------------------------------------------------------------
  // Sync local state ← URL on external navigation (Back / Forward buttons)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasInitializedFilterState) {
      return;
    }

    const nextSearchInput = searchParams.get("search_query") ?? "";

    setSearchInput(nextSearchInput);
    setDebouncedSearchInput(nextSearchInput.trim());
    setLocalSearchField(searchParams.get("search_field") ?? "claim_id");
    setLocalSubmissionType(searchParams.get("submission_type") ?? "");
    setLocalPaymentModeId(searchParams.get("payment_mode_id") ?? "");
    setLocalDepartmentId(searchParams.get("department_id") ?? "");
    setLocalLocationId(searchParams.get("location_id") ?? "");
    setLocalProductId(searchParams.get("product_id") ?? "");
    setLocalExpenseCategoryId(searchParams.get("expense_category_id") ?? "");
    setLocalStatus(searchParams.get("status") ?? "");
    setLocalFromDate(searchParams.get("from") ?? "");
    setLocalToDate(searchParams.get("to") ?? "");
    // Setter functions from useSessionStorage are intentionally omitted to avoid
    // effect churn from unstable function identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInitializedFilterState, searchParams]);

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
    // Setter function from useSessionStorage is intentionally omitted to avoid
    // debounce re-scheduling on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    if (!hasInitializedFilterState) {
      return;
    }

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
    nextParams.delete("page");
    startTransition(() => {
      updateUrlWithMutation(nextParams, pathname, router);
    });
  }, [
    debouncedSearchInput,
    hasInitializedFilterState,
    pathname,
    router,
    searchParams,
    startTransition,
  ]);

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

    if (name === "status" || name === "from" || name === "to") {
      const fromDate = (name === "from" ? value : (nextParams.get("from") ?? "")).trim();
      const toDate = (name === "to" ? value : (nextParams.get("to") ?? "")).trim();
      const activeStatus = (name === "status" ? value : (nextParams.get("status") ?? "")).trim();

      if (fromDate || toDate) {
        const inferredTarget = resolveSmartDateTarget(activeStatus);
        nextParams.set("date_target", inferredTarget);
      } else {
        nextParams.delete("date_target");
      }
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    nextParams.delete("page");
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
    nextParams.delete("page");
    startTransition(() => {
      updateUrlWithMutation(nextParams, pathname, router);
    });
  }

  async function handleExportXlsx(): Promise<void> {
    if (isExporting || !exportScope) {
      return;
    }

    setIsExporting(true);

    try {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("cursor");
      params.delete("prevCursor");
      params.delete("page");
      params.set("scope", exportScope!);

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
        : localSearchField === "employee_id"
          ? "Search by Employee ID..."
          : "Search by Employee Email...";

  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white/92 p-4 shadow-[0_8px_32px_-12px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
      {isPending ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const nextParams = new URLSearchParams(searchParams.toString());
              nextParams.set("filters", isFiltersExpanded ? "closed" : "open");
              nextParams.delete("cursor");
              nextParams.delete("prevCursor");
              nextParams.delete("page");
              startTransition(() => {
                updateUrlWithMutation(nextParams, pathname, router);
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-expanded={isFiltersExpanded ? "true" : "false"}
            aria-controls="claims-filter-panel"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M3 6h18" />
              <path d="M6 12h12" />
              <path d="M10 18h4" />
            </svg>
            Filters
            {hasActiveFilters ? (
              <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                Active
              </span>
            ) : null}
          </button>

          {exportScope ? (
            <button
              type="button"
              onClick={() => {
                void handleExportXlsx();
              }}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
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
              {isExporting ? "Exporting..." : "Export Excel"}
            </button>
          ) : null}

          {isAdmin ? <AdvancedFiltersSheet /> : null}

          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setDebouncedSearchInput("");
              setLocalSearchField("claim_id");
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
            className="inline-flex rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Clear All
          </button>
        </div>
      </div>

      <div
        id="claims-filter-panel"
        className={`overflow-hidden transition-all duration-300 ${
          isFiltersExpanded ? "mt-4 max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Search Category
            <select
              value={localSearchField}
              onChange={(event) => {
                handleSearchFieldChange(event.target.value);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {SEARCH_FIELD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 sm:col-span-2 xl:col-span-3">
            Search
            <input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
              }}
              placeholder={searchPlaceholder}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Submission Type
            <select
              value={localSubmissionType}
              onChange={(event) => {
                setParam("submission_type", event.target.value, setLocalSubmissionType);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">All</option>
              {SUBMISSION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Payment Mode
            <select
              value={localPaymentModeId}
              onChange={(event) => {
                setParam("payment_mode_id", event.target.value, setLocalPaymentModeId);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">All</option>
              {paymentModes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Department
            <select
              value={localDepartmentId}
              onChange={(event) => {
                setParam("department_id", event.target.value, setLocalDepartmentId);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">All</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Location
            <select
              value={localLocationId}
              onChange={(event) => {
                setParam("location_id", event.target.value, setLocalLocationId);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">All</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Product
            <select
              value={localProductId}
              onChange={(event) => {
                setParam("product_id", event.target.value, setLocalProductId);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">All</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Expense Category
            <select
              value={localExpenseCategoryId}
              onChange={(event) => {
                setParam("expense_category_id", event.target.value, setLocalExpenseCategoryId);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">All</option>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Status
            <select
              value={localStatus}
              onChange={(event) => {
                setParam("status", event.target.value, setLocalStatus);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">All</option>
              {DB_CLAIM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            From
            <input
              type="date"
              value={localFromDate}
              onChange={(event) => {
                setParam("from", event.target.value, setLocalFromDate);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            To
            <input
              type="date"
              value={localToDate}
              onChange={(event) => {
                setParam("to", event.target.value, setLocalToDate);
              }}
              className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
