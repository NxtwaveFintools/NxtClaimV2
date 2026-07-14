"use server";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import {
  computeConfidenceScore,
  computeReceiptAmounts,
  normalizeTransactionDate,
  resolveCurrencyCode,
} from "@/modules/claims/actions/receipt-normalization";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const CONFIDENCE_THRESHOLD = 80;
const MAX_CATEGORY_NAME_LENGTH = 100;
const MAX_CATEGORY_NAMES = 50;
const MAX_HINT_LENGTH = 200;
const EXPENSE_CATEGORY_NAMES_FORM_KEY = "expenseCategoryNames";
const BANK_STATEMENT_MATCH_VENDOR_FORM_KEY = "bankStatementMatchVendorName";
const BANK_STATEMENT_MATCH_DATE_FORM_KEY = "bankStatementMatchTransactionDate";
const BANK_STATEMENT_MATCH_BILL_NO_FORM_KEY = "bankStatementMatchBillNo";
const BANK_STATEMENT_MATCH_FOREIGN_CURRENCY_FORM_KEY = "bankStatementMatchForeignCurrencyCode";
const BANK_STATEMENT_MATCH_FOREIGN_TOTAL_FORM_KEY = "bankStatementMatchForeignTotalAmount";
const BANK_STATEMENT_MATCH_CATEGORY_FORM_KEY = "bankStatementMatchCategoryName";
const GENERIC_PARSE_FALLBACK_MESSAGE =
  "AI could not read the text formatting in this document. Please fill the details manually.";
const GEMINI_QUOTA_FALLBACK_PREFIX =
  "AI auto-parse is temporarily unavailable due to usage limits.";
const GEMINI_SERVICE_BUSY_MESSAGE =
  "The AI service is currently busy. Please try again or fill the form manually.";
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_DELAY_MS = 1_000;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// ---------------------------------------------------------------------------
// Extraction contract: the model reports OBSERVED values only. All math,
// date validation, currency validation, and confidence are computed in code
// (see receipt-normalization.ts).
// ---------------------------------------------------------------------------

const looseNullableNumber = z.any().transform((val): number | null => {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === "string") {
    const parsed = parseFloat(val.replace(/,/g, ""));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
});

const looseNullableString = z.any().transform((val): string | null => {
  if (val === null || val === undefined) {
    return null;
  }
  const text = typeof val === "string" ? val : String(val);
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
});

const geminiExtractionSchema = z.object({
  docType: looseNullableString,
  vendorName: looseNullableString,
  billNo: looseNullableString,
  gstNumber: looseNullableString.optional(),
  dateAsPrinted: looseNullableString.optional(),
  transactionDate: looseNullableString,
  currencyCode: looseNullableString,
  subtotalAmount: looseNullableNumber.optional(),
  feesTotal: looseNullableNumber.optional(),
  discountTotal: looseNullableNumber.optional(),
  cgstAmount: looseNullableNumber.optional(),
  sgstAmount: looseNullableNumber.optional(),
  igstAmount: looseNullableNumber.optional(),
  otherTaxTotal: looseNullableNumber.optional(),
  totalAmount: looseNullableNumber,
  categoryName: looseNullableString.optional(),
});

type GeminiExtraction = z.infer<typeof geminiExtractionSchema>;

const DOC_TYPES = [
  "food_delivery",
  "ride_hailing",
  "gst_invoice",
  "receipt",
  "bank_statement",
  "other",
] as const;

// Standard JSON Schema enforced by Gemini constrained decoding. Every field is
// required so the model must explicitly emit null for unknowns.
const EXTRACTION_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    docType: { type: "string", enum: [...DOC_TYPES] },
    vendorName: { type: ["string", "null"] },
    billNo: { type: ["string", "null"] },
    gstNumber: { type: ["string", "null"] },
    dateAsPrinted: { type: ["string", "null"] },
    transactionDate: {
      type: ["string", "null"],
      description: "YYYY-MM-DD only",
    },
    currencyCode: { type: ["string", "null"], description: "ISO 4217 alpha-3 code" },
    subtotalAmount: { type: ["number", "null"] },
    feesTotal: { type: ["number", "null"] },
    discountTotal: { type: ["number", "null"] },
    cgstAmount: { type: ["number", "null"] },
    sgstAmount: { type: ["number", "null"] },
    igstAmount: { type: ["number", "null"] },
    otherTaxTotal: { type: ["number", "null"] },
    totalAmount: { type: ["number", "null"] },
    categoryName: { type: ["string", "null"] },
  },
  required: [
    "docType",
    "vendorName",
    "billNo",
    "gstNumber",
    "dateAsPrinted",
    "transactionDate",
    "currencyCode",
    "subtotalAmount",
    "feesTotal",
    "discountTotal",
    "cgstAmount",
    "sgstAmount",
    "igstAmount",
    "otherTaxTotal",
    "totalAmount",
    "categoryName",
  ],
} as const;

