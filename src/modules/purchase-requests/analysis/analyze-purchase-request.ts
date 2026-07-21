import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import {
  getExpectedFieldValidationsCount,
  PR_ANALYSIS_RESPONSE_JSON_SCHEMA,
  prAnalysisResponseSchema,
  type PrAnalysisResponse,
} from "@/modules/purchase-requests/analysis/analysis-schema";
import {
  buildPerLineMatchingAddendum,
  PR_ANALYSIS_SYSTEM_PROMPT,
} from "@/modules/purchase-requests/analysis/system-prompt";

const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_DELAY_MS = 1_000;

// Hardcoded, not sourced from serverEnv.GEMINI_MODEL -- that var is shared with
// receipt-parsing/bank-statement verification, which may need to move to a
// different Gemini version independently. Pinned here the same way the Finance
// Assistant chatbot pins its own CHAT_MODEL independently of this shared var.
// Switched from gemini-3.5-flash to gemini-2.5-flash: 3.5-flash returned sustained
// 503 "high demand" errors from Google for 25+ minutes during testing (2026-07-13).
export const PR_ANALYSIS_MODEL = "gemini-2.5-flash";

export type PrAnalysisInputAttachment = {
  fileName: string;
  contentType: string;
  buffer: Buffer;
};

export type PrAnalysisInputLine = {
  line_no: number;
  description: string;
  department: string;
  gst_percentage: number;
  gst_amount: number;
  gst_group_code: string | null;
  program_code: string | null;
  responsible_dept: string | null;
  beneficiary_code: string | null;
  region_code: string | null;
  subproduct: string | null;
  qty: number | null;
  direct_unit_cost_excl_vat: number | null;
  line_amount_excluding_vat: number | null;
  cgst_percentage: number | null;
  cgst_amount: number | null;
  sgst_percentage: number | null;
  sgst_amount: number | null;
  igst_percentage: number | null;
  igst_amount: number | null;
  fixed_asset_description: string | null;
  fixed_asset_fa_class_code: string | null;
  fixed_asset_fa_subclass_code: string | null;
  depreciation_start_date: string | null;
  no_of_depreciation_years: number | null;
  depreciation_end_date: string | null;
};

export type PrAnalysisInput = {
  prId: string;
  prData: {
    request_date: string;
    vendor_code: string;
    vendor_name: string;
    vendor_gstin: string;
    company_gstin: string;
    pr_type: "Invoice" | "Quotation";
    vendor_invoice_number: string;
    document_date: string;
    purchase_request_amount: number;
    // description used to be a header field VC-16/17 validate directly. It now
    // varies per line, so this is SYNTHESIZED (all line descriptions joined
    // together) in run-purchase-request-analysis.ts's buildPrData() -- taxable
    // amount/GST percentage/GST amount no longer need a header synthesis at all,
    // since VC-04/05/06/07 were replaced by per-line checks (see lines[] below).
    description: string;
    bank_account_number: string | null;
    bank_ifsc: string | null;
    bank_name: string | null;
    // Additional context fields (see system-prompt.ts "ADDITIONAL CONTEXT FIELDS") --
    // informational only, not part of the 17-check catalog.
    service_start_date: string | null;
    service_end_date: string | null;
    budget_period: string | null;
    pos_as_in_vendor_state: boolean | null;
    total_amount_including_gst: number | null;
    lines: PrAnalysisInputLine[];
  };
  attachments: PrAnalysisInputAttachment[];
};

export type PrAnalysisOutcome =
  | { ok: true; data: PrAnalysisResponse }
  | { ok: false; reason: "empty_response" | "invalid_json" }
  | { ok: false; reason: "schema_invalid"; error: z.ZodError };

