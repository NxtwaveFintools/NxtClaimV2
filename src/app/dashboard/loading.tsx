function DashboardLoadingShell() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-zinc-100 px-6 py-10 dark:from-[#0B0F1A] dark:via-[#111827] dark:to-[#0B0F1A]">
      <main className="mx-auto max-w-3xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-900/5 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="shimmer-sweep h-3 w-24 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-8 w-52 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-4 w-72 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          </div>
          <div className="flex items-center gap-2">
            <div className="shimmer-sweep h-9 w-44 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-9 w-9 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-9 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 p-4 transition-colors dark:border-zinc-800 dark:bg-zinc-900/70">
          <div className="shimmer-sweep h-4 w-44 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep mt-2 h-4 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        </div>

        <section className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 p-4 transition-colors dark:border-zinc-800 dark:bg-zinc-900/70">
          <div className="shimmer-sweep h-4 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <article
                key={`wallet-skeleton-${index}`}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="shimmer-sweep h-3 w-24 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep mt-2 h-8 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep mt-2 h-3 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40" />
              </article>
            ))}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <div className="shimmer-sweep h-10 w-28 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-10 w-28 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        </div>
      </main>
    </div>
  );
}

export default function DashboardLoading() {
  return <DashboardLoadingShell />;
}
