import type { ClaimStatus, DbClaimStatus } from "@/core/constants/statuses";

type ClaimStatusBadgeProps = {
  status: ClaimStatus | DbClaimStatus;
  fullWidth?: boolean;
  className?: string;
};

type StatusTone = "slate" | "blue" | "indigo" | "green" | "amber" | "red";

type StatusMeta = {
  label: string;
  tone: StatusTone;
};

/**
 * Single source of truth for claim status presentation.
 * Each status maps to one short, scannable label and one tone. The same tone
 * is used everywhere a status is shown, so a status never changes colour
 * between screens. Colour is always paired with a dot + text label so the
 * meaning survives for colour-blind users (no colour-only signalling).
 */
const TONE_CLASSES: Record<StatusTone, { pill: string; dot: string }> = {
  slate: {
    pill: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-300",
    dot: "bg-slate-400 dark:bg-slate-500",
  },
  blue: {
    pill: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/25 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  indigo: {
    pill: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-900/25 dark:text-indigo-300",
    dot: "bg-indigo-500",
  },
  green: {
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-900/25 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  amber: {
    pill: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/25 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  red: {
    pill: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/25 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

function getStatusMeta(status: ClaimStatus | DbClaimStatus): StatusMeta {
  switch (status) {
    case "Submitted":
    case "Submitted - Awaiting HOD approval":
      return { label: "Awaiting HOD", tone: "slate" };
    case "Pending":
    case "HOD approved - Awaiting finance approval":
      return { label: "HOD Approved", tone: "blue" };
    case "Finance Approved - Payment under process":
      return { label: "Finance Approved", tone: "indigo" };
    case "Approved":
      return { label: "Approved", tone: "green" };
    case "Payment Done - Closed":
      return { label: "Payment Done", tone: "green" };
    case "Rejected - Resubmission Allowed":
      return { label: "Rejected · Resubmit", tone: "amber" };
    case "Rejected - Resubmission Not Allowed":
      return { label: "Rejected", tone: "red" };
    default:
      return { label: String(status), tone: "slate" };
  }
}

export function ClaimStatusBadge({
  status,
  fullWidth = false,
  className = "",
}: ClaimStatusBadgeProps) {
  const { label, tone } = getStatusMeta(status);
  const { pill, dot } = TONE_CLASSES[tone];
  const layoutClasses = fullWidth ? "w-full justify-center px-3 py-1.5" : "px-2.5 py-1";

  return (
    <span
      title={status}
      aria-label={status}
      className={`inline-flex items-center gap-1.5 rounded-full border text-xs font-semibold whitespace-nowrap ${pill} ${layoutClasses} ${className}`.trim()}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
