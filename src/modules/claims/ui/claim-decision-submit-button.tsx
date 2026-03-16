"use client";

import { useFormStatus } from "react-dom";

type ClaimDecisionSubmitButtonProps = {
  decision: "approve" | "reject" | "mark-paid";
  compact?: boolean;
  pending?: boolean;
};

export function ClaimDecisionSubmitButton({
  decision,
  compact = false,
  pending,
}: ClaimDecisionSubmitButtonProps) {
  const { pending: formPending } = useFormStatus();
  const isPending = pending ?? formPending;
  const isApprove = decision === "approve";
  const isMarkPaid = decision === "mark-paid";

  const baseClasses = compact
    ? isMarkPaid
      ? "inline-flex h-8 items-center justify-center gap-1 rounded-lg border px-2.5 text-xs font-semibold"
      : "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs font-semibold"
    : "inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold";

  let toneClasses =
    "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40";

  if (isApprove) {
    toneClasses =
      "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950/20 dark:text-emerald-300 dark:hover:bg-emerald-950/40";
  }

  if (isMarkPaid) {
    toneClasses =
      "border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700/60 dark:bg-green-950/20 dark:text-green-300 dark:hover:bg-green-950/40";
  }

  let label = isPending
    ? "Processing..."
    : compact
      ? isApprove
        ? "Approve"
        : "Reject"
      : isApprove
        ? "Approve"
        : "Reject";

  if (isMarkPaid) {
    label = isPending ? "Processing..." : compact ? "Paid" : "Mark as Paid";
  }

  const spinner = (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  const markPaidIcon = (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z" />
      <path d="M7 12h10" />
      <path d="M9.5 9.5v5" />
    </svg>
  );

  return (
    <button
      type="submit"
      disabled={isPending}
      className={`${baseClasses} ${toneClasses} transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {isPending ? spinner : isMarkPaid ? markPaidIcon : null}
      {label}
    </button>
  );
}