function safeParseJSON(text: string): unknown | null {
  try {
    const cleanText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const match = cleanText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function waitForMilliseconds(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

const VALIDATION_RESULT_SORT_PRIORITY: Record<string, number> = {
  mismatch: 0,
  minor_variance: 1,
  match_success: 2,
};

/**
 * Deterministic backstop for the system prompt's "order failures first" instruction
 * -- an approver scanning field_validations should see what's wrong before scrolling
 * past everything that passed. Stable sort: order within each result group is
 * whatever the model returned (normally VC-01..VC-17 catalog order).
 */
function sortFieldValidationsByFailureFirst(response: PrAnalysisResponse): PrAnalysisResponse {
  return {
    ...response,
    field_validations: [...response.field_validations].sort(
      (a, b) =>
        VALIDATION_RESULT_SORT_PRIORITY[a.validation_result] -
        VALIDATION_RESULT_SORT_PRIORITY[b.validation_result],
    ),
  };
}

/**
 * Covers both a structured Gemini 503 ("high demand") response AND a bare
 * network-level failure -- Node's fetch throws a plain `TypeError: fetch failed`
 * (no .status, no "service unavailable" text) for connection resets/timeouts/DNS
 * blips reaching the API, which previously fell through untouched and failed the
 * whole run on the first transient network hiccup instead of retrying.
 */
function isRetryableGeminiError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const shape = error as { status?: number; statusText?: string; message?: string };
  if (shape.status === 503) return true;
  const text = `${shape.statusText ?? ""} ${shape.message ?? ""}`.toLowerCase();
  if (text.includes("service unavailable") || text.includes("unavailable")) return true;
  return shape.message === "fetch failed";
}

/**
 * Single Gemini call analyzing a PR's pr_data against all of its attachments in one
 * turn -- the model itself identifies which attachment is the invoice/quotation to
 * validate (see MULTI-ATTACHMENT HANDLING in the system prompt) rather than a
 * separate classification pass. No vendor_master/company_config: pr_data (what BC
 * submitted) is the only source of truth the document is checked against.
 */
export async function analyzePurchaseRequest(input: PrAnalysisInput): Promise<PrAnalysisOutcome> {
  const client = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });

  const lineCount = input.prData.lines.length;
  const expectedFieldValidationsCount = getExpectedFieldValidationsCount(lineCount);
  const systemInstruction = `${PR_ANALYSIS_SYSTEM_PROMPT}\n\n${buildPerLineMatchingAddendum(input.prData.lines)}`;

  const contextPayload = {
    pr_id: input.prId,
    pr_data: input.prData,
  };

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: JSON.stringify(contextPayload, null, 2) },
  ];

  for (const attachment of input.attachments) {
    parts.push({ text: `Attachment file_name: ${attachment.fileName}` });
    parts.push({
      inlineData: { mimeType: attachment.contentType, data: attachment.buffer.toString("base64") },
    });
  }

  let lastError: unknown = null;
  let modelText: string | undefined;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await client.models.generateContent({
        model: PR_ANALYSIS_MODEL,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction,
          temperature: 0,
          // field_validations grows with line count (13 + 8 * lines). The default
          // output cap plus gemini-2.5-flash's thinking tokens can truncate a large
          // multi-line response, producing invalid/partial JSON. Pin to the model's
          // max so a 3+ line PR's full check list fits.
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
          responseJsonSchema: PR_ANALYSIS_RESPONSE_JSON_SCHEMA,
        },
      });
      modelText = result.text;
      lastError = null;
      break;
    } catch (error) {
      if (!isRetryableGeminiError(error) || attempt === GEMINI_MAX_ATTEMPTS) {
        lastError = error;
        break;
      }
      lastError = error;
      await waitForMilliseconds(GEMINI_RETRY_DELAY_MS);
    }
  }

  if (lastError) {
    throw lastError;
  }

  if (!modelText || modelText.trim().length === 0) {
    return { ok: false, reason: "empty_response" };
  }

  const parsedJson = safeParseJSON(modelText);
  if (!parsedJson) {
    return { ok: false, reason: "invalid_json" };
  }

  const parsedSchemaResult = prAnalysisResponseSchema.safeParse(parsedJson);
  if (!parsedSchemaResult.success) {
    return { ok: false, reason: "schema_invalid", error: parsedSchemaResult.error };
  }

  // The exact count (13 + 8 * lines) is communicated via the prompt only -- the
  // Gemini responseJsonSchema can't pin it (its compiler rejects large exact
  // lengths). A miscount used to hard-fail the whole run: it threw, the PR
  // reverted to pending_analysis, nothing was stored and no BC callback fired.
  // That stranding is worse than an off-by-a-few check list, so we now log the
  // discrepancy and proceed with whatever valid checks came back (zod still
  // guarantees each item's shape and a >= 13 floor).
  const actualCount = parsedSchemaResult.data.field_validations.length;
  if (actualCount !== expectedFieldValidationsCount) {
    logger.warn("purchase_request.analysis.field_validations_count_mismatch", {
      prId: input.prId,
      expected: expectedFieldValidationsCount,
      actual: actualCount,
    });
  }

  return { ok: true, data: sortFieldValidationsByFailureFirst(parsedSchemaResult.data) };
}
