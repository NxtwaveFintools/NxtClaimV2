/**
 * Pure aggregation helpers for the HOD "Review Selected Claims" modal.
 *
 * Kept framework-free so the pie-chart and submitter-list math can be unit-tested
 * without rendering the modal.
 */

import type { ClaimDetailType } from "@/core/domain/claims/contracts";

export type ReviewClaimRow = {
  id: string;
  submitter: string;
  submitterEmail: string | null;
  categoryName: string;
  detailType: ClaimDetailType;
  totalAmount: number;
};

export type CategoryDatum = {
  category: string;
  total: number;
};

export type SubmitterGroup = {
  submitter: string;
  submitterEmail: string | null;
  total: number;
  claimCount: number;
};

export type SubmitterGroupsByType = {
  expense: SubmitterGroup[];
  advance: SubmitterGroup[];
};

/**
 * Sum each expense claim's amount by expense category (`categoryName`) for the pie chart.
 * Advance claims are excluded entirely — the chart and its totals show only real expense
 * categories. Slice value is the summed amount, not a count. Ordered by total descending.
 */
export function groupByCategory(rows: ReviewClaimRow[]): CategoryDatum[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (row.detailType !== "expense") {
      continue;
    }
    totals.set(row.categoryName, (totals.get(row.categoryName) ?? 0) + row.totalAmount);
  }

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Group claims by submitter and sum their amounts into a single row per submitter.
 * One submitter with claims of 10 and 20 becomes one group with total 30.
 * Sorted by summed total descending, ties broken by submitter name ascending.
 */
export function groupBySubmitterWithTotals(rows: ReviewClaimRow[]): SubmitterGroup[] {
  const groups = new Map<string, SubmitterGroup>();

  for (const row of rows) {
    const key = row.submitterEmail ?? row.submitter;
    const existing = groups.get(key);

    if (existing) {
      existing.total += row.totalAmount;
      existing.claimCount += 1;
    } else {
      groups.set(key, {
        submitter: row.submitter,
        submitterEmail: row.submitterEmail,
        total: row.totalAmount,
        claimCount: 1,
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.total - a.total || a.submitter.localeCompare(b.submitter),
  );
}

/**
 * Divide the selected claims into expense vs advance, then group each side by submitter
 * (summing amounts) and sort high to low. Drives the modal's two list sections.
 */
export function groupSubmittersByDetailType(rows: ReviewClaimRow[]): SubmitterGroupsByType {
  return {
    expense: groupBySubmitterWithTotals(rows.filter((row) => row.detailType === "expense")),
    advance: groupBySubmitterWithTotals(rows.filter((row) => row.detailType === "advance")),
  };
}
