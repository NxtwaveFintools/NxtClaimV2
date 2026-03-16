import type { DbClaimStatus } from "@/core/constants/statuses";

type ClaimStatusBadgeProps = {
  status: DbClaimStatus;
};

function getStatusClasses(status: DbClaimStatus): string {
  if (status === "Rejected") {
    return "bg-red-900/20 text-red-400 border-red-900/50";
  }

  if (
    status === "Submitted - Awaiting HOD approval" ||
    status === "HOD approved - Awaiting finance approval"
  ) {
    return "bg-yellow-900/20 text-yellow-400 border-yellow-900/50";
  }

  if (status === "Finance Approved - Payment under process") {
    return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  }

  if (status === "Payment Done - Closed") {
    return "bg-green-600/20 text-green-400 border-green-600/50";
  }

  return "bg-slate-900/20 text-slate-300 border-slate-700/60";
}

export function ClaimStatusBadge({ status }: ClaimStatusBadgeProps) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide ${getStatusClasses(status)}`}
    >
      {status}
    </span>
  );
}
