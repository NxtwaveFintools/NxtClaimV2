import { FilterToolbarSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/ui/table-skeleton";

export default function HodPendingLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-3 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeaderSkeleton actions={0} />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <FilterToolbarSkeleton fields={5} />
      <TableSkeleton rows={5} columns={8} showHeaderBar />
    </div>
  );
}
