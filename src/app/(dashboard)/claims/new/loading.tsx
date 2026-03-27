export default function NewClaimLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 h-10 w-24 animate-pulse rounded-md bg-muted/60" />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded-md bg-muted/60" />
            <div className="h-8 w-40 animate-pulse rounded-md bg-muted/60" />
            <div className="h-4 w-80 animate-pulse rounded-md bg-muted/60" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-44 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-9 w-9 animate-pulse rounded-xl bg-muted/60" />
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {Array.from({ length: 3 }).map((_, sectionIndex) => (
            <section
              key={`form-section-${sectionIndex}`}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="h-4 w-40 animate-pulse rounded-md bg-muted/60" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, fieldIndex) => (
                  <div key={`field-${sectionIndex}-${fieldIndex}`} className="space-y-1">
                    <div className="h-3 w-28 animate-pulse rounded-md bg-muted/60" />
                    <div className="h-10 w-full animate-pulse rounded-md bg-muted/60" />
                  </div>
                ))}
              </div>
            </section>
          ))}

          <div className="h-11 w-36 animate-pulse rounded-xl bg-muted/60" />
        </div>
      </main>
    </div>
  );
}
