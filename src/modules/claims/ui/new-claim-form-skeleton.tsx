import { Skeleton } from "@/components/ui/skeleton";

function FormSectionSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-[18px]">
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: fields }).map((_, index) => (
          <div key={`new-claim-field-${index}`} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-[38px] w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidencePanelSkeleton() {
  return (
    <aside className="grid w-full gap-4 rounded-xl border border-border bg-card p-4 lg:w-1/2">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3 w-56" />
      </div>
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={`evidence-upload-skeleton-${index}`}
          className="grid gap-2 rounded-lg border border-border bg-background-secondary p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
      <Skeleton className="h-9 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-[280px] w-full lg:h-[360px]" />
      </div>
    </aside>
  );
}

export function NewClaimFormSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true">
      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <div className="grid w-full min-w-0 gap-4 sm:gap-5 lg:w-1/2">
          <FormSectionSkeleton fields={7} />
          <FormSectionSkeleton fields={8} />
          <FormSectionSkeleton fields={6} />
          <FormSectionSkeleton fields={4} />
        </div>
        <EvidencePanelSkeleton />
      </div>
      <div className="fixed bottom-0 left-0 right-0 z-20 flex h-[60px] items-center justify-end border-t border-border bg-card/95 px-6">
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  );
}
