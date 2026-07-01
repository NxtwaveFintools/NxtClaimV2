"use client";

import { ROUTES } from "@/core/config/route-registry";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { RouterLink } from "@/components/ui/router-link";
import { TableEmptyState } from "@/components/ui/table-empty-state";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import type { DepartmentViewerClaimRecord } from "@/core/domain/claims/contracts";
import { formatDate, formatCurrency } from "@/lib/format";
import { appendReturnToParam, buildPathWithSearchParams } from "@/lib/pagination-helpers";

type Props = {
  claims: DepartmentViewerClaimRecord[];
};

export function DepartmentClaimsTable({ claims }: Props) {
  if (claims.length === 0) {
    return (
      <TableEmptyState title="No claims found" description="Adjust filters or check back later." />
    );
  }

  return (
    <div className="nxt-scroll w-full overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200/80 bg-zinc-50/60 text-[11px] uppercase tracking-[0.08em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Claim</th>
            <th className="px-4 py-3 text-left font-semibold">Submitter</th>
            <th className="hidden px-4 py-3 text-left font-semibold md:table-cell">Department</th>
            <th className="hidden px-4 py-3 text-left font-semibold sm:table-cell">Submitted</th>
            <th className="px-4 py-3 text-left font-semibold">Status</th>
            <th className="px-4 py-3 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {claims.map((claim) => (
            <DepartmentClaimRow key={claim.claimId} claim={claim} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentClaimRow({ claim }: { claim: DepartmentViewerClaimRecord }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnToPath = useMemo(
    () => buildPathWithSearchParams(pathname, searchParams.toString()),
    [pathname, searchParams],
  );
  const onBehalfOf = claim.onBehalfEmail?.trim();
  const submitterEmail = claim.submitterEmail?.trim();

  return (
    <tr className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40">
      <td className="px-4 py-3.5 align-middle">
        <RouterLink
          href={appendReturnToParam(ROUTES.claims.detail(claim.claimId), returnToPath)}
          className="whitespace-nowrap font-semibold text-indigo-500 hover:text-indigo-400 hover:underline"
        >
          {claim.claimId}
        </RouterLink>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {claim.typeOfClaim}
          </span>
          {onBehalfOf ? (
            <span className="max-w-[180px] truncate text-[11px] text-zinc-400 dark:text-zinc-500">
              On behalf of {onBehalfOf}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3.5 align-middle">
        <div className="max-w-[200px] truncate font-medium text-zinc-800 dark:text-zinc-200">
          {claim.employeeName || submitterEmail || claim.employeeId}
        </div>
        {submitterEmail ? (
          <div className="max-w-[200px] truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {submitterEmail}
          </div>
        ) : null}
      </td>
      <td className="hidden max-w-[180px] truncate px-4 py-3.5 align-middle text-zinc-600 md:table-cell dark:text-zinc-400">
        {claim.departmentName}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3.5 align-middle text-zinc-600 sm:table-cell dark:text-zinc-400">
        {formatDate(claim.submittedOn)}
      </td>
      <td className="px-4 py-3.5 align-middle">
        <ClaimStatusBadge status={claim.status} />
      </td>
      <td className="px-4 py-3.5 text-right align-middle font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {formatCurrency(claim.amount)}
      </td>
    </tr>
  );
}
