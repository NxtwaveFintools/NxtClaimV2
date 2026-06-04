import Link from "next/link";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import type { ClaimStatus, DbClaimStatus } from "@/core/constants/statuses";
import { ROUTES } from "@/core/config/route-registry";
import { Skeleton as BaseSkeleton } from "@/components/ui/skeleton";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import { formatDate } from "@/lib/format";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

export type RecentClaimRecord = {
  id: string;
  claimId: string;
  date: string;
  category: string;
  amount: number;
  status: ClaimStatus | DbClaimStatus;
};

type RecentClaimsProps = {
  claims: RecentClaimRecord[];
  errorMessage?: string | null;
  loading?: boolean;
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--muted-foreground)",
} as const;

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatInr(value: number): string {
  return inrFormatter.format(value);
}

function Skeleton({ className }: { className: string }) {
  return <BaseSkeleton className={className} />;
}

export function RecentClaimsSkeleton() {
  return (
    <section>
      <h2 style={{ ...labelStyle, marginBottom: 12 }}>RECENT CLAIMS</h2>

      <div className="nxt-card overflow-hidden" style={{ borderRadius: 12 }}>
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-[960px] w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[12%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead>
              <tr
                className="border-b border-border"
                style={{ backgroundColor: "var(--background-secondary)" }}
              >
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Claim ID
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Date
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Category
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Amount
                </th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, index) => (
                <tr key={`skeleton-row-${index}`} className="h-14 border-b border-border">
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-[90%]" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-[80%]" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-[80%]" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-4 w-[70%]" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Skeleton className="mx-auto h-7 w-[85%] rounded-full" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-8 w-[70%] rounded-lg" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={`skeleton-mobile-${index}`} className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={`skeleton-row-${index}`} className="h-14 border-b border-border">
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-[90%]" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-[80%]" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-[80%]" />
          </td>
          <td className="px-4 py-3 text-right">
            <Skeleton className="ml-auto h-4 w-[70%]" />
          </td>
          <td className="px-4 py-3 text-center">
            <Skeleton className="mx-auto h-7 w-[85%] rounded-full" />
          </td>
          <td className="px-4 py-3 text-right">
            <Skeleton className="ml-auto h-8 w-[70%] rounded-lg" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function RecentClaims({ claims, errorMessage = null, loading = false }: RecentClaimsProps) {
  return (
    <section>
      <h2 style={{ ...labelStyle, marginBottom: 12 }}>RECENT CLAIMS</h2>

      <div className="nxt-card overflow-hidden" style={{ borderRadius: 12 }}>
        {errorMessage ? (
          <p className="border-b border-border bg-danger-muted px-4 py-3 text-sm text-danger">
            {getUserFriendlyErrorMessage(errorMessage, "claim-list")}
          </p>
        ) : null}

        {loading ? (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-[960px] w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead>
                  <tr
                    className="border-b border-border"
                    style={{ backgroundColor: "var(--background-secondary)" }}
                  >
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Claim ID
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Date
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Category
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Amount
                    </th>
                    <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows />
                </tbody>
              </table>
            </div>
            <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={`skeleton-mobile-${index}`} className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : claims.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
              No recent claims
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
              Submitted claims will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-[960px] w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead>
                  <tr
                    className="border-b border-border"
                    style={{ backgroundColor: "var(--background-secondary)" }}
                  >
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Claim ID
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Date
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Category
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Amount
                    </th>
                    <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr
                      key={claim.id}
                      className="h-14 border-b border-border transition-colors hover:bg-background-secondary"
                    >
                      <td className="truncate whitespace-nowrap overflow-hidden px-4 py-3 text-left font-medium text-foreground">
                        <Link
                          href={ROUTES.claims.detail(claim.id)}
                          title={claim.claimId}
                          className="truncate hover:underline text-accent"
                        >
                          {claim.claimId}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-left text-muted-foreground">
                        {formatDate(claim.date)}
                      </td>
                      <td
                        className="truncate whitespace-nowrap overflow-hidden px-4 py-3 text-left text-foreground"
                        title={claim.category}
                      >
                        {claim.category}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                        {formatInr(claim.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ClaimStatusBadge status={claim.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={ROUTES.claims.detail(claim.id)}
                          className="inline-flex h-8 items-center gap-1 text-sm font-medium hover:underline text-accent"
                        >
                          View
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
              {claims.map((claim) => (
                <div key={claim.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={ROUTES.claims.detail(claim.id)}
                      className="min-w-0 break-words text-sm font-semibold hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {claim.claimId}
                    </Link>
                    <div className="shrink-0">
                      <ClaimStatusBadge status={claim.status} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Category</p>
                      <p className="break-words text-foreground">{claim.category}</p>
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="text-xs text-muted-foreground">Amount</p>
                      <p className="break-words font-semibold text-foreground">
                        {formatInr(claim.amount)}
                      </p>
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-between gap-3 text-xs"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    <span className="min-w-0">{formatDate(claim.date)}</span>
                    <Link
                      href={ROUTES.claims.detail(claim.id)}
                      className="inline-flex h-8 shrink-0 items-center gap-0.5 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      View details
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
