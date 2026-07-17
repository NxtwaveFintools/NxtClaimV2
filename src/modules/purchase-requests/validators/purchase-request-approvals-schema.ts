import { z } from "zod";

// pr_id is intentionally NOT part of a URL path -- real pr_id values (e.g.
// "PR/2627/00000257") contain slashes, which would break path-based routing.
// It's a body field instead, same as every other field here.
export const REQUIRED_APPROVALS_FIELDS = ["pr_id"] as const;

const APPROVAL_UPDATABLE_FIELDS = [
  "created_by",
  "sequence_1_approval",
  "sequence_2_approval",
  "sequence_3_approval",
  "sequence_4_approval",
  "sequence_5_approval",
] as const;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Returns missing required fields, plus a synthetic "no updatable fields" marker if pr_id is the only thing sent. */
export function findMissingApprovalsFields(body: Record<string, unknown>): string[] {
  const missing: string[] = [];

  for (const field of REQUIRED_APPROVALS_FIELDS) {
    if (!isPresent(body[field])) {
      missing.push(field);
    }
  }

  return missing;
}

export function hasAnyUpdatableApprovalField(body: Record<string, unknown>): boolean {
  return APPROVAL_UPDATABLE_FIELDS.some((field) => isPresent(body[field]));
}

export const purchaseRequestApprovalsBodySchema = z.object({
  pr_id: z.string().trim().min(1),
  created_by: z.string().trim().min(1).optional().nullable(),
  sequence_1_approval: z.string().trim().min(1).optional().nullable(),
  sequence_2_approval: z.string().trim().min(1).optional().nullable(),
  sequence_3_approval: z.string().trim().min(1).optional().nullable(),
  sequence_4_approval: z.string().trim().min(1).optional().nullable(),
  sequence_5_approval: z.string().trim().min(1).optional().nullable(),
});

export type PurchaseRequestApprovalsBody = z.infer<typeof purchaseRequestApprovalsBodySchema>;
