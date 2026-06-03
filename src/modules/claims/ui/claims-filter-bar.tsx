"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Filter, SlidersHorizontal, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { ROUTES } from "@/core/config/route-registry";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import { normalizeIsoDateOnly } from "@/lib/date-only";
import { getAccessTokenAction } from "@/modules/auth/actions";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";
import type {
  ClaimDateTarget,
  ClaimSearchField,
  ClaimSubmissionType,
} from "@/core/domain/claims/contracts";

const AdvancedFiltersSheet = dynamic(
  () =>
    import("@/modules/claims/ui/advanced-filters-sheet").then(
      (module) => module.AdvancedFiltersSheet,
    ),
  {
    loading: () => (
      <div className="inline-flex h-9 w-36 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground">
        Advanced Filters
      </div>
    ),
  },
);

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

const SEARCH_DEBOUNCE_MS = 400;
const MIN_SEARCH_QUERY_LENGTH = 3;

function getSanitizedSearchLength(query: string): number {
  return query.replace(/-/g, "").trim().length;
}

function shouldSyncSearchQuery(query: string): boolean {
  const sanitizedLength = getSanitizedSearchLength(query);
  return sanitizedLength === 0 || sanitizedLength >= MIN_SEARCH_QUERY_LENGTH;
}

function updateUrlWithMutation(
  params: URLSearchParams,
  pathname: string,
  router: ReturnType<typeof useRouter>,
): void {
  const query = params.toString();
  const nextHref = query ? `${pathname}?${query}` : pathname;

  if (typeof window !== "undefined") {
    const currentQuery = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search;
    const currentHref = currentQuery ? `${pathname}?${currentQuery}` : pathname;

    if (currentHref === nextHref) {
      return;
    }
  }

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

function parseIsoDateOnly(value: string): Date | null {
  const normalized = normalizeIsoDateOnly(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

export type ClaimsFilterBarExportScope =
  | "submissions"
  | "approvals"
  | "finance_hod_pending"
  | "admin"
  | "department";

type StatusFilterMode = "visible" | "disabled" | "hidden";

function setOrDeleteTrimmedParam(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();

  if (trimmed.length > 0) {
    params.set(key, trimmed);
    return;
  }

  params.delete(key);
}

function setOrDeleteIsoDateParam(params: URLSearchParams, key: string, value: string): void {
  const normalized = normalizeIsoDateOnly(value);
  if (normalized) {
    params.set(key, normalized);
    return;
  }

  params.delete(key);
}

function normalizeDateQueryValue(value: string): string {
  return normalizeIsoDateOnly(value) ?? "";
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

  if (searchQuery.length > 0 && shouldSyncSearchQuery(searchQuery)) {
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
  setOrDeleteIsoDateParam(params, "from", filters.localFromDate);
  setOrDeleteIsoDateParam(params, "to", filters.localToDate);

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
  exportScope?: ClaimsFilterBarExportScope;
  defaultFiltersExpanded?: boolean;
  isAdmin?: boolean;
  storageScope?: string;
  lockedStatus?: DbClaimStatus;
  statusFilterMode?: StatusFilterMode;
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
  storageScope,
  lockedStatus,
  statusFilterMode = "visible",
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
  const isHydratingFromUrlRef = useRef(false);

  const currentParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const storageKeyPrefix = useMemo(
    () => `dashboard-filter-${storageScope ?? exportScope ?? "submissions"}`,
    [exportScope, storageScope],
  );
  const storageKeys = useMemo(
    () => ({
      searchInput: `${storageKeyPrefix}-search-query`,
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
  const debouncedSearchInput = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
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
    searchParams.get("status") ?? lockedStatus ?? "",
  );
  const [localFromDate, setLocalFromDate] = useSessionStorage(
    storageKeys.fromDate,
    normalizeDateQueryValue(searchParams.get("from") ?? ""),
  );
  const [localToDate, setLocalToDate] = useSessionStorage(
    storageKeys.toDate,
    normalizeDateQueryValue(searchParams.get("to") ?? ""),
  );

  const filtersParam = currentParams.get("filters");
  const isFiltersExpanded =
    filtersParam === "open" ? true : filtersParam === "closed" ? false : defaultFiltersExpanded;

  // ---------------------------------------------------------------------------
  // One-time restore from sessionStorage when URL has no active filters.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (hasInitializedFilterState) {
      return;
    }

    const urlHasActiveFilters = hasActiveFilterParams(currentParams);
    const urlHasAnyParams = currentParams.toString().length > 0;

    // If URL already contains params, treat URL as source-of-truth and avoid
    // mount-time router writes that can fight Back/Forward navigation.
    if (urlHasActiveFilters || urlHasAnyParams) {
      isHydratingFromUrlRef.current = true;
      const nextSearchInput = searchParams.get("search_query") ?? "";

      setSearchInput(nextSearchInput);
      setLocalSearchField(searchParams.get("search_field") ?? "claim_id");
      setLocalSubmissionType(searchParams.get("submission_type") ?? "");
      setLocalPaymentModeId(searchParams.get("payment_mode_id") ?? "");
      setLocalDepartmentId(searchParams.get("department_id") ?? "");
      setLocalLocationId(searchParams.get("location_id") ?? "");
      setLocalProductId(searchParams.get("product_id") ?? "");
      setLocalExpenseCategoryId(searchParams.get("expense_category_id") ?? "");
      setLocalStatus(searchParams.get("status") ?? "");
      setLocalFromDate(normalizeDateQueryValue(searchParams.get("from") ?? ""));
      setLocalToDate(normalizeDateQueryValue(searchParams.get("to") ?? ""));

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
      localStatus: readStoredValue(storageKeys.status, lockedStatus ?? ""),
      localFromDate: normalizeDateQueryValue(readStoredValue(storageKeys.fromDate, "")),
      localToDate: normalizeDateQueryValue(readStoredValue(storageKeys.toDate, "")),
    };

    if (!hasActiveStoredFilterState(storedFilters)) {
      setHasInitializedFilterState(true);
      return;
    }

    setSearchInput(storedFilters.searchInput);
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

    isHydratingFromUrlRef.current = true;
    const nextSearchInput = searchParams.get("search_query") ?? "";

    setSearchInput(nextSearchInput);
    setLocalSearchField(searchParams.get("search_field") ?? "claim_id");
    setLocalSubmissionType(searchParams.get("submission_type") ?? "");
    setLocalPaymentModeId(searchParams.get("payment_mode_id") ?? "");
    setLocalDepartmentId(searchParams.get("department_id") ?? "");
    setLocalLocationId(searchParams.get("location_id") ?? "");
    setLocalProductId(searchParams.get("product_id") ?? "");
    setLocalExpenseCategoryId(searchParams.get("expense_category_id") ?? "");
    setLocalStatus(searchParams.get("status") ?? lockedStatus ?? "");
    setLocalFromDate(normalizeDateQueryValue(searchParams.get("from") ?? ""));
    setLocalToDate(normalizeDateQueryValue(searchParams.get("to") ?? ""));
    // Setter functions from useSessionStorage are intentionally omitted to avoid
    // effect churn from unstable function identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInitializedFilterState, searchParams]);

  useEffect(() => {
    if (!lockedStatus) {
      return;
    }

    setLocalStatus(lockedStatus);
  }, [lockedStatus, setLocalStatus]);

  useEffect(() => {
    if (!hasInitializedFilterState) {
      return;
    }

    if (isHydratingFromUrlRef.current) {
      isHydratingFromUrlRef.current = false;
      return;
    }

    const trimmedDebouncedSearchInput = debouncedSearchInput.trim();
    const urlSearchValue = (searchParams.get("search_query") ?? "").trim();

    if (trimmedDebouncedSearchInput === urlSearchValue) {
      return;
    }

    if (!shouldSyncSearchQuery(trimmedDebouncedSearchInput)) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());

    if (trimmedDebouncedSearchInput) {
      nextParams.set("search_query", trimmedDebouncedSearchInput);
      if (!nextParams.get("search_field")) {
        nextParams.set("search_field", "claim_id");
      }
    } else {
      nextParams.delete("search_query");
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    nextParams.delete("page");

    if (nextParams.toString() === searchParams.toString()) {
      return;
    }

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
    const nextValue =
      name === "from" || name === "to" ? (normalizeIsoDateOnly(value) ?? "") : value;

    localSetter(nextValue);

    const nextParams = new URLSearchParams(searchParams.toString());

    if (nextValue) {
      nextParams.set(name, nextValue);
    } else {
      nextParams.delete(name);
    }

    if (name === "status" || name === "from" || name === "to") {
      const fromDate = (name === "from" ? nextValue : (nextParams.get("from") ?? "")).trim();
      const toDate = (name === "to" ? nextValue : (nextParams.get("to") ?? "")).trim();
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
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");
    nextParams.delete("page");
    startTransition(() => {
      updateUrlWithMutation(nextParams, pathname, router);
    });
  }

  async function handleExportXlsx(): Promise<void> {
    const parsedStartDate = parseIsoDateOnly((searchParams.get("from") ?? "").trim());
    const parsedEndDate = parseIsoDateOnly((searchParams.get("to") ?? "").trim());

    if (!parsedStartDate || !parsedEndDate || parsedEndDate < parsedStartDate) {
      toast.error("Please select a valid export date range.");
      return;
    }

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
        throw new Error("Missing session");
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

        throw new Error(
          errorPayload?.error?.message ?? `Export failed. Status: ${response.status}`,
        );
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
      toast.error(getUserFriendlyErrorMessage(error, "export"));
    } finally {
      setIsExporting(false);
    }
  }

  const hasActiveFilters = hasActiveFilterParams(currentParams);
  const renderedStatusValue = lockedStatus ?? localStatus;
  const statusOptions = lockedStatus ? [lockedStatus] : DB_CLAIM_STATUSES;
  const paymentModeOptions = useMemo(
    () =>
      paymentModes.map((mode) => (
        <option key={mode.id} value={mode.id}>
          {mode.name}
        </option>
      )),
    [paymentModes],
  );
  const departmentOptions = useMemo(
    () =>
      departments.map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      )),
    [departments],
  );
  const locationOptions = useMemo(
    () =>
      locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.name}
        </option>
      )),
    [locations],
  );
  const productOptions = useMemo(
    () =>
      products.map((product) => (
        <option key={product.id} value={product.id}>
          {product.name}
        </option>
      )),
    [products],
  );
  const expenseCategoryOptions = useMemo(
    () =>
      expenseCategories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      )),
    [expenseCategories],
  );
  const advancedFilterCount = [
    localSubmissionType,
    localPaymentModeId,
    localDepartmentId,
    localLocationId,
    localProductId,
    localExpenseCategoryId,
  ].filter((value) => value.trim().length > 0).length;

  const searchPlaceholder =
    localSearchField === "claim_id"
      ? "Search by Claim ID..."
      : localSearchField === "employee_name"
        ? "Search by Employee Name..."
        : localSearchField === "employee_id"
          ? "Search by Employee ID..."
          : "Search by Employee Email...";

  return (
    <section className="relative rounded-xl border border-border bg-card p-3 transition-colors">
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
            Updating results...
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-[1fr_1.5fr_1fr_145px_145px]">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Search Category
          <select
            value={localSearchField}
            onChange={(event) => {
              handleSearchFieldChange(event.target.value);
            }}
            className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
          >
            {SEARCH_FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Search
          <input
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
            placeholder={searchPlaceholder}
            className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
          />
        </label>

        {statusFilterMode !== "hidden" ? (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Status
            <select
              value={renderedStatusValue}
              disabled={statusFilterMode === "disabled"}
              onChange={(event) => {
                setParam("status", event.target.value, setLocalStatus);
              }}
              title={statusFilterMode === "disabled" ? "Status is fixed for this view." : undefined}
              className="nxt-input h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
            >
              {lockedStatus ? null : <option value="">All</option>}
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          From
          <input
            type="date"
            value={localFromDate}
            onChange={(event) => {
              setParam("from", event.target.value, setLocalFromDate);
            }}
            className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
          />
        </label>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          To
          <input
            type="date"
            value={localToDate}
            onChange={(event) => {
              setParam("to", event.target.value, setLocalToDate);
            }}
            className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
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
          className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition hover:bg-background-secondary"
          {...(isFiltersExpanded
            ? ({ "aria-expanded": "true" } as const)
            : ({ "aria-expanded": "false" } as const))}
          aria-controls="claims-filter-panel"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          More Filters
          {advancedFilterCount > 0 ? (
            <span className="rounded-full bg-accent-muted px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              {advancedFilterCount}
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
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-success/30 bg-success-muted px-3 text-sm font-semibold text-success transition hover:bg-success-muted/80 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {isExporting ? "Exporting..." : "Export Excel"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setSearchInput("");
            setLocalSearchField("claim_id");
            setLocalSubmissionType("");
            setLocalPaymentModeId("");
            setLocalDepartmentId("");
            setLocalLocationId("");
            setLocalProductId("");
            setLocalExpenseCategoryId("");
            setLocalStatus(lockedStatus ?? "");
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

            if (lockedStatus) {
              nextParams.set("status", lockedStatus);
            }

            startTransition(() => {
              updateUrlWithMutation(nextParams, pathname, router);
            });
          }}
          className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition hover:bg-background-secondary"
        >
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Clear All
        </button>
      </div>

      {hasActiveFilters ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background-secondary px-2 py-1">
            <Filter className="h-3 w-3" aria-hidden="true" />
            Filters applied
          </span>
        </div>
      ) : null}

      <div
        id="claims-filter-panel"
        hidden={!isFiltersExpanded}
        className={`grid transition-all duration-300 ${
          isFiltersExpanded ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Submission Type
              <select
                value={localSubmissionType}
                onChange={(event) => {
                  setParam("submission_type", event.target.value, setLocalSubmissionType);
                }}
                className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">All</option>
                {SUBMISSION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Payment Mode
              <select
                value={localPaymentModeId}
                onChange={(event) => {
                  setParam("payment_mode_id", event.target.value, setLocalPaymentModeId);
                }}
                className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">All</option>
                {paymentModeOptions}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Department
              <select
                value={localDepartmentId}
                onChange={(event) => {
                  setParam("department_id", event.target.value, setLocalDepartmentId);
                }}
                className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">All</option>
                {departmentOptions}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Location
              <select
                value={localLocationId}
                onChange={(event) => {
                  setParam("location_id", event.target.value, setLocalLocationId);
                }}
                className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">All</option>
                {locationOptions}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Product
              <select
                value={localProductId}
                onChange={(event) => {
                  setParam("product_id", event.target.value, setLocalProductId);
                }}
                className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">All</option>
                {productOptions}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Expense Category
              <select
                value={localExpenseCategoryId}
                onChange={(event) => {
                  setParam("expense_category_id", event.target.value, setLocalExpenseCategoryId);
                }}
                className="nxt-input h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
              >
                <option value="">All</option>
                {expenseCategoryOptions}
              </select>
            </label>

            {isAdmin && isFiltersExpanded ? (
              <div className="flex items-end ml-15">
                <AdvancedFiltersSheet />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
