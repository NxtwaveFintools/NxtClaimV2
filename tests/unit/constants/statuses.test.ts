import {
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
});
