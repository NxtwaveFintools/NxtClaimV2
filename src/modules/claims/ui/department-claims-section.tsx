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

type SearchParamsValue = string | string[] | undefined;

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

const PAGE_SIZE = 10;

async function DepartmentClaimsTableSection({
  searchParams,
}: {
  searchParams?: Record<string, SearchParamsValue>;
}) {
  const authRepository = new SupabaseServerAuthRepository();
  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const repository = new SupabaseDepartmentViewerRepository();
  const service = new GetDepartmentViewClaimsService({ repository, logger });

  const cursor = firstParamValue(searchParams?.cursor) ?? null;
  const previousCursor = firstParamValue(searchParams?.prevCursor) ?? null;
  const previousCursorToken = previousCursor ?? (cursor ? "__first__" : null);

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
    dateFrom: firstParamValue(searchParams?.from)?.trim() || undefined,
    dateTo: firstParamValue(searchParams?.to)?.trim() || undefined,
  };

  const result = await service.execute({
    userId: currentUserResult.user.id,
    filters,
    pagination: { cursor, limit: PAGE_SIZE },
  });

  if (result.errorMessage || !result.data) {
    return (
      <div className="px-4 py-6">
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          Unable to load claims. {result.errorMessage ?? "Unknown error"}
        </p>
      </div>
    );
  }

  const { data: rows, nextCursor, hasNextPage } = result.data;

  return (
    <>
      <DepartmentClaimsTable rows={rows} />
      <MyClaimsPaginationControls
        hasNextPage={hasNextPage}
        hasPreviousPage={Boolean(previousCursorToken)}
        currentCursor={cursor}
        nextCursor={nextCursor}
        previousCursor={previousCursorToken}
        searchParams={searchParams}
      />
    </>
  );
}

async function DeptFilterBarWithData() {
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
      defaultFiltersExpanded
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
}: {
  searchParams?: Record<string, SearchParamsValue>;
}) {
  return (
    <section className="space-y-4">
      <Suspense fallback={null}>
        <DeptFilterBarWithData />
      </Suspense>
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-300">
            Department Overview — Assigned Claims
          </h2>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <DepartmentClaimsTableSection searchParams={searchParams} />
        </Suspense>
      </div>
    </section>
  );
}
