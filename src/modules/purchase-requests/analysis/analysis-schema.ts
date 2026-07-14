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

// Every PR analysis must report exactly these 17 named checks (VC-01..VC-17
// from the system prompt) -- enforced by both the JSON schema (minItems/
// maxItems) and this zod schema (.length(17)) as defense in depth, mirroring
// how parse-receipt.ts double-validates Gemini's structured output.
export const FIELD_VALIDATIONS_COUNT = 17;

// Standard JSON Schema for Gemini constrained decoding (google/genai
// responseJsonSchema). analysis_id and pr_id are NOT requested here -- the
// model can't reliably generate a globally unique sequenced ID, so the
// service generates analysis_id itself and already knows pr_id from input.
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
      minItems: FIELD_VALIDATIONS_COUNT,
      maxItems: FIELD_VALIDATIONS_COUNT,
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
  field_validations: z.array(fieldValidationSchema).length(FIELD_VALIDATIONS_COUNT),
  remarks: z.string(),
});

export type PrAnalysisResponse = z.infer<typeof prAnalysisResponseSchema>;

// Canonical 17 check names + severities, exactly as shown in the system prompt's
// worked example output (the check catalog's prose labels differ slightly, e.g.
// "Document Number Match" vs the example's "Vendor Invoice Number Match" -- the
// example is authoritative since it's the literal expected check_name string).
// Used to build a synthetic result when a PR has no attachments at all (skips
// the Gemini call entirely rather than spending it on a foregone conclusion).
export const PR_ANALYSIS_CHECK_NAMES: ReadonlyArray<{
  checkName: string;
  severity: (typeof SEVERITIES)[number];
}> = [
  { checkName: "PR Type Match", severity: "hard_block" },
  { checkName: "Vendor Invoice Number Match", severity: "hard_block" },
  { checkName: "Document Date Match", severity: "hard_block" },
  { checkName: "Taxable Amount Match", severity: "hard_block" },
  { checkName: "GST Amount Match", severity: "hard_block" },
  { checkName: "GST Percentage Match", severity: "hard_block" },
  { checkName: "GST Computed Check", severity: "warning" },
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
