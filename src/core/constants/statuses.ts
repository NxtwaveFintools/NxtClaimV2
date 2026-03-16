export const CLAIM_STATUSES = ["Submitted", "Pending", "Approved", "Rejected"] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const DB_CLAIM_STATUSES = [
  "Submitted - Awaiting HOD approval",
  "HOD approved - Awaiting finance approval",
  "Finance Approved - Payment under process",
  "Payment Done - Closed",
  "Rejected",
] as const;

export type DbClaimStatus = (typeof DB_CLAIM_STATUSES)[number];

export function mapDbClaimStatusToCanonical(status: DbClaimStatus): ClaimStatus {
  switch (status) {
    case "Submitted - Awaiting HOD approval":
      return "Submitted";
    case "HOD approved - Awaiting finance approval":
      return "Pending";
    case "Finance Approved - Payment under process":
    case "Payment Done - Closed":
      return "Approved";
    case "Rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

export function mapCanonicalStatusToDbStatuses(status: ClaimStatus): DbClaimStatus[] {
  switch (status) {
    case "Submitted":
      return ["Submitted - Awaiting HOD approval"];
    case "Pending":
      return ["HOD approved - Awaiting finance approval"];
    case "Approved":
      return ["Finance Approved - Payment under process", "Payment Done - Closed"];
    case "Rejected":
      return ["Rejected"];
    default:
      return [];
  }
}
