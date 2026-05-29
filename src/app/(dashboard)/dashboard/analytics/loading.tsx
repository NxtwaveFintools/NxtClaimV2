import { FilterToolbarSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

function AnalyticsKpiSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={`analytics-loading-kpi-${index}`}
          className="rounded-xl border border-border bg-card p-4"
        >
          <Skeleton className="mb-3 h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

function AnalyticsChartsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-h-[320px] rounded-xl border border-border bg-card p-4">
          <Skeleton className="mb-3 h-5 w-44" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Skeleton className="h-[190px] w-[190px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={`analytics-loading-legend-${index}`} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="min-h-[320px] rounded-xl border border-border bg-card p-4">
          <Skeleton className="mb-3 h-5 w-36" />
          <div className="space-y-4 pt-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`analytics-loading-bar-${index}`}
                className="grid grid-cols-[120px_1fr] gap-3"
              >
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="grid grid-cols-3 gap-3 p-4">
          {Array.from({ length: 12 }).map((_, index) => (
            <Skeleton key={`analytics-loading-table-${index}`} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsLoading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton actions={0} />
      <FilterToolbarSkeleton fields={7} />
      <AnalyticsKpiSkeleton />
      <AnalyticsChartsSkeleton />
    </div>
  );
}
