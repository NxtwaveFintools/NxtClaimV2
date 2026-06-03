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
    return "border-danger/40 bg-danger-muted text-danger";
  }

  if (
    status === "Submitted" ||
    status === "Pending" ||
    status === "Submitted - Awaiting HOD approval"
  ) {
    return "border-info/40 bg-info-muted text-info";
  }

  if (status === "HOD approved - Awaiting finance approval") {
    return "border-warning/40 bg-warning-muted text-warning";
  }

  if (status === "Approved" || status === "Finance Approved - Payment under process") {
    return "border-success/40 bg-success-muted text-success";
  }

  if (status === "Payment Done - Closed") {
    return "border-success/40 bg-success-muted text-success";
  }

  return "border border-border bg-background-secondary text-muted-foreground";
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
      ? "inline-flex max-w-[260px] items-center justify-center rounded-full px-2.5 py-1 text-center text-xs font-semibold whitespace-nowrap"
      : "inline-flex items-center max-w-[170px] truncate whitespace-nowrap overflow-hidden rounded-full px-3 py-1 text-xs font-medium";
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
