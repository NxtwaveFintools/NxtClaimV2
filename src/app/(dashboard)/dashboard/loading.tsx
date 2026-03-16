function DashboardSegmentLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="h-8 w-44 animate-pulse rounded-md bg-muted/60" />
              <div className="h-4 w-64 animate-pulse rounded-md bg-muted/60" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-9 w-44 animate-pulse rounded-xl bg-muted/60" />
              <div className="h-9 w-9 animate-pulse rounded-xl bg-muted/60" />
              <div className="h-9 w-28 animate-pulse rounded-xl bg-muted/60" />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="h-4 w-32 animate-pulse rounded-md bg-muted/60" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <article
                key={`summary-skeleton-${index}`}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="h-3 w-20 animate-pulse rounded-md bg-muted/60" />
                <div className="mt-2 h-7 w-24 animate-pulse rounded-md bg-muted/60" />
                <div className="mt-2 h-3 w-full animate-pulse rounded-md bg-muted/60" />
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-zinc-950">
          <div className="h-4 w-24 animate-pulse rounded-md bg-muted/60" />
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="h-10 w-28 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-10 w-28 animate-pulse rounded-xl bg-muted/60" />
          </div>
        </section>
      </main>
    </div>
  );
}

export default function DashboardLoading() {
  return <DashboardSegmentLoading />;
}
