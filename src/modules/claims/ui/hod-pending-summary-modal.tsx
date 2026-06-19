"use client";

import { useState } from "react";
import { LayoutDashboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getHodPendingSummaryAction } from "@/modules/claims/actions/get-hod-summary";
import type {
  HodPendingSummaryData,
  HodSummaryCategoryLeaderboard,
  HodSummaryLeaderboard,
} from "@/modules/claims/actions/get-hod-summary";

// ─── Currency helpers ──────────────────────────────────────────────────────────

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatInr(amount: number): string {
  return inrFormatter.format(amount);
}

function formatInrCompact(amount: number): string {
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(1)}L`;
  }
  return inrFormatter.format(amount);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LeaderboardSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-5 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 flex-1 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-14 rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>
      ))}
    </div>
  );
}

// ─── Leaderboard section (employees) ──────────────────────────────────────────

function LeaderboardSection({
  title,
  data,
  isLoading,
}: {
  title: string;
  data: HodSummaryLeaderboard;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white/60 p-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</span>
        <span
          className="text-sm font-bold text-indigo-600 dark:text-indigo-400"
          title={formatInr(data.grand_total)}
        >
          {formatInrCompact(data.grand_total)}
        </span>
      </div>

      {isLoading ? (
        <LeaderboardSkeleton />
      ) : data.rows.length === 0 && data.grand_total === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
          No pending claims
        </p>
      ) : (
        <ol className="space-y-0.5">
          {data.rows.map((row, index) => (
            <li key={row.employee_id} className="flex items-center gap-2.5 py-1">
              <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {row.employee_name}
                </p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {row.claim_count} {row.claim_count === 1 ? "claim" : "claims"}
                </p>
              </div>
              <span
                className="shrink-0 text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-300"
                title={formatInr(row.amount)}
              >
                {formatInrCompact(row.amount)}
              </span>
            </li>
          ))}

          {data.others_count > 0 ? (
            <li className="flex items-center gap-2.5 border-t border-dashed border-zinc-200 pb-0.5 pt-2 dark:border-zinc-700">
              <span className="w-5 shrink-0" />
              <span className="flex-1 text-xs text-zinc-400 dark:text-zinc-500">
                +{data.others_count} more
              </span>
              <span
                className="shrink-0 text-xs font-medium tabular-nums text-zinc-400 dark:text-zinc-500"
                title={formatInr(data.others_total)}
              >
                {formatInrCompact(data.others_total)}
              </span>
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}

// ─── Leaderboard section (categories) ─────────────────────────────────────────

function CategoryLeaderboardSection({
  title,
  data,
  isLoading,
}: {
  title: string;
  data: HodSummaryCategoryLeaderboard;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white/60 p-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</span>
        <span
          className="text-sm font-bold text-indigo-600 dark:text-indigo-400"
          title={formatInr(data.grand_total)}
        >
          {formatInrCompact(data.grand_total)}
        </span>
      </div>

      {isLoading ? (
        <LeaderboardSkeleton />
      ) : data.rows.length === 0 && data.grand_total === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
          No pending claims
        </p>
      ) : (
        <ol className="space-y-0.5">
          {data.rows.map((row, index) => (
            <li key={row.category_id} className="flex items-center gap-2.5 py-1">
              <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
                {index + 1}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {row.category_name}
              </p>
              <span
                className="shrink-0 text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-300"
                title={formatInr(row.amount)}
              >
                {formatInrCompact(row.amount)}
              </span>
            </li>
          ))}

          {data.others_count > 0 ? (
            <li className="flex items-center gap-2.5 border-t border-dashed border-zinc-200 pb-0.5 pt-2 dark:border-zinc-700">
              <span className="w-5 shrink-0" />
              <span className="flex-1 text-xs text-zinc-400 dark:text-zinc-500">
                +{data.others_count} more
              </span>
              <span
                className="shrink-0 text-xs font-medium tabular-nums text-zinc-400 dark:text-zinc-500"
                title={formatInr(data.others_total)}
              >
                {formatInrCompact(data.others_total)}
              </span>
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}

// ─── Module-level constants ────────────────────────────────────────────────────

const emptyLeaderboard: HodSummaryLeaderboard = {
  rows: [],
  others_total: 0,
  others_count: 0,
  grand_total: 0,
};

const emptyCategoryLeaderboard: HodSummaryCategoryLeaderboard = {
  rows: [],
  others_total: 0,
  others_count: 0,
  grand_total: 0,
};

// ─── Modal ─────────────────────────────────────────────────────────────────────

function HodPendingSummaryModal({
  open,
  onClose,
  data,
  isLoading,
  currentStatus,
}: {
  open: boolean;
  onClose: () => void;
  data: HodPendingSummaryData | null;
  isLoading: boolean;
  currentStatus: string | null;
}) {
  // Show advance section during loading (skeleton) or when data confirms advance claims exist.
  // This prevents layout shift when switching status filters.
  const showAdvanceSection =
    isLoading || (data !== null && data.top_advance_employees.grand_total > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pending Claims Summary</DialogTitle>
          <DialogDescription>{currentStatus ?? "All statuses"}</DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <LeaderboardSection
              title="Expense Claims"
              data={data?.top_expense_employees ?? emptyLeaderboard}
              isLoading={isLoading}
            />
            {showAdvanceSection ? (
              <LeaderboardSection
                title="Advance Requests"
                data={data?.top_advance_employees ?? emptyLeaderboard}
                isLoading={isLoading}
              />
            ) : null}
          </div>

          <CategoryLeaderboardSection
            title="Expense Categories"
            data={data?.top_expense_categories ?? emptyCategoryLeaderboard}
            isLoading={isLoading}
          />
        </div>

        <DialogFooter>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Amounts are approximate pending final approval.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Controller ────────────────────────────────────────────────────────────────

export function HodSummaryController({
  initialData,
  initiallyOpen,
  currentStatus,
}: {
  initialData: HodPendingSummaryData | null;
  initiallyOpen: boolean;
  currentStatus: string | null;
}) {
  // initiallyOpen is a mount-time prop — useState(initiallyOpen) auto-opens on first render
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [data, setData] = useState<HodPendingSummaryData | null>(initialData);
  const [cachedForStatus, setCachedForStatus] = useState<string | null>(currentStatus);
  const [isLoading, setIsLoading] = useState(false);

  async function handleOpen() {
    if (isLoading) return;
    // Use cached data only if it was fetched for the same status currently selected
    if (data !== null && cachedForStatus === currentStatus) {
      setIsOpen(true);
      return;
    }
    setIsLoading(true);
    setIsOpen(true);
    const fresh = await getHodPendingSummaryAction(currentStatus);
    setData(fresh);
    setCachedForStatus(currentStatus);
    setIsLoading(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={isLoading}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-4 text-sm font-semibold text-zinc-700 backdrop-blur-sm transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
        View Summary
      </button>
      <HodPendingSummaryModal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        data={data}
        isLoading={isLoading}
        currentStatus={currentStatus}
      />
    </>
  );
}
