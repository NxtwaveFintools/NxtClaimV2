function DashboardLoadingShell() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-6 py-10 dark:from-[#0B0F1A] dark:via-[#111827] dark:to-[#0B0F1A]">
      <main className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 transition-colors dark:border-slate-800 dark:bg-zinc-950 dark:shadow-black/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
            <div className="h-8 w-52 animate-pulse rounded-md bg-muted/60" />
            <div className="h-4 w-72 animate-pulse rounded-md bg-muted/60" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-44 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-9 w-24 animate-pulse rounded-xl bg-muted/60" />
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors dark:border-slate-800 dark:bg-slate-900/70">
          <div className="h-4 w-44 animate-pulse rounded-md bg-muted/60" />
          <div className="mt-2 h-4 w-full animate-pulse rounded-md bg-muted/60" />
        </div>

        <section className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 transition-colors dark:border-slate-800 dark:bg-slate-900/70">
          <div className="h-4 w-32 animate-pulse rounded-md bg-muted/60" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <article
                key={`wallet-skeleton-${index}`}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-zinc-950"
              >
                <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
                <div className="mt-2 h-8 w-32 animate-pulse rounded-md bg-muted/60" />
                <div className="mt-2 h-3 w-full animate-pulse rounded-md bg-muted/60" />
              </article>
            ))}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <div className="h-10 w-28 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-10 w-28 animate-pulse rounded-xl bg-muted/60" />
        </div>
      </main>
    </div>
  );
}

export default function DashboardLoading() {
  return <DashboardLoadingShell />;
}
