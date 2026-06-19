import dynamic from "next/dynamic";
import { Suspense } from "react";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { type DbClaimStatus } from "@/core/constants/statuses";
import type { GetMyClaimsFilters } from "@/core/domain/claims/contracts";
import {
  GetPendingApprovalsService,
  type PendingApprovalsViewerContext,
} from "@/core/domain/claims/GetPendingApprovalsService";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { type ClaimsFilterBarExportScope } from "@/modules/claims/ui/claims-filter-bar";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";

type SearchParamsValue = string | string[] | undefined;

const PAGE_SIZE = 10;

const ClaimsFilterBar = dynamic(
  () => import("@/modules/claims/ui/claims-filter-bar").then((module) => module.ClaimsFilterBar),
  {
    loading: () => <FilterBarSkeleton />,
  },
);

const FinanceApprovalsBulkTable = dynamic(
  () =>
    import("@/modules/claims/ui/finance-approvals-bulk-table").then(
      (module) => module.FinanceApprovalsBulkTable,
    ),
  {
    loading: () => <TableSkeleton />,
  },
);

function firstParamValue(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function FilterBarSkeleton() {
  return (
    <section className="rounded-[28px] border border-zinc-200/80 bg-white/92 p-5 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
      <div className="grid gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`filter-placeholder-${index}`} className="space-y-2">
            <div className="shimmer-sweep h-3 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-10 w-full rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="shimmer-sweep h-10 w-28 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        <div className="shimmer-sweep h-10 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
      </div>
    </section>
  );
}

async function ApprovalsFilterBarWithData({
  exportScope,
  defaultFiltersExpanded,
  showAdvancedFilters,
  storageScope,
  lockedStatus,
  statusFilterMode,
}: {
  exportScope: ClaimsFilterBarExportScope;
  defaultFiltersExpanded: boolean;
  showAdvancedFilters?: boolean;
  storageScope?: string;
  lockedStatus?: DbClaimStatus;
  statusFilterMode?: "visible" | "disabled" | "hidden";
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

  const paymentModes = paymentModesResult.data.map((mode) => ({ id: mode.id, name: mode.name }));
  const departments = departmentsResult.data.map((department) => ({
    id: department.id,
    name: department.name,
  }));
  const locations = locationsResult.data.map((location) => ({
    id: location.id,
    name: location.name,
  }));
  const products = productsResult.data.map((product) => ({ id: product.id, name: product.name }));
  const expenseCategories = categoriesResult.data.map((category) => ({
    id: category.id,
    name: category.name,
  }));

  return (
    <ClaimsFilterBar
      exportScope={exportScope}
      defaultFiltersExpanded={defaultFiltersExpanded}
      isAdmin={showAdvancedFilters === true}
      storageScope={storageScope}
      lockedStatus={lockedStatus}
      statusFilterMode={statusFilterMode}
      paymentModes={paymentModes}
      departments={departments}
      locations={locations}
      products={products}
      expenseCategories={expenseCategories}
    />
  );
}

export async function ClaimsApprovalsSection({
  userId,
  viewerContext,
  searchParams,
  filters,
  exportScope = "approvals",
  defaultFiltersExpanded,
  showAdvancedFilters,
  storageScope,
  lockedStatus,
  statusFilterMode,
  readOnly = false,
  dataMode = "default",
}: {
  userId: string;
  viewerContext: PendingApprovalsViewerContext;
  searchParams: Record<string, SearchParamsValue>;
  filters: GetMyClaimsFilters;
  exportScope?: ClaimsFilterBarExportScope;
  defaultFiltersExpanded?: boolean;
  showAdvancedFilters?: boolean;
  storageScope?: string;
  lockedStatus?: DbClaimStatus;
  statusFilterMode?: "visible" | "disabled" | "hidden";
  readOnly?: boolean;
  dataMode?: "default" | "finance_hod_pending";
}) {
  const claimRepository = new SupabaseClaimRepository();
  const pendingApprovalsService = new GetPendingApprovalsService({
    repository: claimRepository,
    logger,
  });
  const cursor = firstParamValue(searchParams.cursor) ?? null;
  const previousCursor = firstParamValue(searchParams.prevCursor) ?? null;
  const previousCursorToken = previousCursor ?? (cursor ? "__first__" : null);
  const approvalScope = viewerContext.activeScope;

  const approvalsResult =
    dataMode === "finance_hod_pending"
      ? await pendingApprovalsService.executeFinanceHodPendingObservability({
          userId,
          cursor,
          limit: PAGE_SIZE,
          filters,
          viewerContext,
        })
      : await pendingApprovalsService.execute({
          userId,
          cursor,
          limit: PAGE_SIZE,
          filters,
          viewerContext,
        });

  const rows = Array.from(new Map(approvalsResult.data.map((claim) => [claim.id, claim])).values());
  const approvalsSummaryText = `Showing ${rows.length} of ${approvalsResult.totalCount} claims`;

  return (
    <>
      <Suspense fallback={<FilterBarSkeleton />}>
        <ApprovalsFilterBarWithData
          exportScope={exportScope}
          defaultFiltersExpanded={defaultFiltersExpanded ?? viewerContext.activeScope !== null}
          showAdvancedFilters={showAdvancedFilters ?? viewerContext.activeScope === "finance"}
          storageScope={storageScope}
          lockedStatus={lockedStatus}
          statusFilterMode={statusFilterMode}
        />
      </Suspense>

      <h2 className="sr-only" aria-label="Approvals History">
        Approvals History
      </h2>

      <section className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
        {approvalsResult.errorMessage ? (
          <div className="px-4 py-6">
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              Unable to load approvals history. {approvalsResult.errorMessage}
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center px-4 py-14 text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No approvals history found.
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Claims routed to your approval scope will appear here.
            </p>
          </div>
        ) : approvalScope === "finance" || approvalScope === "l1" ? (
          <>
            <MyClaimsPaginationControls
              hasNextPage={approvalsResult.hasNextPage}
              currentCursor={cursor}
              nextCursor={approvalsResult.nextCursor}
              prevCursor={previousCursorToken}
              summaryText={approvalsSummaryText}
              position="top"
              searchParams={searchParams}
            />

            <Suspense key={JSON.stringify(searchParams)} fallback={<TableSkeleton />}>
              <FinanceApprovalsBulkTable
                claims={rows.map((claim) => ({
                  id: claim.id,
                  employeeId: claim.employeeId,
                  submitter: claim.submitter,
                  submitterEmail: claim.submitterEmail,
                  departmentName: claim.departmentName,
                  paymentModeName: claim.paymentModeName,
                  detailType: claim.detailType,
                  submissionType: claim.submissionType,
                  onBehalfEmail: claim.onBehalfEmail,
                  onBehalfEmployeeCode: claim.onBehalfEmployeeCode,
                  purpose: claim.purpose,
                  categoryName: claim.categoryName,
                  expenseReceiptFilePath: claim.expenseReceiptFilePath,
                  expenseBankStatementFilePath: claim.expenseBankStatementFilePath,
                  advanceSupportingDocumentPath: claim.advanceSupportingDocumentPath,
                  formattedTotalAmount: claim.formattedTotalAmount,
                  status: claim.status,
                  formattedSubmittedAt: claim.formattedSubmittedAt,
                  formattedHodActionDate: claim.formattedHodActionDate,
                  formattedFinanceActionDate: claim.formattedFinanceActionDate,
                }))}
                actionableIds={rows
                  .filter((row) => {
                    if (readOnly) {
                      return false;
                    }

                    if (approvalScope === "l1") {
                      return row.status === "Submitted - Awaiting HOD approval";
                    }

                    return (
                      row.status === "HOD approved - Awaiting finance approval" ||
                      row.status === "Finance Approved - Payment under process"
                    );
                  })
                  .map((row) => row.id)}
                totalSelectableCount={
                  approvalsResult.totalCount > 0 ? approvalsResult.totalCount : rows.length
                }
                filters={filters}
                approvalScope={approvalScope}
                readOnly={readOnly}
              />
            </Suspense>
          </>
        ) : (
          <div className="grid place-items-center px-4 py-14 text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No approvals history found.
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Claims routed to your approval scope will appear here.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
