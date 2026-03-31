function DashboardLoadingShell() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-slate-950/90">
        <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="shimmer-sweep h-11 w-11 rounded-2xl bg-zinc-200 dark:bg-gray-800/40" />
            <div className="space-y-2">
              <div className="shimmer-sweep h-3 w-24 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
              <div className="shimmer-sweep h-5 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="shimmer-sweep h-10 w-44 rounded-2xl bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-10 w-10 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-10 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="hidden lg:block lg:w-72">
          <div className="flex h-[calc(100vh-7rem)] flex-col rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`nav-skeleton-${index}`}
                  className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex items-start gap-3">
                    <div className="shimmer-sweep h-9 w-9 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="shimmer-sweep h-4 w-28 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                      <div className="shimmer-sweep h-3 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-6">
          <section className="overflow-hidden rounded-[30px] border border-zinc-200/80 bg-white/90 p-6 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.35)] dark:border-zinc-800 dark:bg-zinc-900/90">
            <div className="space-y-6 p-2 sm:p-4">
              <div className="space-y-3">
                <div className="shimmer-sweep h-12 w-[32rem] max-w-full rounded-md bg-zinc-200 dark:bg-gray-800/40" />
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="shimmer-sweep h-10 w-60 rounded-2xl bg-zinc-200 dark:bg-gray-800/40" />
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="shimmer-sweep h-11 w-32 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep h-11 w-32 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep h-11 w-40 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-zinc-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.34)] dark:border-zinc-800 dark:bg-zinc-900/90">
            <div className="shimmer-sweep h-8 w-56 rounded-md bg-zinc-200 dark:bg-gray-800/40" />

            <div className="mt-6 grid gap-4 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <article
                  key={`wallet-skeleton-${index}`}
                  className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="shimmer-sweep h-3 w-28 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                      <div className="shimmer-sweep h-10 w-36 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                    </div>
                    <div className="shimmer-sweep h-11 w-11 rounded-2xl bg-zinc-200 dark:bg-gray-800/40" />
                  </div>
                  <div className="shimmer-sweep mt-4 h-4 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                  <div className="shimmer-sweep mt-2 h-4 w-4/5 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  return <DashboardLoadingShell />;
}
