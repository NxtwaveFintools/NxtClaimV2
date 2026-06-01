"use client";

import { memo, useMemo, useTransition } from "react";
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

const CLAIM_LINK_CLASSES = "block max-w-full break-words text-primary hover:underline leading-snug";
const VIEW_LINK_CLASSES =
  "inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-background-secondary";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnToPath = useMemo(
    () => buildPathWithSearchParams(pathname, searchParams.toString()),
    [pathname, searchParams],
  );

  if (claims.length === 0) {
    return (
      <TableEmptyState title="No claims found" description="Adjust filters or check back later." />
    );
  }

  return (
    <div className="nxt-scroll w-full overflow-x-auto">
      <table className="w-full table-fixed divide-y divide-border text-left text-sm">
        <colgroup>
          <col className="w-[20%]" />
          <col className="w-[18%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[9%]" />
          <col className="w-[15%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="bg-background-secondary text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
          <tr>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">CLAIM</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">SUBMITTER / BENEFICIARY</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">DEPT</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">TYPE</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">AMOUNT</th>
            <th className="whitespace-nowrap px-3 py-2 text-center font-semibold">STATUS</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">SUBMITTED</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">ACTIONS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card text-[13px] text-foreground">
          {claims.map((claim) => (
            <AdminClaimRow key={claim.claimId} claim={claim} returnToPath={returnToPath} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AdminClaimRow = memo(function AdminClaimRow({
  claim,
  returnToPath,
}: {
  claim: AdminClaimRecord;
  returnToPath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const detailHref = appendReturnToParam(ROUTES.claims.detail(claim.claimId), returnToPath);
  const primarySubmitter = claim.submitterEmail?.trim() || claim.employeeName;
  const onBehalfValue = claim.onBehalfEmail?.trim() || claim.onBehalfEmployeeCode?.trim() || "";
  const hasOnBehalf = onBehalfValue.length > 0;

  function handleSoftDelete() {
    startTransition(async () => {
      const result = await softDeleteClaimAction(claim.claimId);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <tr className="transition-colors hover:bg-background-secondary">
      <td className="px-3 py-2.5 font-medium text-foreground">
        <RouterLink href={detailHref} className={CLAIM_LINK_CLASSES} title={claim.claimId}>
          {claim.claimId}
        </RouterLink>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{claim.employeeId}</div>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-block max-w-full truncate align-bottom" title={primarySubmitter}>
          {hasOnBehalf ? `Submitter: ${primarySubmitter}` : primarySubmitter}
        </span>
        <div
          className="mt-0.5 max-w-full truncate text-xs text-muted-foreground"
          title={hasOnBehalf ? onBehalfValue : "On behalf: N/A"}
        >
          {hasOnBehalf ? `For: ${onBehalfValue}` : "On behalf: N/A"}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span
          className="inline-block max-w-full truncate align-bottom"
          title={claim.departmentName}
        >
          {claim.departmentName}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-block max-w-full truncate align-bottom" title={claim.typeOfClaim}>
          {claim.typeOfClaim}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-foreground">
        {formatCurrency(claim.amount)}
      </td>
      <td className="px-3 py-2.5 align-middle">
        <ClaimStatusBadge status={claim.status} fullWidth fullStatus />
      </td>
      <td className="px-3 py-2.5 text-[13px]">
        <span className="whitespace-nowrap">{formatDate(claim.submittedOn)}</span>
        {!claim.isActive && claim.deletedByName ? (
          <div className="mt-0.5 max-w-full truncate text-xs text-muted-foreground">
            Deleted: {claim.deletedByName} ({resolveRoleLabel(claim.deletedByRole)})
          </div>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <RouterLink href={detailHref} className={VIEW_LINK_CLASSES}>
            View
          </RouterLink>
          {claim.isActive ? (
            <button
              type="button"
              onClick={handleSoftDelete}
              disabled={isPending}
              className="inline-flex h-8 items-center rounded-md border border-rose-300 bg-rose-50 px-2 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/60"
            >
              {isPending ? "Deleting..." : "Delete"}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Deleted</span>
          )}
        </div>
      </td>
    </tr>
  );
});
