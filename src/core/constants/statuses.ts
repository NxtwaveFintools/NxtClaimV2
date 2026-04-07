export const CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS = "Rejected - Resubmission Not Allowed";
export const CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS = "Rejected - Resubmission Allowed";

export const CLAIM_STATUSES = [
  "Submitted",
  "Pending",
  "Approved",
  CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS,
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS = "Rejected - Resubmission Not Allowed";
export const DB_REJECTED_RESUBMISSION_ALLOWED_STATUS = "Rejected - Resubmission Allowed";
export const DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS = "Submitted - Awaiting HOD approval";
export const DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS =
  "HOD approved - Awaiting finance approval";
export const DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS =
  "Finance Approved - Payment under process";
export const DB_PAYMENT_DONE_CLOSED_STATUS = "Payment Done - Closed";

export const DB_REJECTED_STATUSES = [
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
] as const;

export const DB_SUBMITTER_DELETABLE_CLAIM_STATUSES = [
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
] as const;

export const DB_CLAIM_STATUSES = [
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
] as const;

export type DbClaimStatus = (typeof DB_CLAIM_STATUSES)[number];

export function mapDbClaimStatusToCanonical(status: DbClaimStatus): ClaimStatus {
  switch (status) {
    case DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS:
      return "Submitted";
    case DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS:
      return "Pending";
    case DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS:
    case DB_PAYMENT_DONE_CLOSED_STATUS:
      return "Approved";
    case DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS:
      return CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS;
    case DB_REJECTED_RESUBMISSION_ALLOWED_STATUS:
      return CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS;
    default:
      return "Pending";
  }
}

export function mapCanonicalStatusToDbStatuses(status: ClaimStatus): DbClaimStatus[] {
  switch (status) {
    case "Submitted":
      return [DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS];
    case "Pending":
      return [DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS];
    case "Approved":
      return [DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS, DB_PAYMENT_DONE_CLOSED_STATUS];
    case CLAIM_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS:
      return [DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS];
    case CLAIM_REJECTED_RESUBMISSION_ALLOWED_STATUS:
      return [DB_REJECTED_RESUBMISSION_ALLOWED_STATUS];
    default:
      return [];
  }
}

export function isPendingFinanceApprovalStatus(status: DbClaimStatus): boolean {
  return status === DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS;
}

export function isSubmitterDeletableClaimStatus(status: DbClaimStatus): boolean {
  return DB_SUBMITTER_DELETABLE_CLAIM_STATUSES.some((candidate) => candidate === status);
}
