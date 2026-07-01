"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { RouterLink } from "@/components/ui/router-link";
import { TableEmptyState } from "@/components/ui/table-empty-state";
import { softDeleteClaimAction } from "@/modules/admin/actions";
import { appendReturnToParam, buildPathWithSearchParams } from "@/lib/pagination-helpers";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import type { AdminClaimRecord } from "@/core/domain/admin/contracts";
import { formatDate, formatCurrency } from "@/lib/format";

type Props = {
  claims: AdminClaimRecord[];
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
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
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200/80 bg-zinc-50/60 text-[11px] uppercase tracking-[0.08em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Claim</th>
            <th className="px-4 py-3 text-left font-semibold">Submitter</th>
            <th className="hidden px-4 py-3 text-left font-semibold lg:table-cell">Department</th>
            <th className="px-4 py-3 text-left font-semibold">Status</th>
            <th className="px-4 py-3 text-right font-semibold">Amount</th>
            <th className="px-4 py-3 text-left font-semibold">Active</th>
            <th className="hidden px-4 py-3 text-left font-semibold xl:table-cell">Deleted By</th>
            <th className="hidden px-4 py-3 text-left font-semibold md:table-cell">Submitted</th>
            <th className="px-4 py-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
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
      <td className="hidden max-w-[180px] truncate px-4 py-3.5 align-middle text-zinc-600 lg:table-cell dark:text-zinc-400">
        {claim.departmentName}
      </td>
      <td className="px-4 py-3.5 align-middle">
        <ClaimStatusBadge status={claim.status} />
      </td>
      <td className="px-4 py-3.5 text-right align-middle font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {formatCurrency(claim.amount)}
      </td>
      <td className="whitespace-nowrap px-4 py-3.5 align-middle">
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
      <td className="hidden px-4 py-3.5 align-middle xl:table-cell">
        {claim.deletedByName ? (
          <span className="inline-block max-w-[200px] truncate align-bottom text-zinc-600 dark:text-zinc-400">
            {claim.deletedByName} ({resolveRoleLabel(claim.deletedByRole)})
          </span>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">—</span>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-3.5 align-middle text-zinc-600 md:table-cell dark:text-zinc-400">
        {formatDate(claim.submittedOn)}
      </td>
      <td className="whitespace-nowrap px-4 py-3.5 text-right align-middle">
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
