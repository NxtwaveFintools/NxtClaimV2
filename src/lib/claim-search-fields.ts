import type { ClaimSearchField } from "@/core/domain/claims/contracts";

const VALID_CLAIM_SEARCH_FIELDS = new Set<string>([
  "claim_id",
  "employee_name",
  "employee_id",
  "employee_email",
  "bill_no",
]);

export function isValidClaimSearchField(value: string | undefined): value is ClaimSearchField {
  return typeof value === "string" && VALID_CLAIM_SEARCH_FIELDS.has(value);
}
