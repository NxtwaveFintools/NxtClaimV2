/**
 * Pure aggregation helpers for the HOD "Review Selected Claims" modal.
 *
 * Kept framework-free so the submitter-list math can be unit-tested without rendering
 * the modal.
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

export type SubmitterGroup = {
  submitter: string;
  submitterEmail: string | null;
  total: number;
  claimCount: number;
  /** Comma-separated list of the distinct expense categories in this submitter's claims. */
  categories: string;
};

export type SubmitterGroupsByType = {
  expense: SubmitterGroup[];
  advance: SubmitterGroup[];
};

type SubmitterAccumulator = {
  submitter: string;
  submitterEmail: string | null;
  total: number;
  claimCount: number;
  categories: Set<string>;
};

/**
 * Group claims by submitter and sum their amounts into a single row per submitter.
 * One submitter with claims of 10 and 20 becomes one group with total 30. Each group also
 * carries a comma-separated list of the distinct categories across that submitter's claims.
 * Sorted by summed total descending, ties broken by submitter name ascending.
 */
export function groupBySubmitterWithTotals(rows: ReviewClaimRow[]): SubmitterGroup[] {
  const accumulators = new Map<string, SubmitterAccumulator>();

  for (const row of rows) {
    const key = row.submitterEmail ?? row.submitter;
    const existing = accumulators.get(key);

    if (existing) {
      existing.total += row.totalAmount;
      existing.claimCount += 1;
      existing.categories.add(row.categoryName);
    } else {
      accumulators.set(key, {
        submitter: row.submitter,
        submitterEmail: row.submitterEmail,
        total: row.totalAmount,
        claimCount: 1,
        categories: new Set([row.categoryName]),
      });
    }
  }

  return [...accumulators.values()]
    .map((accumulator) => ({
      submitter: accumulator.submitter,
      submitterEmail: accumulator.submitterEmail,
      total: accumulator.total,
      claimCount: accumulator.claimCount,
      categories: [...accumulator.categories].sort((a, b) => a.localeCompare(b)).join(", "),
    }))
    .sort((a, b) => b.total - a.total || a.submitter.localeCompare(b.submitter));
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
