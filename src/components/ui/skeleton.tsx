import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("shimmer-sweep rounded-lg bg-background-secondary", className)}
      {...props}
    />
  );
}

export function PageHeaderSkeleton({ actions = 2 }: { actions?: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex items-center gap-2">
        {Array.from({ length: actions }).map((_, index) => (
          <Skeleton key={`page-header-action-${index}`} className="h-9 w-28" />
        ))}
      </div>
    </div>
  );
}

export function FilterToolbarSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3" aria-busy="true">
      <div className="grid gap-2 md:grid-cols-5">
        {Array.from({ length: fields }).map((_, index) => (
          <div key={`filter-field-skeleton-${index}`} className="space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>
    </section>
  );
}

export function DashboardSummarySkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <section className="grid gap-4 md:grid-cols-3" aria-busy="true">
      {Array.from({ length: cards }).map((_, index) => (
        <article
          key={`summary-card-skeleton-${index}`}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8" />
          </div>
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-2 h-3 w-full" />
        </article>
      ))}
    </section>
  );
}

export function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background" aria-busy="true">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-border bg-card md:flex">
        <div className="flex h-12 items-center border-b border-border px-4">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="ml-2.5 h-4 w-24" />
        </div>
        <div className="flex-1 space-y-1 px-2 pt-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`shell-nav-skeleton-${index}`} className="h-9 w-full rounded-md" />
          ))}
        </div>
        <div className="flex h-16 items-center border-t border-border px-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="ml-2.5 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </aside>
      <main className="min-h-screen p-4 md:ml-[240px] md:p-8">{children}</main>
    </div>
  );
}
