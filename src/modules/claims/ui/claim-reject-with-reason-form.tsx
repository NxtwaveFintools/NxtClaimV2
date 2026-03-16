"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ClaimDecisionSubmitButton } from "@/modules/claims/ui/claim-decision-submit-button";

type ClaimRejectWithReasonFormProps = {
  action: (formData: FormData) => Promise<void>;
  compact?: boolean;
};

export function ClaimRejectWithReasonForm({
  action,
  compact = false,
}: ClaimRejectWithReasonFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);

    try {
      await toast.promise(action(formData), {
        loading: "Processing rejection...",
        success: "Claim rejected.",
        error: (error) => (error instanceof Error ? error.message : "Unable to reject claim."),
      });
      setIsExpanded(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsExpanded(true);
        }}
        className={
          compact
            ? "inline-flex h-8 items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-100 active:scale-[0.98] dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
            : "inline-flex items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-5 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-100 active:scale-[0.98] dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
        }
      >
        Reject
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? "flex min-w-[220px] items-end gap-2" : "grid gap-2"}
    >
      <div className="grid flex-1 gap-1">
        <label
          htmlFor="rejectionReason"
          className="text-xs font-medium uppercase tracking-[0.08em] text-rose-300"
        >
          Rejection Reason
        </label>
        <textarea
          id="rejectionReason"
          name="rejectionReason"
          required
          minLength={3}
          disabled={isSubmitting}
          rows={compact ? 2 : 3}
          className="w-full rounded-lg border border-rose-700/40 bg-rose-950/30 px-2.5 py-2 text-xs text-rose-100 outline-none ring-rose-500 transition focus:ring"
          placeholder="Enter reason"
        />
      </div>
      <div className={compact ? "flex items-center gap-2" : "flex items-center gap-3"}>
        <ClaimDecisionSubmitButton decision="reject" compact={compact} pending={isSubmitting} />
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            setIsExpanded(false);
          }}
          className={
            compact
              ? "inline-flex h-8 items-center justify-center rounded-lg border border-slate-600 px-2 text-xs font-semibold text-slate-300 transition-all duration-200 hover:bg-slate-800 active:scale-[0.98]"
              : "inline-flex items-center justify-center rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-300 transition-all duration-200 hover:bg-slate-800 active:scale-[0.98]"
          }
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
