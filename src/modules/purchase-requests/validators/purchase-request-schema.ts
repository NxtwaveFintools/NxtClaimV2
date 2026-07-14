import { z } from "zod";

export const PR_TYPES = ["Invoice", "Quotation"] as const;
export const GST_PERCENTAGES = [5, 12, 18, 28] as const;

// Section 3 of the spec lists required fields but omits request_date, vendor_code,
// and vendor_name, while section 7's DB schema marks all three NOT NULL. Treated as
// required here so a missing value fails validation with a clear 400 instead of a
// DB constraint error.
export const REQUIRED_TOP_LEVEL_FIELDS = [
  "pr_id",
  "request_date",
  "vendor_code",
  "vendor_name",
  "vendor_gstin",
  "company_gstin",
  "pr_type",
  "vendor_invoice_number",
  "document_date",
  "direct_unit_cost",
  "gst_percentage",
  "gst_amount",
  "purchase_request_amount",
  "description",
  "attachments",
] as const;

const REQUIRED_ATTACHMENT_FIELDS = ["file_name", "content_type", "base64"] as const;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Returns dotted/indexed field names (e.g. "attachments[0].base64") missing from the raw request body. */
export function findMissingRequiredFields(body: Record<string, unknown>): string[] {
  const missing: string[] = [];

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!isPresent(body[field])) {
      missing.push(field);
    }
  }

  const attachments = body.attachments;
  if (Array.isArray(attachments)) {
    attachments.forEach((attachment, index) => {
      if (typeof attachment !== "object" || attachment === null) {
        missing.push(`attachments[${index}]`);
        return;
      }
      const attachmentRecord = attachment as Record<string, unknown>;
      for (const field of REQUIRED_ATTACHMENT_FIELDS) {
        if (!isPresent(attachmentRecord[field])) {
          missing.push(`attachments[${index}].${field}`);
        }
      }
    });
  }

  return missing;
}

export function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD).");

const attachmentSchema = z.object({
  file_name: z.string().trim().min(1),
  content_type: z.string().trim().min(1),
  base64: z.string().trim().refine(isValidBase64, "Must be a valid base64 string."),
});

export const purchaseRequestBodySchema = z.object({
  pr_id: z.string().trim().min(1),
  request_date: isoDateSchema,
  vendor_code: z.string().trim().min(1),
  vendor_name: z.string().trim().min(1),
  vendor_gstin: z.string().trim().min(1),
  company_gstin: z.string().trim().min(1),
  department: z.string().trim().optional().nullable(),
  pr_type: z.enum(PR_TYPES),
  vendor_invoice_number: z.string().trim().min(1),
  document_date: isoDateSchema,
  direct_unit_cost: z.number(),
  gst_percentage: z.union([z.literal(5), z.literal(12), z.literal(18), z.literal(28)]),
  gst_amount: z.number(),
  purchase_request_amount: z.number(),
  description: z.string().trim().min(10),
  bank_account_number: z.string().trim().optional().nullable(),
  bank_ifsc: z.string().trim().optional().nullable(),
  bank_name: z.string().trim().optional().nullable(),
  attachments: z.array(attachmentSchema).min(1, "At least one attachment is required."),
});

export type PurchaseRequestBody = z.infer<typeof purchaseRequestBodySchema>;

export function isSupportedAttachmentContentType(contentType: string): boolean {
  // MIME types are case-insensitive per RFC 2045 -- normalize before comparing so
  // e.g. "APPLICATION/PDF" or "Image/Jpeg" aren't rejected as unsupported.
  const normalized = contentType.toLowerCase();
  return normalized === "application/pdf" || normalized.startsWith("image/");
}
