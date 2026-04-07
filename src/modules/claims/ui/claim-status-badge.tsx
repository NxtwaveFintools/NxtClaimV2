import type { ClaimStatus, DbClaimStatus } from "@/core/constants/statuses";

export const CLAIM_STATUS_COLUMN_WIDTH_CLASSES = "w-52 min-w-52 lg:w-56 lg:min-w-56";

type ClaimStatusBadgeProps = {
  status: ClaimStatus | DbClaimStatus;
  fullWidth?: boolean;
  className?: string;
};

function getStatusClasses(status: ClaimStatus | DbClaimStatus): string {
  if (status === "Rejected - Resubmission Not Allowed") {
    return "border-rose-200 bg-rose-50/80 text-rose-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50";
  }

  if (status === "Rejected - Resubmission Allowed") {
    return "border-orange-200 bg-orange-50/80 text-orange-700 dark:border-orange-800/60 dark:bg-orange-900/20 dark:text-orange-300";
  }

  if (
    status === "Submitted" ||
    status === "Pending" ||
    status === "Submitted - Awaiting HOD approval" ||
    status === "HOD approved - Awaiting finance approval"
  ) {
    return "border-amber-300 bg-amber-50/80 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200";
  }

  if (status === "Approved" || status === "Finance Approved - Payment under process") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-500 dark:border-emerald-500/20";
  }

  if (status === "Payment Done - Closed") {
    return "border-green-200 bg-green-50/80 text-green-700 dark:bg-green-600/20 dark:text-green-400 dark:border-green-600/50";
  }

  return "border-zinc-200 bg-zinc-50/80 text-zinc-600 dark:bg-zinc-900/20 dark:text-zinc-300 dark:border-zinc-700/60";
}

export function ClaimStatusBadge({
  status,
  fullWidth = false,
  className = "",
}: ClaimStatusBadgeProps) {
  const layoutClasses = fullWidth
    ? "min-h-11 w-full items-center justify-center px-3 py-2 text-center text-xs font-semibold leading-4 whitespace-normal"
    : "items-center whitespace-nowrap px-2.5 py-1 text-xs font-medium";

  return (
    <span
      className={`inline-flex rounded-2xl border ${layoutClasses} ${getStatusClasses(status)} ${className}`.trim()}
    >
      {status}
    </span>
  );
}
