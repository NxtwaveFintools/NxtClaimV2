export function MyClaimsHeaderCardSkeleton() {
  return (
    <section className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-white/88 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.14),0_8px_24px_-8px_rgba(99,102,241,0.05)] backdrop-blur-lg transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/88 dark:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.40)]">
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="shimmer-sweep h-8 w-24 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-4 w-64 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          </div>
          <div className="flex items-center gap-2">
            <div className="shimmer-sweep h-9 w-32 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep h-9 w-28 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          </div>
        </div>
        <div className="mt-4 inline-flex flex-wrap rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-1 dark:border-zinc-700/60 dark:bg-zinc-900/60">
          <div className="shimmer-sweep h-9 w-28 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-9 w-32 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        </div>
      </div>
    </section>
  );
}
