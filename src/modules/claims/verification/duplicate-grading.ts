export type DuplicateArmStatus = "none" | "match" | "unavailable";
export type DuplicateArm = { status: DuplicateArmStatus; claimIds: string[] };

/**
 * Grades the two independent duplicate arms from the find_claim_duplicates rows.
 * - invoiceUnavailable: the claim has an invoice number but the AI could not extract one.
 * - amountDateAvailable: both transaction date AND total amount are present.
 */
export function gradeDuplicateArms(
  rows: { claim_id: string; match_kind: string }[],
  flags: { invoiceUnavailable: boolean; amountDateAvailable: boolean },
): { invoice: DuplicateArm; amountDate: DuplicateArm } {
  const invoiceIds = rows.filter((r) => r.match_kind === "invoice_match").map((r) => r.claim_id);
  const amountDateIds = rows
    .filter((r) => r.match_kind === "amount_date_match")
    .map((r) => r.claim_id);

  const invoice: DuplicateArm = flags.invoiceUnavailable
    ? { status: "unavailable", claimIds: [] }
    : invoiceIds.length > 0
      ? { status: "match", claimIds: invoiceIds }
      : { status: "none", claimIds: [] };

  const amountDate: DuplicateArm = !flags.amountDateAvailable
    ? { status: "unavailable", claimIds: [] }
    : amountDateIds.length > 0
      ? { status: "match", claimIds: amountDateIds }
      : { status: "none", claimIds: [] };

  return { invoice, amountDate };
}
