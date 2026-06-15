import {
  groupBySubmitterWithTotals,
  groupSubmittersByDetailType,
  type ReviewClaimRow,
} from "@/modules/claims/utils/review-selected-claims";

function row(overrides: Partial<ReviewClaimRow>): ReviewClaimRow {
  return {
    id: "claim-1",
    submitter: "Alice",
    submitterEmail: "alice@example.com",
    onBehalfEmail: null,
    categoryName: "Food",
    detailType: "expense",
    totalAmount: 100,
    ...overrides,
  };
}

describe("groupBySubmitterWithTotals", () => {
  it("sums a submitter's claims (10 + 20 = 30) and lists distinct categories", () => {
    const rows: ReviewClaimRow[] = [
      row({
        id: "1",
        submitter: "User A",
        submitterEmail: "a@x.com",
        categoryName: "Food",
        totalAmount: 10,
      }),
      row({
        id: "2",
        submitter: "User A",
        submitterEmail: "a@x.com",
        categoryName: "Travel Domestic",
        totalAmount: 20,
      }),
    ];

    expect(groupBySubmitterWithTotals(rows)).toEqual([
      {
        submitter: "User A",
        submitterEmail: "a@x.com",
        total: 30,
        claimCount: 2,
        categories: "Food, Travel Domestic",
      },
    ]);
  });

  it("de-duplicates repeated categories for a submitter", () => {
    const rows: ReviewClaimRow[] = [
      row({
        id: "1",
        submitter: "User A",
        submitterEmail: "a@x.com",
        categoryName: "Food",
        totalAmount: 10,
      }),
      row({
        id: "2",
        submitter: "User A",
        submitterEmail: "a@x.com",
        categoryName: "Food",
        totalAmount: 20,
      }),
    ];

    expect(groupBySubmitterWithTotals(rows)[0].categories).toBe("Food");
  });

  it("sorts grouped submitters by summed total, highest first", () => {
    const rows: ReviewClaimRow[] = [
      row({ id: "1", submitter: "User A", submitterEmail: "a@x.com", totalAmount: 10 }),
      row({ id: "2", submitter: "User A", submitterEmail: "a@x.com", totalAmount: 20 }),
      row({ id: "3", submitter: "User B", submitterEmail: "b@x.com", totalAmount: 50 }),
    ];

    expect(groupBySubmitterWithTotals(rows).map((group) => group.submitter)).toEqual([
      "User B",
      "User A",
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

  it("groups on-behalf claims under the beneficiary, not the submitter", () => {
    const rows: ReviewClaimRow[] = [
      row({
        id: "1",
        submitter: "Assistant",
        submitterEmail: "assistant@x.com",
        onBehalfEmail: "manager@x.com",
        totalAmount: 200,
      }),
    ];

    const result = groupBySubmitterWithTotals(rows);
    expect(result).toHaveLength(1);
    expect(result[0].submitter).toBe("manager@x.com");
    expect(result[0].submitterEmail).toBe("manager@x.com");
    expect(result[0].total).toBe(200);
  });

  it("falls back to submitter when onBehalfEmail is null", () => {
    const rows: ReviewClaimRow[] = [
      row({
        id: "1",
        submitter: "Alice",
        submitterEmail: "alice@x.com",
        onBehalfEmail: null,
        totalAmount: 150,
      }),
    ];

    const result = groupBySubmitterWithTotals(rows);
    expect(result).toHaveLength(1);
    expect(result[0].submitter).toBe("Alice");
    expect(result[0].submitterEmail).toBe("alice@x.com");
  });
});

describe("groupSubmittersByDetailType", () => {
  it("divides claims into expense and advance buckets, each summed per submitter with categories", () => {
    const rows: ReviewClaimRow[] = [
      row({
        id: "1",
        submitter: "User A",
        submitterEmail: "a@x.com",
        detailType: "expense",
        categoryName: "Food",
        totalAmount: 10,
      }),
      row({
        id: "2",
        submitter: "User A",
        submitterEmail: "a@x.com",
        detailType: "expense",
        categoryName: "Travel Domestic",
        totalAmount: 20,
      }),
      row({
        id: "3",
        submitter: "User B",
        submitterEmail: "b@x.com",
        detailType: "expense",
        categoryName: "Food",
        totalAmount: 50,
      }),
      row({
        id: "4",
        submitter: "User A",
        submitterEmail: "a@x.com",
        detailType: "advance",
        categoryName: "Advance",
        totalAmount: 5,
      }),
    ];

    expect(groupSubmittersByDetailType(rows)).toEqual({
      expense: [
        {
          submitter: "User B",
          submitterEmail: "b@x.com",
          total: 50,
          claimCount: 1,
          categories: "Food",
        },
        {
          submitter: "User A",
          submitterEmail: "a@x.com",
          total: 30,
          claimCount: 2,
          categories: "Food, Travel Domestic",
        },
      ],
      advance: [
        {
          submitter: "User A",
          submitterEmail: "a@x.com",
          total: 5,
          claimCount: 1,
          categories: "Advance",
        },
      ],
    });
  });

  it("returns empty buckets when a detail type is absent", () => {
    const rows: ReviewClaimRow[] = [row({ id: "1", detailType: "expense", totalAmount: 100 })];

    expect(groupSubmittersByDetailType(rows)).toEqual({
      expense: [
        {
          submitter: "Alice",
          submitterEmail: "alice@example.com",
          total: 100,
          claimCount: 1,
          categories: "Food",
        },
      ],
      advance: [],
    });
  });
});
