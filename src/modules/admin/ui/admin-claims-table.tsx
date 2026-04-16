"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { RouterLink } from "@/components/ui/router-link";
import { TableEmptyState } from "@/components/ui/table-empty-state";
import { softDeleteClaimAction } from "@/modules/admin/actions";
import { appendReturnToParam, buildPathWithSearchParams } from "@/lib/pagination-helpers";
import {
  CLAIM_STATUS_COLUMN_WIDTH_CLASSES,
  ClaimStatusBadge,
} from "@/modules/claims/ui/claim-status-badge";
import type { AdminClaimRecord } from "@/core/domain/admin/contracts";
import { formatDate, formatCurrency } from "@/lib/format";

type Props = {
  claims: AdminClaimRecord[];
};

const ROLE_LABELS: Record<string, string> = {
  employee: "Employee",
  hod: "HOD",
  founder: "Founder",
  finance: "Finance",
};

function resolveRoleLabel(role: string | null): string {
  if (!role) {
    return "User";
  }

  const normalizedRole = role.trim().toLowerCase();
  if (!normalizedRole) {
    return "User";
  }

  return ROLE_LABELS[normalizedRole] ?? role;
}

export function AdminClaimsTable({ claims }: Props) {
  if (claims.length === 0) {
    return (
      <TableEmptyState title="No claims found" description="Adjust filters or check back later." />
    );
  }

  return (
    <div className="nxt-scroll w-full overflow-x-auto">
      <table className="min-w-470 divide-y divide-zinc-200/80 text-left text-sm dark:divide-zinc-800">
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
            <th className="whitespace-nowrap px-3 py-2 font-semibold">ACTIVE</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">DELETED BY</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">SUBMITTED ON</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">ACTIONS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100/80 bg-white/50 text-xs text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
          {claims.map((claim) => (
            <AdminClaimRow key={claim.claimId} claim={claim} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminClaimRow({ claim }: { claim: AdminClaimRecord }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnToPath = useMemo(
    () => buildPathWithSearchParams(pathname, searchParams.toString()),
    [pathname, searchParams],
  );
  const [isPending, startTransition] = useTransition();

  function handleSoftDelete() {
    startTransition(async () => {
      const result = await softDeleteClaimAction(claim.claimId);
      if (result.ok) {
        router.refresh();
      }
    });
  }

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
        <span className="inline-block max-w-55 truncate align-bottom">
          {claim.submitterEmail?.trim() || claim.employeeName}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="inline-block max-w-35 truncate align-bottom">
          {claim.onBehalfEmployeeCode?.trim() || "N/A"}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-55 truncate align-bottom">
          {claim.onBehalfEmail?.trim() || "N/A"}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-50 truncate align-bottom">{claim.departmentName}</span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-block max-w-45 truncate align-bottom">{claim.typeOfClaim}</span>
      </td>
      <td className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-100">
        {formatCurrency(claim.amount)}
      </td>
      <td className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} px-3 py-2 align-top`}>
        <ClaimStatusBadge status={claim.status} fullWidth />
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {claim.isActive ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Soft-deleted
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {claim.deletedByName ? (
          <span className="inline-block max-w-55 truncate align-bottom">
            {claim.deletedByName} ({resolveRoleLabel(claim.deletedByRole)})
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            NA
          </span>
        )}
      </td>
      <td className="px-3 py-2">{formatDate(claim.submittedOn)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {claim.isActive ? (
          <button
            type="button"
            onClick={handleSoftDelete}
            disabled={isPending}
            className="inline-flex h-8 items-center rounded-lg border border-rose-300 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/60"
          >
            {isPending ? "Deleting…" : "Soft Delete"}
          </button>
        ) : (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">Already deleted</span>
        )}
      </td>
    </tr>
  );
}
