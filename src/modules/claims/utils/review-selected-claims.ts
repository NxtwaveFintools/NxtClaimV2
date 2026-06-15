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
  /** Non-null when this claim was filed on behalf of a different person (the beneficiary). */
  onBehalfEmail: string | null;
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
 * Group claims by the effective claim owner and sum their amounts into a single row.
 * For "on behalf of" claims the owner is the beneficiary (onBehalfEmail); for self-claims
 * it is the submitter. One owner with claims of 10 and 20 becomes one group with total 30.
 * Each group also carries a comma-separated list of distinct categories across their claims.
 * Sorted by summed total descending, ties broken by display name ascending.
 */
export function groupBySubmitterWithTotals(rows: ReviewClaimRow[]): SubmitterGroup[] {
  const accumulators = new Map<string, SubmitterAccumulator>();

  for (const row of rows) {
    // For "on behalf of" claims the relevant person is the beneficiary, not the proxy who
    // submitted. Fall back to submitter details for standard self-claims.
    const beneficiaryEmail = row.onBehalfEmail?.trim() || null;
    const targetName = beneficiaryEmail ?? row.submitter;
    const targetEmail = beneficiaryEmail ?? row.submitterEmail;
    const key = targetEmail ?? targetName;

    const existing = accumulators.get(key);

    if (existing) {
      existing.total += row.totalAmount;
      existing.claimCount += 1;
      existing.categories.add(row.categoryName);
    } else {
      accumulators.set(key, {
        submitter: targetName,
        submitterEmail: targetEmail,
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
