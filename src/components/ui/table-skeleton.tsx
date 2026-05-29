import { Skeleton } from "@/components/ui/skeleton";

type TableSkeletonProps = {
  rows?: number;
  columns?: number;
  showHeaderBar?: boolean;
};

const DEFAULT_ROWS = 5;
const DEFAULT_COLUMNS = 8;

function CellSkeleton({ widthClass }: { widthClass: string }) {
  return <Skeleton className={`h-4 rounded-md ${widthClass}`} />;
}

export function TableSkeleton({
  rows = DEFAULT_ROWS,
  columns = DEFAULT_COLUMNS,
  showHeaderBar = true,
}: TableSkeletonProps) {
  const columnWidths = ["w-20", "w-28", "w-36", "w-28", "w-32", "w-24", "w-32", "w-24"];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-busy="true">
      {showHeaderBar ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-36" />
        </div>
      ) : null}

      <div className="nxt-scroll overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-background-secondary">
            <tr>
              {Array.from({ length: columns }).map((_, index) => (
                <th key={`table-skeleton-head-${index}`} className="px-3 py-2.5">
                  <Skeleton className="h-3 w-full" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={`table-skeleton-row-${rowIndex}`}>
                {Array.from({ length: columns }).map((__, columnIndex) => (
                  <td key={`table-skeleton-cell-${rowIndex}-${columnIndex}`} className="px-3 py-3">
                    <CellSkeleton widthClass={columnWidths[columnIndex] ?? "w-24"} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
