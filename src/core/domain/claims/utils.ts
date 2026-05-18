/**
 * Domain helpers for `claims` records.
 *
 * `bcClaimDetailsId` (FK to bc_claim_details) is the canonical signal that a
 * claim has been successfully submitted to Business Central. App code that
 * needs a boolean ("has this claim been BC-submitted?") should call this
 * helper rather than re-deriving `claim.bcClaimDetailsId != null` inline.
 */
export function isBcSubmitted(claim: { bcClaimDetailsId: string | null }): boolean {
  return claim.bcClaimDetailsId !== null;
}
