"use client";

import { ROUTES } from "@/core/config/route-registry";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { RouterLink } from "@/components/ui/router-link";
import { TableEmptyState } from "@/components/ui/table-empty-state";
import {
  CLAIM_STATUS_COLUMN_WIDTH_CLASSES,
  ClaimStatusBadge,
} from "@/modules/claims/ui/claim-status-badge";
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
      <table className="min-w-395 divide-y divide-zinc-200/80 text-left text-sm dark:divide-zinc-800">
        <thead className="bg-zinc-50/80 text-[11px] uppercase tracking-[0.14em] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
          <tr>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">CLAIM ID</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">SUBMITTER ID</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">SUBMITTER EMAIL</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">ON BEHALF ID</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">ON BEHALF EMAIL</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">DEPARTMENT</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">TYPE</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">AMOUNT</th>
            <th
              className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} whitespace-nowrap px-3 py-2 font-semibold`}
            >
              STATUS
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">SUBMITTED ON</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100/80 bg-white/50 text-xs text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
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

  return (
    <tr className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
      <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
        <RouterLink
          href={appendReturnToParam(ROUTES.claims.detail(claim.claimId), returnToPath)}
          className="whitespace-nowrap text-indigo-500 hover:text-indigo-400 hover:underline"
        >
          {claim.claimId}
        </RouterLink>
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="inline-block max-w-45 truncate align-bottom">{claim.employeeId}</span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-45 truncate align-bottom">
          {claim.submitterEmail?.trim() || claim.employeeName}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="inline-block max-w-35 truncate align-bottom">
          {claim.onBehalfEmployeeCode?.trim() || "N/A"}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-40 truncate align-bottom">
          {claim.onBehalfEmail?.trim() || "N/A"}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-32.5 truncate align-bottom">
          {claim.departmentName}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-35 truncate align-bottom">{claim.typeOfClaim}</span>
      </td>
      <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-100">
        {formatCurrency(claim.amount)}
      </td>
      <td className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} px-3 py-2 align-top`}>
        <ClaimStatusBadge status={claim.status} fullWidth />
      </td>
      <td className="px-3 py-2">{formatDate(claim.submittedOn)}</td>
    </tr>
  );
}
