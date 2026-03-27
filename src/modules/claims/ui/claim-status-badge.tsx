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
    return "border-amber-300 bg-amber-50/80 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200";
  }

  if (status === "Finance Approved - Payment under process") {
    return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  }

  if (status === "Payment Done - Closed") {
    return "bg-green-600/20 text-green-400 border-green-600/50";
  }

  return "bg-zinc-900/20 text-zinc-300 border-zinc-700/60";
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
