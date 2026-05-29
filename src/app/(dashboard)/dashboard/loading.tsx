import { DashboardSummarySkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

function DashboardSegmentLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeaderSkeleton actions={2} />
      <DashboardSummarySkeleton cards={3} />
      <section className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-4 w-24" />
        <div className="mt-4 flex flex-wrap gap-3">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </section>
    </div>
  );
}

export default function DashboardLoading() {
  return <DashboardSegmentLoading />;
}
