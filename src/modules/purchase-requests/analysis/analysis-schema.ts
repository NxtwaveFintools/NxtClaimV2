import { z } from "zod";

// No 'statement_mismatch': bank-detail checks (VC-12/13/14/15) are warning-severity
// and must behave like every other warning (GST computed check, description keyword
// match) -- flagged in field_validations, never escalating overall_status on their
// own. A bank mismatch alone still results in "verified" if all hard blocks pass.
export const OVERALL_STATUSES = [
  "verified",
  "needs_review",
  "mismatch",
  "extraction_failed",
  "no_document",
] as const;

export const VALIDATION_RESULTS = ["match_success", "minor_variance", "mismatch"] as const;
export const SEVERITIES = ["hard_block", "warning"] as const;

// The original 17-check catalog's VC-04 (Taxable Amount), VC-05 (GST Amount),
// VC-06 (GST Percentage), and VC-07 (GST Computed Check) assumed one flat PR with
// no line items. Now that amount/GST data lives per-line (purchase_request_lines),
// those 4 checks are replaced by an equivalent set repeated PER LINE, matched by
// position against the invoice's line-items table. Every analysis must report
// exactly FIXED_CHECK_NAMES.length + PER_LINE_CHECK_TEMPLATES.length * lineCount
// checks -- enforced by both the JSON schema (minItems/maxItems, built per-call
// once the line count is known) and a post-parse exact-count check in
// analyze-purchase-request.ts (the zod schema itself can't express a dynamic
// length, so it only floors at FIXED_CHECK_NAMES.length).
export const FIXED_CHECK_NAMES: ReadonlyArray<{
  checkName: string;
  severity: (typeof SEVERITIES)[number];
}> = [
  { checkName: "PR Type Match", severity: "hard_block" },
  { checkName: "Vendor Invoice Number Match", severity: "hard_block" },
  { checkName: "Document Date Match", severity: "hard_block" },
  { checkName: "Vendor GSTIN Match", severity: "hard_block" },
  { checkName: "Company GSTIN Match", severity: "hard_block" },
  { checkName: "GSTIN Format Check", severity: "hard_block" },
  { checkName: "Total Amount Match", severity: "hard_block" },
  { checkName: "Bank Account Match", severity: "warning" },
  { checkName: "IFSC Code Match", severity: "warning" },
  { checkName: "Bank Name Match", severity: "warning" },
  { checkName: "Bank Details Absent", severity: "warning" },
  { checkName: "Description Length Check", severity: "hard_block" },
  { checkName: "Description Keyword Match", severity: "warning" },
];

// Applied once per PR line, in this order, with "Line {n}: " prefixed onto
// checkName (n is 1-based, matching lines[].line_no as submitted).
export const PER_LINE_CHECK_TEMPLATES: ReadonlyArray<{
  checkName: string;
  severity: (typeof SEVERITIES)[number];
}> = [
  { checkName: "Unit Cost Match", severity: "hard_block" },
  { checkName: "Taxable Amount Match", severity: "hard_block" },
  { checkName: "CGST Percentage Match", severity: "hard_block" },
  { checkName: "CGST Amount Match", severity: "hard_block" },
  { checkName: "SGST Percentage Match", severity: "hard_block" },
  { checkName: "SGST Amount Match", severity: "hard_block" },
  { checkName: "IGST Percentage Match", severity: "hard_block" },
  { checkName: "IGST Amount Match", severity: "hard_block" },
];

export function buildPerLineCheckNames(
  lineNo: number,
): Array<{ checkName: string; severity: (typeof SEVERITIES)[number] }> {
  return PER_LINE_CHECK_TEMPLATES.map((template) => ({
    checkName: `Line ${lineNo}: ${template.checkName}`,
    severity: template.severity,
  }));
}

export function getExpectedFieldValidationsCount(lineCount: number): number {
  return FIXED_CHECK_NAMES.length + PER_LINE_CHECK_TEMPLATES.length * lineCount;
}

/** Full {checkName, severity} list for a PR with the given line count, in the order Gemini should report them. */
export function buildAllCheckNames(
  lineNumbers: number[],
): Array<{ checkName: string; severity: (typeof SEVERITIES)[number] }> {
  return [...FIXED_CHECK_NAMES, ...lineNumbers.flatMap((lineNo) => buildPerLineCheckNames(lineNo))];
}

// Standard JSON Schema for Gemini constrained decoding (google/genai
// responseJsonSchema). analysis_id and pr_id are NOT requested here -- the
// model can't reliably generate a globally unique sequenced ID, so the
// service generates analysis_id itself and already knows pr_id from input.
// Not parameterized by line count: field_validations' exact length can't be
// pinned via minItems/maxItems (see the comment on that property below), so
// this schema is identical regardless of how many lines a given PR has.
export const PR_ANALYSIS_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    overall_status: { type: "string", enum: [...OVERALL_STATUSES] },
    confidence_score: { type: "number", description: "0-100, rounded to 1 decimal" },
    document_summary: { type: "string" },
    analyzed_file_name: {
      type: ["string", "null"],
      description:
        "Exact file_name of the single attachment used for validation, or null if none qualified (overall_status must then be no_document or extraction_failed).",
    },
    field_validations: {
      type: "array",
      // Deliberately NOT pinning minItems/maxItems to an exact count here --
      // Gemini's constrained-decoding schema compiler rejects the request
      // outright ("too many states for serving") once a pinned exact length
      // gets large enough (confirmed failing at 21; 17 was fine). The exact
      // count is instead communicated via the prompt text (very explicit,
      // repeated in the per-call addendum) and enforced with a hard
      // post-parse check in analyze-purchase-request.ts.
      minItems: 1,
      items: {
        type: "object",
        properties: {
          check_name: { type: "string" },
          submitted_value: { type: "string" },
          extracted_value: { type: "string" },
          validation_result: { type: "string", enum: [...VALIDATION_RESULTS] },
          severity: { type: "string", enum: [...SEVERITIES] },
          confidence: { type: "number" },
        },
        required: [
          "check_name",
          "submitted_value",
          "extracted_value",
          "validation_result",
          "severity",
          "confidence",
        ],
      },
    },
    remarks: { type: "string" },
  },
  required: [
    "overall_status",
    "confidence_score",
    "document_summary",
    "analyzed_file_name",
    "field_validations",
    "remarks",
  ],
} as const;

const fieldValidationSchema = z.object({
  check_name: z.string(),
  submitted_value: z.string(),
  extracted_value: z.string(),
  validation_result: z.enum(VALIDATION_RESULTS),
  severity: z.enum(SEVERITIES),
  confidence: z.number(),
});

export const prAnalysisResponseSchema = z.object({
  overall_status: z.enum(OVERALL_STATUSES),
  confidence_score: z.number().min(0).max(100),
  document_summary: z.string(),
  analyzed_file_name: z.string().nullable(),
  // Exact count depends on this PR's line count (unknown to a static zod schema)
  // -- floored at the fixed-check count here; analyze-purchase-request.ts does
  // the real exact-count check once it knows how many lines this PR has.
  field_validations: z.array(fieldValidationSchema).min(FIXED_CHECK_NAMES.length),
  remarks: z.string(),
});

export type PrAnalysisResponse = z.infer<typeof prAnalysisResponseSchema>;
