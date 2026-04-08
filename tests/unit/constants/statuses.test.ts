import {
  DB_FINANCE_ACTIONABLE_STATUSES,
  DB_FINANCE_ANALYTICS_PIPELINE_STATUSES,
  DB_FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES,
  DB_FINANCE_NON_REJECTED_VISIBLE_STATUSES,
  DB_FINANCE_REJECTED_VISIBLE_STATUSES,
  DB_FINANCE_VISIBLE_STATUSES,
  mapCanonicalStatusToDbStatuses,
  mapDbClaimStatusToCanonical,
  type ClaimStatus,
  type DbClaimStatus,
} from "@/core/constants/statuses";

describe("claim statuses mapping", () => {
  test("maps every DB status to canonical status", () => {
    expect(mapDbClaimStatusToCanonical("Submitted - Awaiting HOD approval")).toBe("Submitted");
    expect(mapDbClaimStatusToCanonical("HOD approved - Awaiting finance approval")).toBe("Pending");
    expect(mapDbClaimStatusToCanonical("Finance Approved - Payment under process")).toBe(
      "Approved",
    );
    expect(mapDbClaimStatusToCanonical("Payment Done - Closed")).toBe("Approved");
    expect(mapDbClaimStatusToCanonical("Rejected - Resubmission Not Allowed")).toBe(
      "Rejected - Resubmission Not Allowed",
    );
    expect(mapDbClaimStatusToCanonical("Rejected - Resubmission Allowed")).toBe(
      "Rejected - Resubmission Allowed",
    );
  });

  test("maps every canonical status to DB statuses", () => {
    expect(mapCanonicalStatusToDbStatuses("Submitted")).toEqual([
      "Submitted - Awaiting HOD approval",
    ]);
    expect(mapCanonicalStatusToDbStatuses("Pending")).toEqual([
      "HOD approved - Awaiting finance approval",
    ]);
    expect(mapCanonicalStatusToDbStatuses("Approved")).toEqual([
      "Finance Approved - Payment under process",
      "Payment Done - Closed",
    ]);
    expect(mapCanonicalStatusToDbStatuses("Rejected - Resubmission Not Allowed")).toEqual([
      "Rejected - Resubmission Not Allowed",
    ]);
    expect(mapCanonicalStatusToDbStatuses("Rejected - Resubmission Allowed")).toEqual([
      "Rejected - Resubmission Allowed",
    ]);
  });

  test("keeps default fallbacks unreachable but safe", () => {
    expect(mapDbClaimStatusToCanonical("unexpected" as DbClaimStatus)).toBe("Pending");
    expect(mapCanonicalStatusToDbStatuses("unexpected" as ClaimStatus)).toEqual([]);
  });

  test("defines finance analytics and queue visibility groups with strict exclusions", () => {
    expect(DB_FINANCE_ANALYTICS_PIPELINE_STATUSES).toEqual([
      "Submitted - Awaiting HOD approval",
      "HOD approved - Awaiting finance approval",
      "Finance Approved - Payment under process",
      "Payment Done - Closed",
    ]);

    expect(DB_FINANCE_NON_REJECTED_VISIBLE_STATUSES).toEqual([
      "HOD approved - Awaiting finance approval",
      "Finance Approved - Payment under process",
      "Payment Done - Closed",
    ]);

    expect(DB_FINANCE_REJECTED_VISIBLE_STATUSES).toEqual(["Rejected - Resubmission Not Allowed"]);

    expect(DB_FINANCE_VISIBLE_STATUSES).toEqual([
      "HOD approved - Awaiting finance approval",
      "Finance Approved - Payment under process",
      "Payment Done - Closed",
      "Rejected - Resubmission Not Allowed",
    ]);

    expect(DB_FINANCE_ACTIONABLE_STATUSES).toEqual([
      "HOD approved - Awaiting finance approval",
      "Finance Approved - Payment under process",
    ]);

    expect(DB_FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES).toEqual([
      "Submitted - Awaiting HOD approval",
      "Rejected - Resubmission Allowed",
    ]);
  });
});
