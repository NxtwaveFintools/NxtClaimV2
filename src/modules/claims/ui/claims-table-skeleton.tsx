type ClaimsTableSkeletonProps = {
  rows?: number;
};

const DEFAULT_ROWS = 8;

export function ClaimsTableSkeleton({ rows = DEFAULT_ROWS }: ClaimsTableSkeletonProps) {
  return (
    <div className="min-h-[600px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="h-4 w-36 animate-pulse rounded-md bg-muted/60" />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900/60">
            <tr>
              {Array.from({ length: 7 }).map((_, index) => (
                <th key={`skeleton-head-${index}`} className="px-4 py-3">
                  <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={`skeleton-row-${rowIndex}`}>
                <td className="px-4 py-3">
                  <div className="h-4 w-24 animate-pulse rounded-md bg-muted/60" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-40 animate-pulse rounded-md bg-muted/60" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-32 animate-pulse rounded-md bg-muted/60" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-28 animate-pulse rounded-md bg-muted/60" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-32 animate-pulse rounded-md bg-muted/60" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 w-28 animate-pulse rounded-md bg-muted/60" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-24 animate-pulse rounded-md bg-muted/60" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
