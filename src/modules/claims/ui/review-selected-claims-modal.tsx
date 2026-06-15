"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  groupSubmittersByDetailType,
  type ReviewClaimRow,
  type SubmitterGroup,
} from "@/modules/claims/utils/review-selected-claims";

function SubmitterGroupSection({
  title,
  groups,
  rowTestId,
  showCategories = false,
}: {
  title: string;
  groups: SubmitterGroup[];
  rowTestId: string;
  showCategories?: boolean;
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="mt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
        {title}
      </p>
      <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200/80 dark:divide-zinc-800 dark:border-zinc-800">
        {groups.map((group) => (
          <li
            key={group.submitterEmail ?? group.submitter}
            data-testid={rowTestId}
            className="flex items-start justify-between gap-3 px-3 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                {group.submitter}
              </p>
              <p className="mt-1 truncate text-sm text-zinc-600 dark:text-zinc-300">
                {group.submitterEmail ?? "—"}
                {group.claimCount > 1 ? ` · ${group.claimCount} claims` : ""}
              </p>
              {showCategories && group.categories ? (
                <div data-testid="review-expense-categories" className="flex flex-wrap">
                  {group.categories.split(", ").map((category) => (
                    <span
                      key={category}
                      data-testid="review-category-badge"
                      className="mr-2 mt-2 inline-block rounded-md bg-zinc-100 px-2.5 py-1 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      {category}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="whitespace-nowrap pt-0.5 font-semibold text-zinc-900 dark:text-zinc-100">
              {formatCurrency(group.total)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type ReviewSelectedClaimsModalProps = {
  open: boolean;
  rows: ReviewClaimRow[];
  /** The current action target count (drives the header badge). */
  selectedCount: number;
  /** When false, the Approve All button is disabled (claims are not all in an approvable state). */
  isApproveValid?: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onApproveAll: () => void;
  onRejectAll: (reason: string, allowResubmission: boolean) => void;
  onClose: () => void;
};

export function ReviewSelectedClaimsModal({
  open,
  rows,
  selectedCount,
  isApproveValid = true,
  isApproving,
  isRejecting,
  onApproveAll,
  onRejectAll,
  onClose,
}: ReviewSelectedClaimsModalProps) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [allowResubmission, setAllowResubmission] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  const submitterGroups = useMemo(() => groupSubmittersByDetailType(rows), [rows]);

  // The modal stays mounted across opens; reset the inline reject form when it closes so a
  // stale reason can never carry into the next review session. Resetting during render (the
  // documented React pattern for "adjust state when a prop changes") keeps it out of an effect.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setShowRejectForm(false);
      setRejectionReason("");
      setAllowResubmission(false);
    }
  }

  const isBusy = isApproving || isRejecting;
  const canConfirmReject = rejectionReason.trim().length >= 5;
  const showReasonHint = rejectionReason.length > 0 && rejectionReason.trim().length < 5;
  // When the HOD has "select all across pages" active, the action targets more claims than
  // the modal can show (no cross-page fetch). Clarify the difference without a scope toggle.
  const shownClaimCount = rows.length;
  const hasHiddenSelection = selectedCount > shownClaimCount;

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen && !isBusy) {
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-[94vw] max-w-2xl flex-col overflow-hidden p-0"
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (isBusy) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isBusy) e.preventDefault();
        }}
      >
        <div className="flex items-center justify-between border-b border-zinc-200/80 py-4 pl-5 pr-14 dark:border-zinc-800">
          <DialogTitle>Review Selected Claims</DialogTitle>
          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
            {selectedCount} selected
          </span>
        </div>

        {hasHiddenSelection ? (
          <p
            data-testid="review-scope-clarifier"
            className="border-b border-amber-200/80 bg-amber-50 px-5 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
          >
            Showing this page&apos;s {shownClaimCount} · Approve / Reject applies to all{" "}
            {selectedCount} claims.
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Submitter totals, split into expense vs advance, each highest amount first.
              Expense rows also list the distinct categories per submitter. */}
          <SubmitterGroupSection
            title="Expense claims (highest first)"
            groups={submitterGroups.expense}
            rowTestId="review-expense-row"
            showCategories
          />
          <SubmitterGroupSection
            title="Advance claims (highest first)"
            groups={submitterGroups.advance}
            rowTestId="review-advance-row"
          />

          {/* Inline reject form */}
          {showRejectForm ? (
            <section className="mt-4 grid gap-3 rounded-xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-800 dark:bg-rose-950/10">
              <div className="grid gap-1.5">
                <label
                  htmlFor="reviewRejectionReason"
                  className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300"
                >
                  Rejection Reason
                </label>
                <textarea
                  id="reviewRejectionReason"
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.currentTarget.value)}
                  minLength={5}
                  rows={3}
                  disabled={isRejecting}
                  placeholder="Enter at least 5 characters"
                  className="min-h-20 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-indigo-500 transition focus:ring dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
                {showReasonHint ? (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    Please enter at least 5 characters.
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="reviewAllowResubmission"
                  type="checkbox"
                  checked={allowResubmission}
                  disabled={isRejecting}
                  onChange={(event) => setAllowResubmission(event.currentTarget.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                />
                <label
                  htmlFor="reviewAllowResubmission"
                  className="text-sm text-zinc-700 dark:text-zinc-300"
                >
                  Allow resubmission for all selected claims
                </label>
              </div>
            </section>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200/80 px-5 py-4 dark:border-zinc-800">
          {showRejectForm ? (
            <>
              <button
                type="button"
                disabled={isRejecting}
                onClick={() => setShowRejectForm(false)}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Back
              </button>
              <button
                type="button"
                disabled={isRejecting || !canConfirmReject}
                onClick={() => onRejectAll(rejectionReason.trim(), allowResubmission)}
                className="inline-flex items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
              >
                {isRejecting ? "Processing..." : "Confirm Rejection"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isBusy || !isApproveValid}
                onClick={onApproveAll}
                className="inline-flex items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700/60 dark:bg-emerald-950/20 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
              >
                {isApproving ? "Processing..." : "Approve All"}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setShowRejectForm(true)}
                className="inline-flex items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
              >
                Reject All
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
