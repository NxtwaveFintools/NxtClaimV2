import { Suspense } from "react";
import { logger } from "@/core/infra/logging/logger";
import { GetAdminClaimsService } from "@/core/domain/admin/GetAdminClaimsService";
import { SupabaseAdminRepository } from "@/modules/admin/repositories/SupabaseAdminRepository";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { AdminClaimsTable } from "@/modules/admin/ui/admin-claims-table";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { ClaimsFilterBar } from "@/modules/claims/ui/claims-filter-bar";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { normalizeIsoDateOnly } from "@/lib/date-only";
import type { DbClaimStatus } from "@/core/constants/statuses";
import type { AdminClaimsFilters } from "@/core/domain/admin/contracts";
import type { ClaimSubmissionType } from "@/core/domain/claims/contracts";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";

type SearchParamsValue = string | string[] | undefined;
type ClaimsPaginationState = {
  cursor: string | null;
  prevCursor: string | null;
};
export type AdminClaimsViewMode = "active" | "deleted";

function firstParamValue(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeStatusFilter(value: string | undefined): DbClaimStatus[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is DbClaimStatus => DB_CLAIM_STATUSES.includes(entry as DbClaimStatus));
  return parsed.length === 0 ? undefined : parsed;
}

function normalizeDate(value: string | undefined): string | undefined {
  return normalizeIsoDateOnly(value);
}

function normalizeAmountFilter(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

const PAGE_SIZE = 5;

async function AdminClaimsTableSection({
  searchParams,
  pagination,
  mode,
  title,
}: {
  searchParams?: Record<string, SearchParamsValue>;
  pagination: ClaimsPaginationState;
  mode: AdminClaimsViewMode;
  title: string;
}) {
  const adminRepository = new SupabaseAdminRepository();
  const service = new GetAdminClaimsService({ repository: adminRepository, logger });

  const filters: AdminClaimsFilters = {
    status: normalizeStatusFilter(firstParamValue(searchParams?.status)),
    departmentId: firstParamValue(searchParams?.department_id)?.trim() || undefined,
    searchQuery: firstParamValue(searchParams?.search_query)?.trim() || undefined,
    searchField:
      (firstParamValue(searchParams?.search_field) as AdminClaimsFilters["searchField"]) ||
      undefined,
    submissionType:
      (firstParamValue(searchParams?.submission_type) as ClaimSubmissionType) || undefined,
    paymentModeId: firstParamValue(searchParams?.payment_mode_id)?.trim() || undefined,
    locationId: firstParamValue(searchParams?.location_id)?.trim() || undefined,
    productId: firstParamValue(searchParams?.product_id)?.trim() || undefined,
    expenseCategoryId: firstParamValue(searchParams?.expense_category_id)?.trim() || undefined,
    dateTarget:
      (firstParamValue(searchParams?.date_target) as AdminClaimsFilters["dateTarget"]) || undefined,
    dateFrom: normalizeDate(firstParamValue(searchParams?.from)?.trim() || undefined),
    dateTo: normalizeDate(firstParamValue(searchParams?.to)?.trim() || undefined),
    submittedFrom: normalizeDate(firstParamValue(searchParams?.adv_sub_from)?.trim() || undefined),
    submittedTo: normalizeDate(firstParamValue(searchParams?.adv_sub_to)?.trim() || undefined),
    hodActionFrom: normalizeDate(firstParamValue(searchParams?.adv_hod_from)?.trim() || undefined),
    hodActionTo: normalizeDate(firstParamValue(searchParams?.adv_hod_to)?.trim() || undefined),
    financeActionFrom: normalizeDate(
      firstParamValue(searchParams?.adv_fin_from)?.trim() || undefined,
    ),
    financeActionTo: normalizeDate(firstParamValue(searchParams?.adv_fin_to)?.trim() || undefined),
    minAmount: normalizeAmountFilter(firstParamValue(searchParams?.min_amt)?.trim() || undefined),
    maxAmount: normalizeAmountFilter(firstParamValue(searchParams?.max_amt)?.trim() || undefined),
    isActive: mode === "active",
  };

  const result = await service.execute({
    filters,
    pagination: { cursor: pagination.cursor, limit: PAGE_SIZE },
  });

  if (result.errorMessage || !result.data) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">Showing 0 claims</p>
        </div>
        <div className="px-4 py-6">
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
            Unable to load claims. {result.errorMessage ?? "Unknown error"}
          </p>
        </div>
      </>
    );
  }

  const { data: claims, nextCursor, hasNextPage } = result.data;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h2>
        {claims.length === 0 ? (
          <p className="text-xs text-muted-foreground">Showing 0 claims</p>
        ) : (
          <MyClaimsPaginationControls
            hasNextPage={hasNextPage}
            currentCursor={pagination.cursor}
            nextCursor={nextCursor}
            prevCursor={pagination.prevCursor}
            summaryText={`Showing ${claims.length} claims`}
            position="inline"
            searchParams={searchParams}
          />
        )}
      </div>
      <AdminClaimsTable claims={claims} />
    </>
  );
}

async function AdminFilterBarWithData({
  defaultFiltersExpanded,
}: {
  defaultFiltersExpanded: boolean;
}) {
  const claimRepository = new SupabaseClaimRepository();
  const [paymentModesResult, departmentsResult, locationsResult, productsResult, categoriesResult] =
    await Promise.all([
      claimRepository.getActivePaymentModes(),
      claimRepository.getActiveDepartments(),
      claimRepository.getActiveLocations(),
      claimRepository.getActiveProducts(),
      claimRepository.getActiveExpenseCategories(),
    ]);

  return (
    <ClaimsFilterBar
      exportScope="admin"
      defaultFiltersExpanded={defaultFiltersExpanded}
      isAdmin
      paymentModes={paymentModesResult.data.map((m) => ({ id: m.id, name: m.name }))}
      departments={departmentsResult.data.map((d) => ({ id: d.id, name: d.name }))}
      locations={locationsResult.data.map((l) => ({ id: l.id, name: l.name }))}
      products={productsResult.data.map((p) => ({ id: p.id, name: p.name }))}
      expenseCategories={categoriesResult.data.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}

export function AdminClaimsSection({
  searchParams,
  pagination,
  mode,
  defaultFiltersExpanded = false,
}: {
  searchParams?: Record<string, SearchParamsValue>;
  pagination: ClaimsPaginationState;
  mode: AdminClaimsViewMode;
  defaultFiltersExpanded?: boolean;
}) {
  const sectionTitle = mode === "deleted" ? "Admin Deleted Claims" : "Admin Active Claims";

  return (
    <section className="space-y-3">
      <Suspense fallback={null}>
        <AdminFilterBarWithData defaultFiltersExpanded={defaultFiltersExpanded} />
      </Suspense>
      <div className="overflow-hidden rounded-xl border border-border bg-card transition-colors">
        <Suspense fallback={<TableSkeleton />}>
          <AdminClaimsTableSection
            searchParams={searchParams}
            pagination={pagination}
            mode={mode}
            title={sectionTitle}
          />
        </Suspense>
      </div>
    </section>
  );
}
