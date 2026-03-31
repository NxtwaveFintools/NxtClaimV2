export default function NewClaimLoading() {
  return (
    <div className="nxt-page-bg">
      {/* Header placeholder */}
      <div className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-zinc-200/60 bg-white/80 px-4 backdrop-blur-xl sm:px-6 dark:border-zinc-800/60 dark:bg-zinc-950/80">
        <div className="shimmer-sweep h-6 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        <div className="flex items-center gap-2">
          <div className="shimmer-sweep h-9 w-9 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-9 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        </div>
      </div>

      <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-10">
        {/* Back button skeleton */}
        <div className="shimmer-sweep mb-5 h-9 w-24 rounded-xl bg-indigo-100/80 dark:bg-indigo-900/20" />

        {/* Page title skeleton */}
        <div className="mb-8 space-y-3">
          <div className="shimmer-sweep h-3 w-24 rounded-md bg-indigo-200/60 dark:bg-indigo-800/30" />
          <div className="shimmer-sweep h-10 w-48 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-4 w-80 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        </div>

        {/* Form card skeleton */}
        <div className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-white/88 shadow-[0_32px_80px_-24px_rgba(15,23,42,0.16)] backdrop-blur-lg dark:border-zinc-800/80 dark:bg-zinc-900/88 dark:shadow-[0_32px_80px_-24px_rgba(0,0,0,0.40)]">
          {/* Top stripe */}
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="space-y-6">
              {Array.from({ length: 3 }).map((_, sectionIndex) => (
                <section
                  key={`form-section-${sectionIndex}`}
                  className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/80 p-5 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-black/10"
                >
                  <div className="shimmer-sweep h-5 w-40 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, fieldIndex) => (
                      <div key={`field-${sectionIndex}-${fieldIndex}`} className="space-y-2">
                        <div className="shimmer-sweep h-3 w-28 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                        <div className="shimmer-sweep h-10 w-full rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              <div className="shimmer-sweep h-12 w-40 rounded-xl bg-indigo-200/60 dark:bg-indigo-800/30" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
