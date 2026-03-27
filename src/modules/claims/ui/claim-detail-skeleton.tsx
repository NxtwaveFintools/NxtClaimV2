export function ClaimDetailSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-7xl space-y-5">
        <div className="h-10 w-24 animate-pulse rounded-md bg-muted/60" />

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="h-3 w-20 animate-pulse rounded-md bg-muted/60" />
              <div className="h-8 w-48 animate-pulse rounded-md bg-muted/60" />
              <div className="h-4 w-56 animate-pulse rounded-md bg-muted/60" />
            </div>
            <div className="h-7 w-32 animate-pulse rounded-md bg-muted/60" />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <article
                key={`claim-meta-row-1-${index}`}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
                <div className="mt-2 h-4 w-32 animate-pulse rounded-md bg-muted/60" />
              </article>
            ))}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <article
                key={`claim-meta-row-2-${index}`}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
                <div className="mt-2 h-4 w-36 animate-pulse rounded-md bg-muted/60" />
              </article>
            ))}
          </div>

          <section className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="h-4 w-32 animate-pulse rounded-md bg-muted/60" />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={`expense-placeholder-${index}`}
                  className="h-4 w-full animate-pulse rounded-md bg-muted/60"
                />
              ))}
            </div>
          </section>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
          <div className="h-4 w-36 animate-pulse rounded-md bg-muted/60" />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <article
                key={`evidence-placeholder-${index}`}
                className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
              >
                <div className="h-9 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
                  <div className="h-3 w-20 animate-pulse rounded-md bg-muted/60" />
                </div>
                <div className="p-2">
                  <div className="h-[460px] w-full animate-pulse rounded-lg bg-muted/60" />
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
