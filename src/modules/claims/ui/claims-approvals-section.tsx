import dynamic from "next/dynamic";
import { Suspense } from "react";
import { FilterToolbarSkeleton } from "@/components/ui/skeleton";
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
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

type SearchParamsValue = string | string[] | undefined;

const PAGE_SIZE = 5;

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
  return <FilterToolbarSkeleton fields={5} />;
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
  const tableLabel =
    dataMode === "finance_hod_pending"
      ? "HOD PENDING CLAIMS"
      : approvalScope === "finance"
        ? "Finance Queue"
        : "Approvals History";

  return (
    <>
      <Suspense fallback={<FilterBarSkeleton />}>
        <ApprovalsFilterBarWithData
          exportScope={exportScope}
          defaultFiltersExpanded={defaultFiltersExpanded ?? false}
          showAdvancedFilters={showAdvancedFilters ?? viewerContext.activeScope === "finance"}
          storageScope={storageScope}
          lockedStatus={lockedStatus}
          statusFilterMode={statusFilterMode}
        />
      </Suspense>

      <h2 className="sr-only" aria-label={tableLabel}>
        {tableLabel}
      </h2>

      <section className="overflow-hidden rounded-xl border border-border bg-card transition-colors">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {tableLabel}
          </h2>
          {approvalsResult.errorMessage || rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{approvalsSummaryText}</p>
          ) : (
            <MyClaimsPaginationControls
              hasNextPage={approvalsResult.hasNextPage}
              currentCursor={cursor}
              nextCursor={approvalsResult.nextCursor}
              prevCursor={previousCursorToken}
              summaryText={approvalsSummaryText}
              position="inline"
              searchParams={searchParams}
            />
          )}
        </div>
        {approvalsResult.errorMessage ? (
          <div className="px-4 py-6">
            <p className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">
              {getUserFriendlyErrorMessage(approvalsResult.errorMessage, "claim-list")}
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center px-4 py-14 text-center">
            <p className="text-sm font-medium text-foreground">
              {dataMode === "finance_hod_pending"
                ? "No HOD pending claims found"
                : "No approvals history found."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {dataMode === "finance_hod_pending"
                ? "Claims awaiting L1 approval will appear here."
                : "Claims routed to your approval scope will appear here."}
            </p>
          </div>
        ) : approvalScope === "finance" || approvalScope === "l1" ? (
          <>
            <Suspense
              key={JSON.stringify(searchParams)}
              fallback={<TableSkeleton rows={5} columns={readOnly ? 8 : 9} showHeaderBar={false} />}
            >
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
            <p className="text-sm font-medium text-foreground">No approvals history found.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Claims routed to your approval scope will appear here.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
