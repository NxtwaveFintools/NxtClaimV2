"use client";

import Link from "next/link";
import { ROUTES } from "@/core/config/route-registry";
import {
  CLAIM_STATUS_COLUMN_WIDTH_CLASSES,
  ClaimStatusBadge,
} from "@/modules/claims/ui/claim-status-badge";
import type { DepartmentViewerClaimRecord } from "@/core/domain/claims/contracts";
import { formatDate, formatCurrency } from "@/lib/format";

type Props = {
  rows: DepartmentViewerClaimRecord[];
};

export function DepartmentClaimsTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="grid place-items-center px-4 py-14 text-center">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          No claims found for your assigned departments
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Adjust filters or check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="nxt-scroll w-full overflow-x-auto">
      <table className="min-w-325 divide-y divide-zinc-200/80 text-left text-sm dark:divide-zinc-800">
        <thead className="bg-zinc-50/80 text-[11px] uppercase tracking-[0.14em] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
          <tr>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">CLAIM ID</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">EMPLOYEE ID</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">EMPLOYEE NAME</th>
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
          {rows.map((claim) => (
            <DepartmentClaimRow key={claim.claimId} claim={claim} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentClaimRow({ claim }: { claim: DepartmentViewerClaimRecord }) {
  return (
    <tr className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
      <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
        <Link
          href={ROUTES.claims.detail(claim.claimId)}
          className="whitespace-nowrap text-indigo-500 hover:text-indigo-400 hover:underline"
        >
          {claim.claimId}
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="inline-block max-w-45 truncate align-bottom">{claim.employeeId}</span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-37.5 truncate align-bottom">{claim.employeeName}</span>
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
