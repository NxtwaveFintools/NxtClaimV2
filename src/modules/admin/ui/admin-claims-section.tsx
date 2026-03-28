import { Suspense } from "react";
import { logger } from "@/core/infra/logging/logger";
import { GetAdminClaimsService } from "@/core/domain/admin/GetAdminClaimsService";
import { SupabaseAdminRepository } from "@/modules/admin/repositories/SupabaseAdminRepository";
import { AdminClaimsTable } from "@/modules/admin/ui/admin-claims-table";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import type { DbClaimStatus } from "@/core/constants/statuses";
import type { AdminClaimsFilters } from "@/core/domain/admin/contracts";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";

type SearchParamsValue = string | string[] | undefined;

function firstParamValue(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toSearchParams(searchParams?: Record<string, SearchParamsValue>): URLSearchParams {
  const params = new URLSearchParams();
  if (!searchParams) return params;
  for (const [key, value] of Object.entries(searchParams)) {
    const normalized = firstParamValue(value);
    if (normalized) params.set(key, normalized);
  }
  return params;
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

async function AdminClaimsTableSection({
  searchParams,
}: {
  searchParams?: Record<string, SearchParamsValue>;
}) {
  const adminRepository = new SupabaseAdminRepository();
  const service = new GetAdminClaimsService({ repository: adminRepository, logger });

  const cursor = firstParamValue(searchParams?.cursor) ?? null;
  const previousCursor = firstParamValue(searchParams?.prevCursor) ?? null;
  const previousCursorToken = previousCursor ?? (cursor ? "__first__" : null);

  const filters: AdminClaimsFilters = {
    status: normalizeStatusFilter(firstParamValue(searchParams?.status)),
    departmentId: firstParamValue(searchParams?.department_id)?.trim() || undefined,
    searchQuery: firstParamValue(searchParams?.search_query)?.trim() || undefined,
  };

  const result = await service.execute({
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
      <AdminClaimsTable rows={rows} />
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

export function AdminClaimsSection({
  searchParams,
}: {
  searchParams?: Record<string, SearchParamsValue>;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-300">
          Admin Overview — All Claims
        </h2>
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <AdminClaimsTableSection searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
