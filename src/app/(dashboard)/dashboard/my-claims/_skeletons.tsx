import { Skeleton } from "@/components/ui/skeleton";

function ClaimsTableRowSkeleton({ index }: { index: number }) {
  return (
    <tr>
      <td className="px-3 py-2.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-1.5 h-3 w-16" />
      </td>
      <td className="px-3 py-2.5">
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="mt-1.5 h-3 w-28 max-w-full" />
      </td>
      <td className="px-3 py-2.5">
        <Skeleton className="h-4 w-20 max-w-full" />
      </td>
      <td className="px-3 py-2.5">
        <Skeleton className="h-4 w-24 max-w-full" />
      </td>
      <td className="px-3 py-2.5">
        <Skeleton className="ml-auto h-4 w-20" />
      </td>
      <td className="px-3 py-2.5">
        <Skeleton className="mx-auto h-7 w-full max-w-36 rounded-full" />
      </td>
      <td className="px-3 py-2.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-1.5 h-3 w-24" />
        <Skeleton className="mt-1 h-3 w-28" />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex justify-end gap-1.5">
          <Skeleton className="h-8 w-12" />
          {index === 0 ? <Skeleton className="h-8 w-8" /> : null}
        </div>
      </td>
    </tr>
  );
}

function ClaimsMobileRowSkeleton({ index }: { index: number }) {
  return (
    <article className="space-y-3 border-b border-border p-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-4 w-36 max-w-full" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-7 w-28 shrink-0 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-24 justify-self-end" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20 justify-self-end" />
      </div>
      <div className="flex justify-end gap-1.5">
        <Skeleton className="h-8 w-12" />
        {index === 0 ? <Skeleton className="h-8 w-8" /> : null}
      </div>
    </article>
  );
}

export function MyClaimsHeaderSkeleton() {
  return (
    <section className="space-y-3" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        <Skeleton className="h-[34px] w-28" />
        <Skeleton className="h-[34px] w-28" />
        <Skeleton className="h-[34px] w-24" />
        <Skeleton className="h-[34px] w-28" />
      </div>
    </section>
  );
}

export function MyClaimsFilterSkeleton() {
  return (
    <section className="relative rounded-xl border border-border bg-card p-3" aria-busy="true">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-[1fr_1.5fr_1fr_145px_145px]">
        {["w-24", "w-12", "w-12", "w-10", "w-6"].map((labelWidth, index) => (
          <div key={`claims-filter-field-${index}`} className="grid gap-1">
            <Skeleton className={`h-3 ${labelWidth}`} />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
    </section>
  );
}

export function MyClaimsTableSkeleton() {
  const columns = [
    "CLAIM",
    "SUBMITTER / BENEFICIARY",
    "DEPARTMENT",
    "TYPE",
    "AMOUNT",
    "STATUS",
    "SUBMITTED",
    "ACTIONS",
  ];

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card transition-colors"
      aria-busy="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <Skeleton className="h-3 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="hidden h-3 w-32 sm:block" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed divide-y divide-border text-left text-sm">
          <colgroup>
            <col className="w-[21%]" />
            <col className="w-[19%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[15%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="bg-background-secondary text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={`claims-table-skeleton-header-${column}`}
                  className={`whitespace-nowrap px-3 py-2.5 font-semibold ${
                    column === "AMOUNT" || column === "ACTIONS" ? "text-right" : ""
                  } ${column === "STATUS" ? "text-center" : ""}`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {Array.from({ length: 5 }).map((_, index) => (
              <ClaimsTableRowSkeleton key={`claims-table-skeleton-row-${index}`} index={index} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border md:hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <ClaimsMobileRowSkeleton key={`claims-mobile-skeleton-row-${index}`} index={index} />
        ))}
      </div>
    </section>
  );
}

export function MyClaimsContentSkeleton() {
  return (
    <div className="space-y-3">
      <MyClaimsFilterSkeleton />
      <MyClaimsTableSkeleton />
    </div>
  );
}

export function MyClaimsPageSkeleton() {
  return (
    <div className="space-y-3">
      <MyClaimsHeaderSkeleton />
      <MyClaimsContentSkeleton />
    </div>
  );
}
