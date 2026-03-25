function DashboardSegmentLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="shimmer-sweep h-8 w-44 rounded-md bg-slate-200 dark:bg-gray-800/40" />
              <div className="shimmer-sweep h-4 w-64 rounded-md bg-slate-200 dark:bg-gray-800/40" />
            </div>
            <div className="flex items-center gap-2">
              <div className="shimmer-sweep h-9 w-44 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
              <div className="shimmer-sweep h-9 w-9 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
              <div className="shimmer-sweep h-9 w-28 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="shimmer-sweep h-4 w-32 rounded-md bg-slate-200 dark:bg-gray-800/40" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <article
                key={`summary-skeleton-${index}`}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="shimmer-sweep h-3 w-20 rounded-md bg-slate-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep mt-2 h-7 w-24 rounded-md bg-slate-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep mt-2 h-3 w-full rounded-md bg-slate-200 dark:bg-gray-800/40" />
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="shimmer-sweep h-4 w-24 rounded-md bg-slate-200 dark:bg-gray-800/40" />
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="shimmer-sweep h-10 w-28 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-10 w-28 rounded-xl bg-slate-200 dark:bg-gray-800/40" />
          </div>
        </section>
      </main>
    </div>
  );
}

export default function DashboardLoading() {
  return <DashboardSegmentLoading />;
}
