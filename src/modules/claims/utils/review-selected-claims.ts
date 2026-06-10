/**
 * Pure aggregation helpers for the HOD "Review Selected Claims" modal.
 *
 * Kept framework-free so the pie-chart and submitter-list math can be unit-tested
 * without rendering the modal.
 */

export type ReviewClaimRow = {
  id: string;
  submitter: string;
  submitterEmail: string | null;
  categoryName: string;
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

/**
 * Sum each claim's amount by expense category (`categoryName`) for the pie chart.
 * Slice value is the summed amount, not a count. Ordered by total descending.
 */
export function groupByCategory(rows: ReviewClaimRow[]): CategoryDatum[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    totals.set(row.categoryName, (totals.get(row.categoryName) ?? 0) + row.totalAmount);
  }

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Group selected claims by submitter and sum their amounts into a single row.
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
