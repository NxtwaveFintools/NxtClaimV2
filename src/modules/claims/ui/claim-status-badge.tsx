import type { DbClaimStatus } from "@/core/constants/statuses";

type ClaimStatusBadgeProps = {
  status: DbClaimStatus;
};

function getStatusClasses(status: DbClaimStatus): string {
  if (status === "Rejected") {
    return "border-rose-200 bg-rose-50/80 text-rose-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50";
  }

  if (
    status === "Submitted - Awaiting HOD approval" ||
    status === "HOD approved - Awaiting finance approval"
  ) {
    return "border-amber-300 bg-amber-50/80 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200";
  }

  if (status === "Finance Approved - Payment under process") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500 dark:border-emerald-500/20";
  }

  if (status === "Payment Done - Closed") {
    return "border-green-200 bg-green-50/80 text-green-700 dark:bg-green-600/20 dark:text-green-400 dark:border-green-600/50";
  }

  return "border-zinc-200 bg-zinc-50/80 text-zinc-600 dark:bg-zinc-900/20 dark:text-zinc-300 dark:border-zinc-700/60";
}

export function ClaimStatusBadge({ status }: ClaimStatusBadgeProps) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide ${getStatusClasses(status)}`}
    >
      {status}
    </span>
  );
}
