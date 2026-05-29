import { Skeleton } from "@/components/ui/skeleton";

function SummaryStripSkeleton() {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <article
            key={`claim-summary-skeleton-${index}`}
            className="rounded-lg border border-border p-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-5 w-28" />
          </article>
        ))}
      </div>
    </section>
  );
}

function DetailSectionSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <Skeleton className="h-4 w-36" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={`claim-detail-field-${index}`} className="space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

function AuditTimelineSkeleton() {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`audit-item-skeleton-${index}`}
            className="grid gap-2 border-l border-border pl-3"
          >
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-4 w-52 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceViewerSkeleton() {
  return (
    <aside className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-3 p-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-[460px] w-full" />
      </div>
    </aside>
  );
}

export function ClaimDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 pb-16" aria-busy="true">
      <Skeleton className="h-8 w-24" />
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
      </section>
      <SummaryStripSkeleton />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <div className="space-y-4">
          <DetailSectionSkeleton rows={6} />
          <DetailSectionSkeleton rows={4} />
          <AuditTimelineSkeleton />
        </div>
        <EvidenceViewerSkeleton />
      </div>
    </div>
  );
}
