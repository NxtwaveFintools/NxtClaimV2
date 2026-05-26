import { MyClaimsHeaderCardSkeleton } from "./_skeletons";

export default function MyClaimsLoading() {
  return (
    <div className="nxt-page-bg">
      {/* App shell header */}
      <div className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-zinc-200/60 bg-white/80 px-4 backdrop-blur-xl sm:px-6 dark:border-zinc-800/60 dark:bg-zinc-950/80">
        <div className="shimmer-sweep h-6 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        <div className="flex items-center gap-2">
          <div className="shimmer-sweep h-9 w-9 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-9 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        </div>
      </div>

      <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <main className="space-y-5">
          {/* Back button */}
          <div className="shimmer-sweep h-7 w-16 rounded-lg bg-zinc-200 dark:bg-gray-800/40" />

          <MyClaimsHeaderCardSkeleton />

          {/* Filter bar */}
          <section className="rounded-[28px] border border-zinc-200/80 bg-white/92 p-5 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
            <div className="grid gap-4 md:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="shimmer-sweep h-3 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                  <div className="shimmer-sweep h-10 w-full rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="shimmer-sweep h-10 w-28 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
              <div className="shimmer-sweep h-10 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
            </div>
          </section>

          {/* Table */}
          <section className="min-h-[600px] overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
            <div className="border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800">
              <div className="shimmer-sweep h-3 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            </div>
            <div className="space-y-3 p-5">
              {Array.from({ length: 11 }).map((_, i) => (
                <div
                  key={i}
                  className="shimmer-sweep h-4 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40"
                />
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
