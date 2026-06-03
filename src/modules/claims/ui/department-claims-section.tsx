import { Suspense } from "react";
import { logger } from "@/core/infra/logging/logger";
import { GetDepartmentViewClaimsService } from "@/core/domain/claims/GetDepartmentViewClaimsService";
import { SupabaseDepartmentViewerRepository } from "@/modules/claims/repositories/SupabaseDepartmentViewerRepository";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { DepartmentClaimsTable } from "@/modules/claims/ui/department-claims-table";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { ClaimsFilterBar } from "@/modules/claims/ui/claims-filter-bar";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import type { DbClaimStatus } from "@/core/constants/statuses";
import type { DepartmentViewerFilters, ClaimSubmissionType } from "@/core/domain/claims/contracts";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { ROUTES } from "@/core/config/route-registry";
import { redirect } from "next/navigation";
import { normalizeIsoDateOnly } from "@/lib/date-only";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

type SearchParamsValue = string | string[] | undefined;
type ClaimsPaginationState = {
  cursor: string | null;
  prevCursor: string | null;
};

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

const PAGE_SIZE = 5;

async function DepartmentClaimsTableSection({
  searchParams,
  pagination,
  title,
}: {
  searchParams?: Record<string, SearchParamsValue>;
  pagination: ClaimsPaginationState;
  title: string;
}) {
  const authRepository = new SupabaseServerAuthRepository();
  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const repository = new SupabaseDepartmentViewerRepository();
  const service = new GetDepartmentViewClaimsService({ repository, logger });

  const filters: DepartmentViewerFilters = {
    status: normalizeStatusFilter(firstParamValue(searchParams?.status)),
    departmentId: firstParamValue(searchParams?.department_id)?.trim() || undefined,
    searchQuery: firstParamValue(searchParams?.search_query)?.trim() || undefined,
    searchField:
      (firstParamValue(searchParams?.search_field) as DepartmentViewerFilters["searchField"]) ||
      undefined,
    submissionType:
      (firstParamValue(searchParams?.submission_type) as ClaimSubmissionType) || undefined,
    paymentModeId: firstParamValue(searchParams?.payment_mode_id)?.trim() || undefined,
    locationId: firstParamValue(searchParams?.location_id)?.trim() || undefined,
    productId: firstParamValue(searchParams?.product_id)?.trim() || undefined,
    expenseCategoryId: firstParamValue(searchParams?.expense_category_id)?.trim() || undefined,
    dateTarget:
      (firstParamValue(searchParams?.date_target) as DepartmentViewerFilters["dateTarget"]) ||
      undefined,
    dateFrom: normalizeDate(firstParamValue(searchParams?.from)?.trim() || undefined),
    dateTo: normalizeDate(firstParamValue(searchParams?.to)?.trim() || undefined),
  };

  const result = await service.execute({
    userId: currentUserResult.user.id,
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
          <p className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">
            {getUserFriendlyErrorMessage(result.errorMessage, "claim-list")}
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
      <DepartmentClaimsTable claims={claims} />
    </>
  );
}

async function DeptFilterBarWithData({
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
      exportScope="department"
      defaultFiltersExpanded={defaultFiltersExpanded}
      paymentModes={paymentModesResult.data.map((m) => ({ id: m.id, name: m.name }))}
      departments={departmentsResult.data.map((d) => ({ id: d.id, name: d.name }))}
      locations={locationsResult.data.map((l) => ({ id: l.id, name: l.name }))}
      products={productsResult.data.map((p) => ({ id: p.id, name: p.name }))}
      expenseCategories={categoriesResult.data.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}

export function DepartmentClaimsSection({
  searchParams,
  pagination,
  defaultFiltersExpanded = false,
}: {
  searchParams?: Record<string, SearchParamsValue>;
  pagination: ClaimsPaginationState;
  defaultFiltersExpanded?: boolean;
}) {
  const sectionTitle = "Department Claims";

  return (
    <section className="space-y-3">
      <Suspense fallback={null}>
        <DeptFilterBarWithData defaultFiltersExpanded={defaultFiltersExpanded} />
      </Suspense>
      <div className="overflow-hidden rounded-xl border border-border bg-card transition-colors">
        <div className="hidden">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Department Overview — Assigned Claims
          </h2>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <DepartmentClaimsTableSection
            searchParams={searchParams}
            pagination={pagination}
            title={sectionTitle}
          />
        </Suspense>
      </div>
    </section>
  );
}
