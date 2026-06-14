"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "@/lib/format";
import {
  groupByCategory,
  groupSubmittersByDetailType,
  type ReviewClaimRow,
  type SubmitterGroup,
} from "@/modules/claims/utils/review-selected-claims";

const PIE_COLORS = ["#0EA5E9", "#14B8A6", "#F97316", "#E11D48", "#6366F1", "#64748B"];

function SubmitterGroupSection({
  title,
  groups,
  rowTestId,
}: {
  title: string;
  groups: SubmitterGroup[];
  rowTestId: string;
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
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                {group.submitter}
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {group.submitterEmail ?? "—"}
                {group.claimCount > 1 ? ` · ${group.claimCount} claims` : ""}
              </p>
            </div>
            <span className="whitespace-nowrap font-semibold text-zinc-900 dark:text-zinc-100">
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

  const categoryData = useMemo(() => groupByCategory(rows), [rows]);
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

  if (!open) {
    return null;
  }

  const isBusy = isApproving || isRejecting;
  const canConfirmReject = rejectionReason.trim().length >= 5;
  // When the HOD has "select all across pages" active, the action targets more claims than
  // the modal can show (no cross-page fetch). Clarify the difference without a scope toggle.
  const shownClaimCount = rows.length;
  const hasHiddenSelection = selectedCount > shownClaimCount;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Review selected claims"
    >
      <button
        type="button"
        aria-label="Close review dialog"
        className="absolute inset-0 bg-zinc-900/50"
        disabled={isBusy}
        onClick={onClose}
      />
      <div className="absolute left-1/2 top-1/2 flex max-h-[90vh] w-[94vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Review Selected Claims
          </h3>
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
            {selectedCount} selected.
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Pie chart: summed amount by expense category */}
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              By expense category
            </p>
            <div data-testid="review-pie-chart" className="mt-2 h-56 w-full">
              {categoryData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      dataKey="total"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(entry: { name?: string }) => entry.name ?? ""}
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={entry.category} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number | string) => formatCurrency(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="grid h-full place-items-center text-sm text-zinc-500">
                  No expense claims to chart.
                </p>
              )}
            </div>
          </section>

          {/* Submitter totals, split into expense vs advance, each highest amount first */}
          <SubmitterGroupSection
            title="Expense claims (highest first)"
            groups={submitterGroups.expense}
            rowTestId="review-expense-row"
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
                disabled={isBusy}
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
      </div>
    </div>
  );
}
