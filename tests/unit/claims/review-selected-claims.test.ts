import {
  groupByCategory,
  groupBySubmitterWithTotals,
  type ReviewClaimRow,
} from "@/modules/claims/utils/review-selected-claims";

function row(overrides: Partial<ReviewClaimRow>): ReviewClaimRow {
  return {
    id: "claim-1",
    submitter: "Alice",
    submitterEmail: "alice@example.com",
    categoryName: "Petty Cash",
    totalAmount: 100,
    ...overrides,
  };
}

describe("groupByCategory", () => {
  it("sums totalAmount per category (categoryName)", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", categoryName: "Petty Cash", totalAmount: 650 }),
      row({ id: "2", categoryName: "Petty Cash", totalAmount: 145 }),
      row({ id: "3", categoryName: "Travel", totalAmount: 200 }),
    ];

    expect(groupByCategory(rows)).toEqual([
      { category: "Petty Cash", total: 795 },
      { category: "Travel", total: 200 },
    ]);
  });

  it("orders categories by total descending", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", categoryName: "Travel", totalAmount: 500 }),
      row({ id: "2", categoryName: "Petty Cash", totalAmount: 100 }),
      row({ id: "3", categoryName: "Reimbursement", totalAmount: 300 }),
    ];

    expect(groupByCategory(rows).map((datum) => datum.category)).toEqual([
      "Travel",
      "Reimbursement",
      "Petty Cash",
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("groupBySubmitterWithTotals", () => {
  it("sums a submitter's multiple claims into a single row (10 + 20 = 30)", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", submitter: "User A", submitterEmail: "a@x.com", totalAmount: 10 }),
      row({ id: "2", submitter: "User A", submitterEmail: "a@x.com", totalAmount: 20 }),
    ];

    expect(groupBySubmitterWithTotals(rows)).toEqual([
      { submitter: "User A", submitterEmail: "a@x.com", total: 30, claimCount: 2 },
    ]);
  });

  it("sorts grouped submitters by summed total, highest first", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", submitter: "User A", submitterEmail: "a@x.com", totalAmount: 10 }),
      row({ id: "2", submitter: "User A", submitterEmail: "a@x.com", totalAmount: 20 }),
      row({ id: "3", submitter: "User B", submitterEmail: "b@x.com", totalAmount: 50 }),
    ];

    expect(groupBySubmitterWithTotals(rows)).toEqual([
      { submitter: "User B", submitterEmail: "b@x.com", total: 50, claimCount: 1 },
      { submitter: "User A", submitterEmail: "a@x.com", total: 30, claimCount: 2 },
    ]);
  });

  it("breaks ties by submitter name ascending", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", submitter: "Charlie", submitterEmail: "c@x.com", totalAmount: 30 }),
      row({ id: "2", submitter: "Bravo", submitterEmail: "b@x.com", totalAmount: 30 }),
    ];

    expect(groupBySubmitterWithTotals(rows).map((group) => group.submitter)).toEqual([
      "Bravo",
      "Charlie",
    ]);
  });

  it("keeps submitters with the same name but different emails separate", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", submitter: "Dup Name", submitterEmail: "one@x.com", totalAmount: 40 }),
      row({ id: "2", submitter: "Dup Name", submitterEmail: "two@x.com", totalAmount: 10 }),
    ];

    const groups = groupBySubmitterWithTotals(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      submitter: "Dup Name",
      submitterEmail: "one@x.com",
      total: 40,
      claimCount: 1,
    });
  });

  it("returns an empty array for no rows", () => {
    expect(groupBySubmitterWithTotals([])).toEqual([]);
  });
});
