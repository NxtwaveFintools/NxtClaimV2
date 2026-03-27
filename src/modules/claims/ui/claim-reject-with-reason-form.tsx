"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type ClaimRejectWithReasonFormProps = {
  action: (formData: FormData) => Promise<void>;
  compact?: boolean;
  redirectToHref?: string;
};

export function ClaimRejectWithReasonForm({
  action,
  compact = false,
  redirectToHref,
}: ClaimRejectWithReasonFormProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
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
      setIsModalOpen(false);
      event.currentTarget.reset();

      if (redirectToHref) {
        startTransition(() => {
          router.push(redirectToHref, { scroll: false });
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsModalOpen(true);
        }}
        className={
          compact
            ? "inline-flex h-8 items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-100 active:scale-[0.98] dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
            : "inline-flex items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-5 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-100 active:scale-[0.98] dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
        }
      >
        Reject
      </button>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close reject dialog"
            className="absolute inset-0 bg-zinc-900/50"
            disabled={isSubmitting}
            onClick={() => {
              setIsModalOpen(false);
            }}
          />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -tranzinc-x-1/2 -tranzinc-y-1/2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Reject Claim
            </h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Add a rejection reason and choose whether the employee can resubmit this exact bill.
            </p>

            <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <label
                  htmlFor="rejectionReason"
                  className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300"
                >
                  Reason for Rejection
                </label>
                <textarea
                  id="rejectionReason"
                  name="rejectionReason"
                  required
                  minLength={5}
                  disabled={isSubmitting}
                  rows={4}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-indigo-500 transition focus:ring dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  placeholder="Enter at least 5 characters"
                />
              </div>

              <label className="inline-flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                <input
                  type="checkbox"
                  name="allowResubmission"
                  value="true"
                  disabled={isSubmitting}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  Allow employee to resubmit this exact bill/receipt
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setIsModalOpen(false);
                  }}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition-all duration-200 hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-100 active:scale-[0.98] disabled:opacity-60 dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
                >
                  {isSubmitting ? "Processing..." : "Confirm Rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