function sanitizeCategoryName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractAllowedCategoryNames(input: FormData): string[] {
  const entries = input.getAll(EXPENSE_CATEGORY_NAMES_FORM_KEY);
  const uniqueNames: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const sanitized = sanitizeCategoryName(entry);
    if (!sanitized) {
      continue;
    }
    if (sanitized.length > MAX_CATEGORY_NAME_LENGTH) {
      continue;
    }
    const dedupeKey = sanitized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    uniqueNames.push(sanitized);
    if (uniqueNames.length >= MAX_CATEGORY_NAMES) {
      break;
    }
  }

  return uniqueNames;
}

export type BankStatementMatchContext = {
  vendorName: string | null;
  transactionDate: string | null;
  billNo: string | null;
  foreignCurrencyCode: string | null;
  foreignTotalAmount: number | null;
  categoryName: string | null;
};

function getFormDataNullableString(input: FormData, key: string): string | null {
  const value = input.get(key);
  const sanitized = sanitizeCategoryName(value);
  return sanitized !== null ? sanitized.slice(0, MAX_HINT_LENGTH) : null;
}

function getFormDataNullableNumber(input: FormData, key: string): number | null {
  const value = input.get(key);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractBankStatementMatchContext(input: FormData): BankStatementMatchContext {
  return {
    vendorName: getFormDataNullableString(input, BANK_STATEMENT_MATCH_VENDOR_FORM_KEY),
    transactionDate: getFormDataNullableString(input, BANK_STATEMENT_MATCH_DATE_FORM_KEY),
    billNo: getFormDataNullableString(input, BANK_STATEMENT_MATCH_BILL_NO_FORM_KEY),
    foreignCurrencyCode: getFormDataNullableString(
      input,
      BANK_STATEMENT_MATCH_FOREIGN_CURRENCY_FORM_KEY,
    ),
    foreignTotalAmount: getFormDataNullableNumber(
      input,
      BANK_STATEMENT_MATCH_FOREIGN_TOTAL_FORM_KEY,
    ),
    categoryName: getFormDataNullableString(input, BANK_STATEMENT_MATCH_CATEGORY_FORM_KEY),
  };
}

function buildInvoiceSystemInstruction(
  allowedCategoryNames: string[],
  todayIsoDate: string,
): string {
  const categoryBlock =
    allowedCategoryNames.length > 0
      ? `ALLOWED CATEGORIES (exact strings, pick the single best semantic match or null):\n${allowedCategoryNames.map((name) => `- ${name}`).join("\n")}`
      : `ALLOWED CATEGORIES: none provided — categoryName MUST be null.`;

  return `
TODAY'S DATE: ${todayIsoDate} (use ONLY to resolve missing years in printed dates)

ROLE:
You are a high-precision financial document READER for an expense claims system.
You report values exactly as printed. You never calculate, estimate, or guess.
Documents may be Indian app screenshots (Swiggy, Zomato, Uber, Ola, Rapido, Porter),
GST tax invoices, hotel folios, retail receipts, or foreign invoices. They may be
blurry, rotated, cropped, or partial.

TASK:
Report ONLY what is visibly printed in the document. If a value is not clearly
and unambiguously visible, return null for it. Null is always better than a guess.

FIELDS:
- docType: classify the document:
  food_delivery (Swiggy/Zomato/UberEats-style), ride_hailing (Uber/Ola/Rapido/
  Porter/taxi/courier), gst_invoice (formal tax invoice with GST details),
  receipt (any other bill/receipt), bank_statement, other.
- vendorName: the issuing brand/company name.
- billNo: Invoice No / Bill No / Receipt No / Order ID / Booking ID. For ride or
  delivery apps prefer a bill/invoice/order identifier; use Trip ID / Ride ID only
  when no bill-style identifier exists. Copy the FULL token verbatim, including
  any leading # and hyphens (e.g. "#RD17766973787873583").
- gstNumber: the seller GST registration number, only if printed. Never invent.
- dateAsPrinted: the transaction/invoice date EXACTLY as printed, verbatim
  (e.g. "18/05/26", "May 18, 2026"). This is an audit trail.
- transactionDate: that same date converted to YYYY-MM-DD. IMPORTANT: Indian
  documents print dates as day/month/year — "05/06/2026" means 5 June 2026.
  If the printed date has NO YEAR (app screenshots often show "June 2, 9:37 PM"
  or "delivered on 2 Jun"), infer the year as the most recent occurrence of
  that day and month on or before TODAY'S DATE above. Example: today
  2026-06-11 + "June 2" → 2026-06-02; today 2026-06-11 + "Dec 25" → 2025-12-25.
  If the date order is genuinely ambiguous and cannot be resolved from context
  (month names, other dates on the document), return null.
- currencyCode: ISO 4217 code of the document's currency. Map symbols:
  ₹ / Rs / INR → INR; $ → USD unless prefixed (A$ → AUD, S$ → SGD, C$ → CAD);
  € → EUR; £ → GBP; ¥ → JPY or CNY by context; د.إ / AED → AED; Fr/CHF → CHF.
  Return the code for ANY world currency. If no currency is identifiable → null.
- Amounts: plain numbers, no symbols, no thousands separators. null when that
  line is not printed. NEVER derive a value that is not printed (e.g. never
  back-calculate tax from a percentage, or a subtotal from the total).
  ETERNAL INVOICE EXCEPTION: Zomato orders are sometimes printed as TWO
  SEPARATE GST tax invoices in one PDF — a Food invoice (seller = the
  restaurant) and a Platform/Convenience Fee invoice (seller = "Eternal" /
  "Eternal Limited"). Detect this by document STRUCTURE, not by whichever
  vendor name you'd otherwise pick first: look for two distinct "Tax
  Invoice" blocks on the same document, each with its own GSTIN, where one
  seller is "Eternal" / "Eternal Limited" / "Zomato". Only when BOTH
  invoices are present, you MUST: report vendorName as "Eternal Limited";
  report gstNumber from the Eternal Limited (platform fee) invoice; sum the
  two invoices' totals into totalAmount, cgstAmount, and sgstAmount; use the
  FOOD invoice's billNo and transactionDate. IMPORTANT: because you summed
  across invoices, you MUST output null for subtotalAmount, feesTotal, and
  otherTaxTotal to prevent downstream math conflicts. If only ONE tax
  invoice is printed (no separate platform-fee invoice), this exception
  does NOT apply — extract normally from that single invoice.
  EXCEPTION — summing printed values IS allowed: when a tax or fee appears as a
  printed column across line items (itemized GST invoices) or in an annexure
  table, ADD UP the printed values and report the sum. That is reading, not
  deriving.
  - subtotalAmount: the PRE-TAX item/sub total. If the only printed item total
    is tax-INCLUSIVE (no pre-tax subtotal printed anywhere), return null —
    never report a tax-inclusive figure as subtotalAmount.
  - feesTotal: sum of printed platform/delivery/service/convenience/packaging/
    handling fees.
  - discountTotal: printed discounts/coupons/promotions. NOT wallet or payment
    adjustments.
  - cgstAmount, sgstAmount, igstAmount: total printed GST per type. If printed
    per line item in a table, sum the column (include annexure rows such as
    GST on handling fees).
  - otherTaxTotal: non-GST taxes (VAT, sales tax, service tax) summed.
  - totalAmount: the FINAL payable amount BEFORE wallet credits, cashback, or
    payment splitting. Food apps: "Grand Total" / "Total Bill" before wallet
    adjustment. Ride apps: "Total Fare" / "Trip Fare" / "Amount Charged".
- categoryName: best semantic match from the allowed list below (hotel → lodging,
  ride/flight → travel, restaurant/food delivery → meals, etc.). Must be an EXACT
  string from the list, or null when no strong match.

${categoryBlock}

OUTPUT:
A single JSON object matching the response schema. Every field present; use null
for anything not clearly printed.
`;
}

function buildBankStatementSystemInstruction(matchContext: BankStatementMatchContext): string {
  const contextLines = [
    matchContext.vendorName ? `- Expected vendor or merchant: ${matchContext.vendorName}` : null,
    matchContext.transactionDate
      ? `- Expected invoice/transaction date: ${matchContext.transactionDate}`
      : null,
    matchContext.billNo ? `- Expected bill or reference number: ${matchContext.billNo}` : null,
    matchContext.categoryName ? `- Expected expense category: ${matchContext.categoryName}` : null,
    matchContext.foreignCurrencyCode && matchContext.foreignTotalAmount !== null
      ? `- Foreign invoice total for reference only: ${matchContext.foreignCurrencyCode} ${matchContext.foreignTotalAmount.toFixed(2)}`
      : null,
  ].filter((line): line is string => line !== null);

  const matchContextBlock =
    contextLines.length > 0
      ? contextLines.join("\n")
      : "- No external match hints were provided. Use the statement content only.";

  return `
ROLE:
You are a financial document reader specializing in bank statements.

GOAL:
Find the single settled INR debit/deduction that best matches the expense claim,
and report it. Do not calculate anything; report printed values only.

MATCH HINTS:
${matchContextBlock}

SELECTION RULES:
- Consider debit, withdrawal, card charge, UPI spend, or spent rows only.
- Never choose credits, refunds, reversals, chargebacks, cashback, deposits,
  opening/closing balances, or pending authorization holds.
- If several INR amounts appear, rank candidates by: vendor/merchant descriptor
  similarity, date proximity to the expected invoice date, reference/identifier
  similarity, narration relevance, and (if a foreign total hint exists)
  reasonableness of the INR amount allowing normal FX variance and bank fees.
- Prefer the final settled debit over duplicate pending lines.

OUTPUT MAPPING (single JSON object matching the response schema):
- docType: "bank_statement"
- totalAmount: the matched settled INR debit amount.
- transactionDate: the matched statement line date as YYYY-MM-DD (statements may
  print day/month/year order — "05/06/2026" means 5 June 2026); null if unclear.
- dateAsPrinted: that date exactly as printed.
- vendorName: the matched merchant descriptor, if clear.
- billNo: a transaction/reference identifier from the matched line, if clearly
  printed; else null.
- currencyCode: "INR".
- All other fields (gstNumber, subtotalAmount, feesTotal, discountTotal,
  cgstAmount, sgstAmount, igstAmount, otherTaxTotal, categoryName): null.
`;
}

export type ParsedReceiptResult = {
  billNo: string | null;
  transactionDate: string | null;
  vendorName: string | null;
  gstNumber: string | null;
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  category_name: string | null;
  confidenceScore: number;
  foreignCurrencyCode: string | null;
  foreignBasicAmount: number;
  foreignGstAmount: number;
  foreignTotalAmount: number;
};

export type ParseReceiptActionResult = {
  ok: boolean;
  data: ParsedReceiptResult | null;
  autoFillAllowed: boolean;
  message: string | null;
};

function safeParseJSON(aiResponseText: string): unknown | null {
  try {
    const cleanText = aiResponseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const normalized = cleanText.replace(/\\u(?![0-9a-fA-F]{4})/g, "");
    const match = normalized.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error("No JSON object found in AI response.");
    }

    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

type GeminiErrorShape = {
  status?: number;
  statusText?: string;
  message?: string;
};

function asGeminiErrorShape(error: unknown): GeminiErrorShape {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  return error as GeminiErrorShape;
}

function parseRetrySeconds(input: string): number | null {
  const value = input.trim();
  const durationMatch = value.match(/^(\d+(?:\.\d+)?)s$/i);

  if (durationMatch && durationMatch[1]) {
    const parsed = Number.parseFloat(durationMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const sentenceMatch = value.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s?/i);
  if (sentenceMatch && sentenceMatch[1]) {
    const parsed = Number.parseFloat(sentenceMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const jsonFieldMatch = value.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (jsonFieldMatch && jsonFieldMatch[1]) {
    const parsed = Number.parseFloat(jsonFieldMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function extractRetryDelaySeconds(error: unknown): number | null {
  const geminiError = asGeminiErrorShape(error);

  if (typeof geminiError.message === "string") {
    return parseRetrySeconds(geminiError.message);
  }

  return null;
}

function isGeminiQuotaError(error: unknown): boolean {
  const geminiError = asGeminiErrorShape(error);

  if (geminiError.status === 429) {
    return true;
  }

  const lowerStatusText = (geminiError.statusText ?? "").toLowerCase();
  const lowerMessage = (geminiError.message ?? "").toLowerCase();

  return (
    lowerStatusText.includes("too many requests") ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("quota exceeded") ||
    lowerMessage.includes("rate limit")
  );
}

function isGeminiServiceUnavailableError(error: unknown): boolean {
  const geminiError = asGeminiErrorShape(error);

  if (geminiError.status === 503) {
    return true;
  }

  const lowerStatusText = (geminiError.statusText ?? "").toLowerCase();
  const lowerMessage = (geminiError.message ?? "").toLowerCase();

  return (
    lowerStatusText.includes("service unavailable") || lowerMessage.includes("service unavailable")
  );
}

function waitForMilliseconds(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function generateGeminiContentWithRetry(
  client: GoogleGenAI,
  systemInstruction: string,
  mimeType: string,
  base64Payload: string,
): Promise<{ text: string | undefined }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await client.models.generateContent({
        model: serverEnv.GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Payload,
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: EXTRACTION_RESPONSE_JSON_SCHEMA,
        },
      });
    } catch (error) {
      if (!isGeminiServiceUnavailableError(error)) {
        throw error;
      }

      lastError = error;

      if (attempt === GEMINI_MAX_ATTEMPTS) {
        break;
      }

      logger.warn("claims.parse_receipt.service_unavailable_retry", {
        attempt,
        maxAttempts: GEMINI_MAX_ATTEMPTS,
        retryDelayMs: GEMINI_RETRY_DELAY_MS,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : "Gemini service unavailable. Retrying request.",
      });

      await waitForMilliseconds(GEMINI_RETRY_DELAY_MS);
    }
  }

  throw lastError ?? new Error("Gemini service unavailable");
}

function getQuotaExceededMessage(error: unknown): string {
  const retryDelaySeconds = extractRetryDelaySeconds(error);
  const retryHint =
    retryDelaySeconds !== null
      ? ` Please retry in about ${Math.ceil(retryDelaySeconds)} seconds.`
      : " Please try again shortly.";

  return `${GEMINI_QUOTA_FALLBACK_PREFIX}${retryHint} You can still fill the details manually.`;
}

function buildParsedReceiptResult(
  extraction: GeminiExtraction,
  documentType: "invoice" | "bank_statement",
  now: Date,
  allowedCategoryNames: string[],
): ParsedReceiptResult {
  const transactionDate = normalizeTransactionDate(extraction.transactionDate, now);
  const currency = resolveCurrencyCode(extraction.currencyCode);
  const amounts = computeReceiptAmounts({
    subtotalAmount: extraction.subtotalAmount ?? null,
    feesTotal: extraction.feesTotal ?? null,
    discountTotal: extraction.discountTotal ?? null,
    cgstAmount: extraction.cgstAmount ?? null,
    sgstAmount: extraction.sgstAmount ?? null,
    igstAmount: extraction.igstAmount ?? null,
    otherTaxTotal: extraction.otherTaxTotal ?? null,
    totalAmount: extraction.totalAmount ?? null,
  });

  const matched =
    allowedCategoryNames.find(
      (name) => name.toLowerCase() === extraction.categoryName?.trim().toLowerCase(),
    ) ?? null;

  const base: ParsedReceiptResult = {
    billNo: extraction.billNo,
    transactionDate,
    vendorName: extraction.vendorName,
    gstNumber: extraction.gstNumber ?? null,
    basicAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    totalAmount: 0,
    category_name: matched,
    confidenceScore: 0,
    foreignCurrencyCode: null,
    foreignBasicAmount: 0,
    foreignGstAmount: 0,
    foreignTotalAmount: 0,
  };

  if (documentType === "bank_statement") {
    // Business rule: the matched settled INR debit lands in basicAmount;
    // totalAmount and taxes stay 0 (finance fills the rest).
    base.basicAmount = amounts.totalAmount;
    base.category_name = null;
  } else if (currency.code !== null && currency.code !== "INR") {
    // Foreign invoice: amounts live in foreign fields; local INR fields stay 0
    // (finance converts at settlement). otherTaxTotal counts as foreign tax.
    const foreignTax =
      Math.round((amounts.taxTotal + Math.max(extraction.otherTaxTotal ?? 0, 0)) * 100) / 100;
    base.foreignCurrencyCode = currency.code;
    base.foreignTotalAmount = amounts.totalAmount;
    base.foreignGstAmount = foreignTax;
    base.foreignBasicAmount = Math.max(
      Math.round((amounts.totalAmount - foreignTax) * 100) / 100,
      0,
    );
  } else {
    base.basicAmount = amounts.basicAmount;
    base.cgstAmount = amounts.cgstAmount;
    base.sgstAmount = amounts.sgstAmount;
    base.igstAmount = amounts.igstAmount;
    base.totalAmount = amounts.totalAmount;
  }

  base.confidenceScore = computeConfidenceScore({
    mathConsistent: amounts.mathConsistent,
    hasTransactionDate: transactionDate !== null,
    hasBillNo: documentType === "bank_statement" ? true : base.billNo !== null,
    hasVendorName: base.vendorName !== null,
    invalidCurrencyDetected: currency.invalidDetected,
  });

  return base;
}

/**
 * Evidence-grade extraction outcome: carries BOTH the raw model output and the
 * normalized result so the finance verification worker can show finance the raw
 * receipt value next to the normalized one. Gemini transport errors (quota/503/
 * other) throw out of here so callers can classify them as retryable.
 */
export type ReceiptExtractionOutcome =
  | { ok: true; raw: GeminiExtraction; normalized: ParsedReceiptResult }
  | { ok: false; reason: "empty_response" | "invalid_json" }
  | { ok: false; reason: "schema_invalid"; error: z.ZodError };

/**
 * Buffer-level extraction core shared by the submission-time autofill action and
 * the finance verification worker. Single Gemini prompt + single normalization
 * path — autofill and verification can never silently diverge.
 */
export async function extractReceiptFromBuffer(params: {
  buffer: Buffer;
  mimeType: string;
  documentType: "invoice" | "bank_statement";
  allowedCategoryNames: string[];
  now: Date;
  /** Optional override. When omitted, the instruction is built here from
   * documentType (the verification worker relies on this so it shares the
   * autofill prompts for both invoice and bank-statement extraction). */
  systemInstruction?: string;
  /** Match context for bank-statement extraction (the submitted claim values
   * Gemini uses to pick the best-matching settled debit row). */
  bankStatementMatch?: BankStatementMatchContext;
}): Promise<ReceiptExtractionOutcome> {
  const systemInstruction =
    params.systemInstruction ??
    (params.documentType === "bank_statement"
      ? buildBankStatementSystemInstruction(
          params.bankStatementMatch ?? {
            vendorName: null,
            transactionDate: null,
            billNo: null,
            foreignCurrencyCode: null,
            foreignTotalAmount: null,
            categoryName: null,
          },
        )
      : buildInvoiceSystemInstruction(
          params.allowedCategoryNames,
          params.now.toISOString().slice(0, 10),
        ));

  const client = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
  const generationResult = await generateGeminiContentWithRetry(
    client,
    systemInstruction,
    params.mimeType,
    params.buffer.toString("base64"),
  );

  const modelText = generationResult.text;
  if (!modelText || modelText.trim().length === 0) {
    return { ok: false, reason: "empty_response" };
  }

  let parsedJson = safeParseJSON(modelText);
  if (!parsedJson) {
    return { ok: false, reason: "invalid_json" };
  }

  if (Array.isArray(parsedJson)) {
    parsedJson = parsedJson[0];
  }
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    parsedJson = {};
  }

  const parsedSchemaResult = geminiExtractionSchema.safeParse(parsedJson);
  if (!parsedSchemaResult.success) {
    return { ok: false, reason: "schema_invalid", error: parsedSchemaResult.error };
  }

  const normalized = buildParsedReceiptResult(
    parsedSchemaResult.data,
    params.documentType,
    params.now,
    params.allowedCategoryNames,
  );

  return { ok: true, raw: parsedSchemaResult.data, normalized };
}

export async function parseReceiptAction(input: FormData): Promise<ParseReceiptActionResult> {
  const fileEntry = input.get("receiptFile");
  const documentType =
    input.get("documentType") === "bank_statement" ? "bank_statement" : "invoice";
  const allowedCategoryNames = documentType === "invoice" ? extractAllowedCategoryNames(input) : [];
  const geminiInstruction =
    documentType === "bank_statement"
      ? buildBankStatementSystemInstruction(extractBankStatementMatchContext(input))
      : buildInvoiceSystemInstruction(allowedCategoryNames, new Date().toISOString().slice(0, 10));

  try {
    const receiptFile = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

    if (!receiptFile) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Receipt file is required.",
      };
    }

    if (receiptFile.size > MAX_FILE_SIZE_BYTES) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Receipt file exceeds 25MB.",
      };
    }

    if (!ALLOWED_UPLOAD_MIME_TYPES.has(receiptFile.type)) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Receipt file must be PDF, JPG, PNG, or WEBP.",
      };
    }

    const buffer = Buffer.from(await receiptFile.arrayBuffer());
    const extraction = await extractReceiptFromBuffer({
      buffer,
      mimeType: receiptFile.type,
      systemInstruction: geminiInstruction,
      documentType,
      allowedCategoryNames,
      now: new Date(),
    });

    if (!extraction.ok) {
      if (extraction.reason === "empty_response") {
        return {
          ok: false,
          data: null,
          autoFillAllowed: false,
          message: "Could not auto-read receipt. Please fill manually.",
        };
      }

      if (extraction.reason === "schema_invalid") {
        logger.warn("claims.parse_receipt.validation_failed", {
          errorName: extraction.error.name,
          errorMessage: extraction.error.issues[0]?.message ?? "Invalid parser output.",
        });
      } else {
        logger.warn("claims.parse_receipt.invalid_json_payload", {
          errorName: "AIParseError",
          errorMessage: "Gemini output could not be parsed as JSON.",
        });
      }

      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: GENERIC_PARSE_FALLBACK_MESSAGE,
      };
    }

    const normalized = extraction.normalized;

    const hasPartialData =
      documentType === "bank_statement"
        ? normalized.basicAmount > 0 ||
          normalized.vendorName !== null ||
          normalized.transactionDate !== null ||
          normalized.billNo !== null
        : normalized.vendorName !== null ||
          normalized.totalAmount > 0 ||
          normalized.foreignTotalAmount > 0 ||
          normalized.transactionDate !== null ||
          normalized.billNo !== null;
    const hasMissingCriticalFields =
      documentType === "bank_statement"
        ? normalized.basicAmount === 0
        : (normalized.totalAmount === 0 && normalized.foreignTotalAmount === 0) ||
          normalized.transactionDate === null ||
          normalized.billNo === null;

    let autoFillAllowed: boolean;
    let message: string | null;

    if (normalized.confidenceScore >= CONFIDENCE_THRESHOLD && !hasMissingCriticalFields) {
      autoFillAllowed = true;
      message = null;
    } else if (hasPartialData) {
      autoFillAllowed = true;
      message = "Extracted partial data. Please verify and fill the missing fields manually.";
    } else {
      autoFillAllowed = false;
      message = "Low confidence parse. Please fill manually.";
    }

    return {
      ok: true,
      data: normalized,
      autoFillAllowed,
      message,
    };
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      const retryDelaySeconds = extractRetryDelaySeconds(error);
      logger.warn("claims.parse_receipt.rate_limited", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : "Gemini request failed due to rate limiting.",
        retryDelaySeconds,
      });

      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: getQuotaExceededMessage(error),
      };
    }

    if (isGeminiServiceUnavailableError(error)) {
      logger.warn("claims.parse_receipt.service_unavailable", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Gemini request failed with service unavailable.",
        maxAttempts: GEMINI_MAX_ATTEMPTS,
      });

      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: GEMINI_SERVICE_BUSY_MESSAGE,
      };
    }

    logger.error("claims.parse_receipt.failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unexpected parse receipt failure.",
    });
    return {
      ok: false,
      data: null,
      autoFillAllowed: false,
      message: GENERIC_PARSE_FALLBACK_MESSAGE,
    };
  }
}
