import { PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-400 space-y-6">
      <section className="rounded-xl border border-border bg-card p-5">
        <PageHeaderSkeleton actions={0} />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-card p-3">
          <Skeleton className="mb-4 h-4 w-36" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={`settings-nav-skeleton-${index}`} className="h-14 w-full" />
            ))}
          </div>
        </aside>
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-7 w-56" />
          </div>
          <div className="grid gap-3 p-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={`settings-panel-skeleton-${index}`} className="h-10 w-full" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
