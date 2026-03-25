type TableSkeletonProps = {
  rows?: number;
  columns?: number;
  showHeaderBar?: boolean;
};

const DEFAULT_ROWS = 8;
const DEFAULT_COLUMNS = 8;

function CellSkeleton({ widthClass }: { widthClass: string }) {
  return (
    <div
      className={`shimmer-sweep h-4 rounded-md bg-slate-200 dark:bg-gray-800/40 ${widthClass}`}
    />
  );
}

export function TableSkeleton({
  rows = DEFAULT_ROWS,
  columns = DEFAULT_COLUMNS,
  showHeaderBar = true,
}: TableSkeletonProps) {
  const columnWidths = ["w-20", "w-28", "w-36", "w-28", "w-32", "w-24", "w-32", "w-24"];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {showHeaderBar ? (
        <div className="border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
          <div className="shimmer-sweep h-4 w-40 rounded-md bg-slate-200 dark:bg-gray-800/40" />
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-zinc-800">
          <thead className="bg-slate-50 dark:bg-zinc-900/60">
            <tr>
              {Array.from({ length: columns }).map((_, index) => (
                <th key={`table-skeleton-head-${index}`} className="px-4 py-3">
                  <div className="shimmer-sweep h-3 rounded-md bg-slate-200 dark:bg-gray-800/40" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-zinc-900 dark:bg-zinc-950">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={`table-skeleton-row-${rowIndex}`}>
                {Array.from({ length: columns }).map((__, columnIndex) => (
                  <td key={`table-skeleton-cell-${rowIndex}-${columnIndex}`} className="px-4 py-3">
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
