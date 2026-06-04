"use client";

import { ROUTES } from "@/core/config/route-registry";
import { memo, useMemo } from "react";
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

const CLAIM_LINK_CLASSES = "block max-w-full break-words text-primary hover:underline leading-snug";
const VIEW_LINK_CLASSES =
  "inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-background-secondary";

export function DepartmentClaimsTable({ claims }: Props) {
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
      <table className="min-w-[1040px] w-full table-fixed divide-y divide-border text-left text-sm">
        <colgroup>
          <col className="w-[21%]" />
          <col className="w-[19%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[9%]" />
          <col className="w-[15%]" />
          <col className="w-[11%]" />
          <col className="w-[7%]" />
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
            <DepartmentClaimRow key={claim.claimId} claim={claim} returnToPath={returnToPath} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DepartmentClaimRow = memo(function DepartmentClaimRow({
  claim,
  returnToPath,
}: {
  claim: DepartmentViewerClaimRecord;
  returnToPath: string;
}) {
  const detailHref = appendReturnToParam(ROUTES.claims.detail(claim.claimId), returnToPath);
  const primarySubmitter = claim.submitterEmail?.trim() || claim.employeeName;
  const onBehalfValue = claim.onBehalfEmail?.trim() || claim.onBehalfEmployeeCode?.trim() || "";
  const hasOnBehalf = onBehalfValue.length > 0;

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
      <td className="whitespace-nowrap px-3 py-2.5 text-[13px]">{formatDate(claim.submittedOn)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <RouterLink href={detailHref} className={VIEW_LINK_CLASSES}>
          View
        </RouterLink>
      </td>
    </tr>
  );
});
