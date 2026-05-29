import type { ClaimStatus, DbClaimStatus } from "@/core/constants/statuses";
import { Badge } from "@/components/ui/badge";

export const CLAIM_STATUS_COLUMN_WIDTH_CLASSES = "w-44 min-w-44 lg:w-48 lg:min-w-48";

const STATUS_DISPLAY_LABELS: Partial<Record<ClaimStatus | DbClaimStatus, string>> = {
  "Finance Approved - Payment under process": "Payment Processing",
  "Payment Done - Closed": "Paid",
  "HOD approved - Awaiting finance approval": "Awaiting Finance",
  "Submitted - Awaiting HOD approval": "Awaiting HOD",
  "Rejected - Resubmission Allowed": "Rejected",
  "Rejected - Resubmission Not Allowed": "Rejected",
};

type ClaimStatusBadgeProps = {
  status: ClaimStatus | DbClaimStatus;
  fullWidth?: boolean;
  fullStatus?: boolean;
  className?: string;
};

function getStatusClasses(status: ClaimStatus | DbClaimStatus): string {
  if (
    status === "Rejected - Resubmission Not Allowed" ||
    status === "Rejected - Resubmission Allowed"
  ) {
    return "border-rose-200 bg-rose-50/80 text-rose-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50";
  }

  if (
    status === "Submitted" ||
    status === "Pending" ||
    status === "Submitted - Awaiting HOD approval"
  ) {
    return "border-sky-300 bg-sky-50/80 text-sky-800 dark:border-sky-700/60 dark:bg-sky-900/30 dark:text-sky-200";
  }

  if (status === "HOD approved - Awaiting finance approval") {
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
  fullStatus = false,
  className = "",
}: ClaimStatusBadgeProps) {
  const layoutClasses = fullWidth
    ? "w-full min-w-[150px] max-w-[190px] items-center justify-center px-2.5 py-1.5 text-center text-xs font-semibold leading-tight whitespace-normal"
    : fullStatus
      ? "inline-flex max-w-[260px] items-center justify-center px-2 py-1 text-center text-xs font-semibold leading-tight whitespace-nowrap"
      : "inline-flex items-center max-w-[170px] truncate whitespace-nowrap overflow-hidden px-3 py-1 text-xs font-medium";
  const displayLabel = fullStatus ? status : (STATUS_DISPLAY_LABELS[status] ?? status);

  return (
    <Badge
      title={fullStatus ? undefined : status}
      className={`rounded-full ${layoutClasses} ${getStatusClasses(status)} ${className}`.trim()}
    >
      {displayLabel}
    </Badge>
  );
}
