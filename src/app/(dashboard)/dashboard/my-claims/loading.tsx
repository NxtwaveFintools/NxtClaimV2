import { TableSkeleton } from "@/components/ui/table-skeleton";

function HeaderSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="shimmer-sweep h-8 w-44 rounded-md bg-slate-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-4 w-72 rounded-md bg-slate-200 dark:bg-gray-800/40" />
        </div>
        <div className="flex items-center gap-2">
          <div className="shimmer-sweep h-9 w-44 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-9 w-9 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-9 w-28 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
        </div>
      </div>

      <div className="mt-4 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60">
        <div className="shimmer-sweep h-8 w-36 rounded-lg bg-slate-200 dark:bg-gray-800/40" />
        <div className="shimmer-sweep ml-1 h-8 w-36 rounded-lg bg-slate-200 dark:bg-gray-800/40" />
      </div>
    </section>
  );
}

function FilterSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
      <div className="grid gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`filter-placeholder-${index}`} className="space-y-1">
            <div className="shimmer-sweep h-3 w-20 rounded-md bg-slate-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-9 w-full rounded-lg bg-slate-200 dark:bg-gray-800/40" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="shimmer-sweep h-9 w-24 rounded-lg bg-slate-200 dark:bg-gray-800/40" />
        <div className="shimmer-sweep h-9 w-20 rounded-lg bg-slate-200 dark:bg-gray-800/40" />
      </div>
    </section>
  );
}

export default function MyClaimsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <HeaderSkeleton />
        <FilterSkeleton />
        <TableSkeleton rows={10} columns={8} />
      </main>
    </div>
  );
}
