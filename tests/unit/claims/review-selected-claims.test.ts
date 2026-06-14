import {
  groupByCategory,
  groupBySubmitterWithTotals,
  groupSubmittersByDetailType,
  type ReviewClaimRow,
} from "@/modules/claims/utils/review-selected-claims";

function row(overrides: Partial<ReviewClaimRow>): ReviewClaimRow {
  return {
    id: "claim-1",
    submitter: "Alice",
    submitterEmail: "alice@example.com",
    categoryName: "Food",
    detailType: "expense",
    totalAmount: 100,
    ...overrides,
  };
}

describe("groupByCategory", () => {
  it("sums expense amounts per category", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", categoryName: "Food", totalAmount: 650 }),
      row({ id: "2", categoryName: "Food", totalAmount: 145 }),
      row({ id: "3", categoryName: "Travel Domestic", totalAmount: 200 }),
    ];

    expect(groupByCategory(rows)).toEqual([
      { category: "Food", total: 795 },
      { category: "Travel Domestic", total: 200 },
    ]);
  });

  it("orders categories by total descending", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", categoryName: "Travel Domestic", totalAmount: 500 }),
      row({ id: "2", categoryName: "Food", totalAmount: 100 }),
      row({ id: "3", categoryName: "Marketing", totalAmount: 300 }),
    ];

    expect(groupByCategory(rows).map((datum) => datum.category)).toEqual([
      "Travel Domestic",
      "Marketing",
      "Food",
    ]);
  });

  it("excludes advance claims and their amounts from the chart", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", categoryName: "Food", detailType: "expense", totalAmount: 100 }),
      row({ id: "2", categoryName: "Advance", detailType: "advance", totalAmount: 9999 }),
    ];

    expect(groupByCategory(rows)).toEqual([{ category: "Food", total: 100 }]);
  });

  it("returns an empty array for no rows", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("groupBySubmitterWithTotals", () => {
  it("sums a submitter's claims into a single row (10 + 20 = 30)", () => {
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

  it("returns an empty array for no rows", () => {
    expect(groupBySubmitterWithTotals([])).toEqual([]);
  });
});

describe("groupSubmittersByDetailType", () => {
  it("divides claims into expense and advance buckets, each grouped + summed per submitter", () => {
    const rows: ReviewClaimRow[] = [
      row({
        id: "1",
        submitter: "User A",
        submitterEmail: "a@x.com",
        detailType: "expense",
        totalAmount: 10,
      }),
      row({
        id: "2",
        submitter: "User A",
        submitterEmail: "a@x.com",
        detailType: "expense",
        totalAmount: 20,
      }),
      row({
        id: "3",
        submitter: "User B",
        submitterEmail: "b@x.com",
        detailType: "expense",
        totalAmount: 50,
      }),
      row({
        id: "4",
        submitter: "User A",
        submitterEmail: "a@x.com",
        detailType: "advance",
        totalAmount: 5,
      }),
    ];

    expect(groupSubmittersByDetailType(rows)).toEqual({
      expense: [
        { submitter: "User B", submitterEmail: "b@x.com", total: 50, claimCount: 1 },
        { submitter: "User A", submitterEmail: "a@x.com", total: 30, claimCount: 2 },
      ],
      advance: [{ submitter: "User A", submitterEmail: "a@x.com", total: 5, claimCount: 1 }],
    });
  });

  it("returns empty buckets when a detail type is absent", () => {
    const rows: ReviewClaimRow[] = [row({ id: "1", detailType: "expense", totalAmount: 100 })];

    expect(groupSubmittersByDetailType(rows)).toEqual({
      expense: [
        { submitter: "Alice", submitterEmail: "alice@example.com", total: 100, claimCount: 1 },
      ],
      advance: [],
    });
  });
});
