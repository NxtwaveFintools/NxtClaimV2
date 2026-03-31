type TableSkeletonProps = {
  rows?: number;
  columns?: number;
  showHeaderBar?: boolean;
};

const DEFAULT_ROWS = 8;
const DEFAULT_COLUMNS = 8;

function CellSkeleton({ widthClass }: { widthClass: string }) {
  return (
    <div className={`shimmer-sweep h-4 rounded-md bg-zinc-200 dark:bg-gray-800/40 ${widthClass}`} />
  );
}

export function TableSkeleton({
  rows = DEFAULT_ROWS,
  columns = DEFAULT_COLUMNS,
  showHeaderBar = true,
}: TableSkeletonProps) {
  const columnWidths = ["w-20", "w-28", "w-36", "w-28", "w-32", "w-24", "w-32", "w-24"];

  return (
    <div className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
      {showHeaderBar ? (
        <div className="border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800">
          <div className="shimmer-sweep h-4 w-40 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        </div>
      ) : null}

      <div className="nxt-scroll overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200/80 dark:divide-zinc-800">
          <thead className="bg-zinc-50/80 dark:bg-zinc-900/60">
            <tr>
              {Array.from({ length: columns }).map((_, index) => (
                <th key={`table-skeleton-head-${index}`} className="px-5 py-3.5">
                  <div className="shimmer-sweep h-3 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100/80 bg-white/50 dark:divide-zinc-800 dark:bg-zinc-900/50">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={`table-skeleton-row-${rowIndex}`}>
                {Array.from({ length: columns }).map((__, columnIndex) => (
                  <td
                    key={`table-skeleton-cell-${rowIndex}-${columnIndex}`}
                    className="px-5 py-3.5"
                  >
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
