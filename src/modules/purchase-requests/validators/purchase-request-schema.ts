import { z } from "zod";

export const PR_TYPES = ["Invoice", "Quotation"] as const;
export const GST_PERCENTAGES = [5, 12, 18, 28] as const;

// Section 3 of the spec lists required fields but omits request_date, vendor_code,
// and vendor_name, while section 7's DB schema marks all three NOT NULL. Treated as
// required here so a missing value fails validation with a clear 400 instead of a
// DB constraint error.
//
// direct_unit_cost/purchase_request_amount are intentionally absent here -- BC's
// newer spec renamed them (direct_unit_cost_excl_vat/purchase_requisition_amount).
// Either name satisfies "required"; see ALIASED_REQUIRED_FIELD_PAIRS below.
export const REQUIRED_TOP_LEVEL_FIELDS = [
  "pr_id",
  "request_date",
  "vendor_code",
  "vendor_name",
  "vendor_gstin",
  "company_gstin",
  "department",
  "pr_type",
  "vendor_invoice_number",
  "document_date",
  "gst_percentage",
  "gst_amount",
  "description",
  "service_start_date",
  "service_end_date",
  "budget_period",
  "pos_as_in_vendor_state",
  "total_amount_including_gst",
  "attachments",
  "lines",
] as const;

// Fields BC's newer spec renamed -- the old name still works, but so does the new one.
const ALIASED_REQUIRED_FIELD_PAIRS = [
  { canonical: "direct_unit_cost", alias: "direct_unit_cost_excl_vat" },
  { canonical: "purchase_request_amount", alias: "purchase_requisition_amount" },
] as const;

const REQUIRED_ATTACHMENT_FIELDS = ["file_name", "content_type", "base64"] as const;
const REQUIRED_LINE_FIELDS = ["line_no", "description"] as const;

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

  for (const { canonical, alias } of ALIASED_REQUIRED_FIELD_PAIRS) {
    if (!isPresent(body[canonical]) && !isPresent(body[alias])) {
      missing.push(canonical);
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

  const lines = body.lines;
  if (Array.isArray(lines)) {
    lines.forEach((line, index) => {
      if (typeof line !== "object" || line === null) {
        missing.push(`lines[${index}]`);
        return;
      }
      const lineRecord = line as Record<string, unknown>;
      for (const field of REQUIRED_LINE_FIELDS) {
        if (!isPresent(lineRecord[field])) {
          missing.push(`lines[${index}].${field}`);
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

const lineItemSchema = z.object({
  line_no: z.number().int().positive(),
  description: z.string().trim().min(1),
  gst_group_code: z.string().trim().optional().nullable(),
  program_code: z.string().trim().optional().nullable(),
  responsible_dept: z.string().trim().optional().nullable(),
  beneficiary_code: z.string().trim().optional().nullable(),
  region_code: z.string().trim().optional().nullable(),
  subproduct: z.string().trim().optional().nullable(),
  qty: z.number().positive().optional().nullable(),
  direct_unit_cost_excl_vat: z.number().positive().optional().nullable(),
  line_amount_excluding_vat: z.number().positive().optional().nullable(),
});

export const purchaseRequestBodySchema = z
  .object({
    pr_id: z.string().trim().min(1),
    request_date: isoDateSchema,
    vendor_code: z.string().trim().min(1),
    vendor_name: z.string().trim().min(1),
    vendor_gstin: z.string().trim().min(1),
    company_gstin: z.string().trim().min(1),
    department: z.string().trim().min(1),
    pr_type: z.enum(PR_TYPES),
    vendor_invoice_number: z.string().trim().min(1),
    document_date: isoDateSchema,
    direct_unit_cost: z.number().optional(),
    direct_unit_cost_excl_vat: z.number().optional(),
    gst_percentage: z.union([z.literal(5), z.literal(12), z.literal(18), z.literal(28)]),
    gst_amount: z.number(),
    purchase_request_amount: z.number().optional(),
    purchase_requisition_amount: z.number().optional(),
    description: z.string().trim().min(10),
    bank_account_number: z.string().trim().optional().nullable(),
    bank_ifsc: z.string().trim().optional().nullable(),
    bank_name: z.string().trim().optional().nullable(),
    service_start_date: isoDateSchema,
    service_end_date: isoDateSchema,
    budget_period: z.string().trim().min(1),
    pos_as_in_vendor_state: z.boolean(),
    total_amount_including_gst: z.number(),
    cgst_percentage: z.number().optional().nullable(),
    cgst_amount: z.number().optional().nullable(),
    sgst_percentage: z.number().optional().nullable(),
    sgst_amount: z.number().optional().nullable(),
    igst_percentage: z.number().optional().nullable(),
    igst_amount: z.number().optional().nullable(),
    fixed_asset_description: z.string().trim().optional().nullable(),
    fixed_asset_fa_class_code: z.string().trim().optional().nullable(),
    fixed_asset_fa_subclass_code: z.string().trim().optional().nullable(),
    depreciation_start_date: isoDateSchema.optional().nullable(),
    depreciation_end_date: isoDateSchema.optional().nullable(),
    no_of_depreciation_years: z.number().int().min(1).max(50).optional().nullable(),
    attachments: z.array(attachmentSchema).min(1, "At least one attachment is required."),
    lines: z.array(lineItemSchema).min(1, "At least one line item is required."),
  })
  .superRefine((data, ctx) => {
    if (data.direct_unit_cost === undefined && data.direct_unit_cost_excl_vat === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Either direct_unit_cost or direct_unit_cost_excl_vat is required.",
        path: ["direct_unit_cost"],
      });
    }
    if (
      data.purchase_request_amount === undefined &&
      data.purchase_requisition_amount === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Either purchase_request_amount or purchase_requisition_amount is required.",
        path: ["purchase_request_amount"],
      });
    }
    if (
      data.service_start_date &&
      data.service_end_date &&
      data.service_start_date > data.service_end_date
    ) {
      ctx.addIssue({
        code: "custom",
        message: "service_start_date must be on or before service_end_date.",
        path: ["service_end_date"],
      });
    }
    if (
      data.depreciation_start_date &&
      data.depreciation_end_date &&
      data.depreciation_start_date > data.depreciation_end_date
    ) {
      ctx.addIssue({
        code: "custom",
        message: "depreciation_start_date must be on or before depreciation_end_date.",
        path: ["depreciation_end_date"],
      });
    }

    const seenLineNumbers = new Set<number>();
    data.lines.forEach((line, index) => {
      if (seenLineNumbers.has(line.line_no)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate line_no ${line.line_no} -- must be unique per PR.`,
          path: ["lines", index, "line_no"],
        });
      }
      seenLineNumbers.add(line.line_no);
    });
  });

export type PurchaseRequestBody = z.infer<typeof purchaseRequestBodySchema>;

export function isSupportedAttachmentContentType(contentType: string): boolean {
  // MIME types are case-insensitive per RFC 2045 -- normalize before comparing so
  // e.g. "APPLICATION/PDF" or "Image/Jpeg" aren't rejected as unsupported.
  const normalized = contentType.toLowerCase();
  return normalized === "application/pdf" || normalized.startsWith("image/");
}
