"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const CONFIDENCE_THRESHOLD = 80;
const EXPENSE_CATEGORY_NAMES_FORM_KEY = "expenseCategoryNames";
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

const looseNumber = z.any().transform((val) => {
  if (typeof val === "number") {
    return val;
  }

  if (typeof val === "string") {
    const parsed = parseFloat(val.replace(/,/g, ""));
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
});

const looseNullableString = z.any().transform((val) => {
  if (val === null || val === undefined) {
    return null;
  }

  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return String(val).trim() || null;
});

const looseDate = z.any().transform((val) => {
  if (!val) {
    return null;
  }

  const normalizedDateInput = typeof val === "string" ? val.replace(/,/g, " ").trim() : val;
  const parsedDate = new Date(normalizedDateInput);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString().split("T")[0];
});

const geminiParseResultSchema = z.object({
  billNo: looseNullableString,
  transactionDate: looseDate,
  vendorName: looseNullableString,
  basicAmount: looseNumber,
  gst_number: looseNullableString.optional(),
  gstNumber: looseNullableString.optional(),
  cgst_amount: looseNumber.optional(),
  cgstAmount: looseNumber.optional(),
  sgst_amount: looseNumber.optional(),
  sgstAmount: looseNumber.optional(),
  igst_amount: looseNumber.optional(),
  igstAmount: looseNumber.optional(),
  total_amount: looseNumber.optional(),
  totalAmount: looseNumber.optional(),
  category_name: looseNullableString,
  confidenceScore: looseNumber,
});

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

    const dedupeKey = sanitized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    uniqueNames.push(sanitized);
  }

  return uniqueNames;
}

function buildGeminiSystemInstruction(allowedCategoryNames: string[]): string {
  const categoryInstructionBlock =
    allowedCategoryNames.length > 0
      ? `ALLOWED EXPENSE CATEGORY NAMES (EXACT VALUES ONLY):\n${allowedCategoryNames.map((name) => `- ${name}`).join("\n")}`
      : `ALLOWED EXPENSE CATEGORY NAMES:\n- No categories provided → category_name MUST be null`;

  return `
ROLE:
You are a high-precision financial document parser specialized in receipts and invoices.

GOAL:
Extract structured expense data with maximum accuracy.
Documents may be blurry, rotated, cropped, handwritten, or partially missing.

---

EXTRACTION PRIORITY ORDER:
1. totalAmount        ← highest priority
2. cgst / sgst / igst
3. basicAmount
4. billNo, transactionDate
5. vendorName
6. category_name
7. confidenceScore

---

RULE 1 — TOTAL AMOUNT ("totalAmount"):

- MUST be the FINAL payable amount BEFORE any wallet/payment adjustments.
- Ignore: wallet deductions, cashback, discounts, partial payments.
- For ride apps (Uber/Ola): use "Total Fare", "Trip Fare", or "Amount Charged".
- NUMBER FORMAT: Strip ALL currency symbols and commas.
  Example: "₹1,365.40" → 1365.40

---

RULE 2 — TAXES:
Return: cgst_amount, sgst_amount, igst_amount.

- If tax % shown but amount missing → calculate it.
- If no GST is found anywhere → all tax fields = 0.
- NEVER put tax values in fees or basicAmount.

---

RULE 3 — FEES (CRITICAL):

Fees include: platform fees, delivery fees, service charges, ICANN fees, convenience fees.

- Fees are NOT taxes — do NOT put them in cgst/sgst/igst.
- Fees ARE included in totalAmount.
- Fees MUST be absorbed into basicAmount.

Correct mental model:
  basicAmount = subtotal + all fees (if subtotal is listed)
  OR
  basicAmount = totalAmount − cgst_amount − sgst_amount − igst_amount

---

RULE 4 — BASIC AMOUNT ("basicAmount"):

SINGLE CANONICAL FORMULA (always use this):
  basicAmount = totalAmount − (cgst_amount + sgst_amount + igst_amount)

This formula automatically absorbs all fees into basicAmount.
Do NOT create alternate logic paths.

STRICT MATH VALIDATION:
  basicAmount + cgst_amount + sgst_amount + igst_amount = totalAmount
  Allowed rounding tolerance: ±1

If this does not hold → deduct 30 from confidenceScore.

---

RULE 5 — IDENTIFIERS:

- billNo          → Invoice No / Bill No / Receipt No / Txn No
- For Rapido ride receipts or screenshots, billNo MUST use the Ride ID when you see the label "Ride ID" or any token that starts with "#RD".
- Capture the FULL Ride ID token exactly as shown, including the leading # when present.
- Example Rapido Ride ID: #RD17766973787873583
- transactionDate → YYYY-MM-DD ONLY.
  Convert ALL regional formats: MM/DD/YYYY, DD-MM-YY, DD/MM/YYYY → YYYY-MM-DD
- vendorName      → brand / company name
- gst_number      → GST registration number. If not visible → null. NEVER hallucinate.
- If any field is unclear → null.

---

RULE 6 — CATEGORY:
${categoryInstructionBlock}

- MUST match EXACT string from the list above.
- Use vendor name + line items to reason.
- If unsure → null.

---

RULE 7 — CONFIDENCE SCORE (0–100):
Start at 100. Deduct:
  -30 → math mismatch (basicAmount + taxes ≠ totalAmount)
  -20 → blurry or unreadable image
  -15 → missing billNo or transactionDate
  -10 → basicAmount was estimated or guessed
Clamp result between 0 and 100.

---

STRICT OUTPUT RULES:

- Return EXACTLY ONE JSON object.
- Return ONLY raw, valid JSON. Do NOT use markdown formatting, backticks, or conversational text.
- NO markdown, NO \`\`\`json\`\`\` fences, NO explanation, NO extra text.
- NEVER leave numeric fields undefined.
- NEVER output commas inside numbers.
- If multiple totals appear → pick the most prominent FINAL total.

---

SCHEMA:
{
  "billNo": string | null,
  "transactionDate": string | null,
  "vendorName": string | null,
  "basicAmount": number,
  "gst_number": string | null,
  "cgst_amount": number,
  "sgst_amount": number,
  "igst_amount": number,
  "totalAmount": number,
  "category_name": string | null,
  "confidenceScore": number
}

---

WORKED EXAMPLES:

Example 1 — Receipt WITH fees, no GST:
  Input:  Subtotal ₹1,347 | Platform Fee ₹18.40 | GST ₹0 | Total ₹1,365.40
  Output:
  {
    "billNo": null,
    "transactionDate": null,
    "vendorName": null,
    "basicAmount": 1365.40,
    "gst_number": null,
    "cgst_amount": 0,
    "sgst_amount": 0,
    "igst_amount": 0,
    "totalAmount": 1365.40,
    "category_name": null,
    "confidenceScore": 85
  }
  Note: fee is absorbed → basicAmount = 1365.40 (not 1347)

Example 2 — Receipt WITH GST, no fees:
  Input:  Subtotal ₹1,000 | CGST 9% ₹90 | SGST 9% ₹90 | Total ₹1,180
  Output:
  {
    "billNo": null,
    "transactionDate": null,
    "vendorName": null,
    "basicAmount": 1000,
    "gst_number": null,
    "cgst_amount": 90,
    "sgst_amount": 90,
    "igst_amount": 0,
    "totalAmount": 1180,
    "category_name": null,
    "confidenceScore": 100
  }

Example 3 — Rapido screenshot:
  Input:  Rapido | Ride ID #RD17766973787873583 | Total Fare ₹248
  Output:
  {
    "billNo": "#RD17766973787873583",
    "transactionDate": null,
    "vendorName": "Rapido",
    "basicAmount": 248,
    "gst_number": null,
    "cgst_amount": 0,
    "sgst_amount": 0,
    "igst_amount": 0,
    "totalAmount": 248,
    "category_name": null,
    "confidenceScore": 90
  }
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
};

export type ParseReceiptActionResult = {
  ok: boolean;
  data: ParsedReceiptResult | null;
  autoFillAllowed: boolean;
  message: string | null;
};

function toParsedReceiptResult(data: ParsedReceiptResult): ParsedReceiptResult {
  return {
    billNo: data.billNo,
    transactionDate: data.transactionDate,
    vendorName: data.vendorName,
    gstNumber: data.gstNumber,
    basicAmount: data.basicAmount,
    cgstAmount: data.cgstAmount,
    sgstAmount: data.sgstAmount,
    igstAmount: data.igstAmount,
    totalAmount: data.totalAmount,
    category_name: data.category_name,
    confidenceScore: data.confidenceScore,
  };
}

function normalizeNullableText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.max(value, 0) * 100) / 100;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

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
  errorDetails?: unknown;
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

  return null;
}

function extractRetryDelaySeconds(error: unknown): number | null {
  const geminiError = asGeminiErrorShape(error);
  const details = Array.isArray(geminiError.errorDetails) ? geminiError.errorDetails : [];

  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) {
      continue;
    }

    const retryDelay = (detail as { retryDelay?: unknown }).retryDelay;
    if (typeof retryDelay !== "string") {
      continue;
    }

    const parsed = parseRetrySeconds(retryDelay);
    if (parsed !== null) {
      return parsed;
    }
  }

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
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
  mimeType: string,
  base64Payload: string,
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await model.generateContent({
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
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

function normalizeGeminiResult(raw: z.infer<typeof geminiParseResultSchema>): ParsedReceiptResult {
  const gstNumber = normalizeNullableText(raw.gst_number ?? raw.gstNumber ?? null);
  const basicAmount = normalizeAmount(raw.basicAmount);
  const cgstAmount = normalizeAmount(raw.cgst_amount ?? raw.cgstAmount ?? 0);
  const sgstAmount = normalizeAmount(raw.sgst_amount ?? raw.sgstAmount ?? 0);
  const igstAmount = normalizeAmount(raw.igst_amount ?? raw.igstAmount ?? 0);
  const totalAmount = normalizeAmount(raw.total_amount ?? raw.totalAmount ?? 0);

  const normalizedConfidence = clampConfidence(raw.confidenceScore);

  return {
    billNo: normalizeNullableText(raw.billNo),
    transactionDate: raw.transactionDate,
    vendorName: normalizeNullableText(raw.vendorName),
    gstNumber,
    basicAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount,
    category_name: normalizeNullableText(raw.category_name),
    confidenceScore: normalizedConfidence,
  };
}

function createGeminiModel(
  systemInstruction: string,
): ReturnType<GoogleGenerativeAI["getGenerativeModel"]> {
  const client = new GoogleGenerativeAI(serverEnv.GEMINI_API_KEY);
  return client.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });
}

export async function parseReceiptAction(input: FormData): Promise<ParseReceiptActionResult> {
  const fileEntry = input.get("receiptFile");
  const allowedCategoryNames = extractAllowedCategoryNames(input);
  const geminiInstruction = buildGeminiSystemInstruction(allowedCategoryNames);

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
    const model = createGeminiModel(geminiInstruction);
    const generationResult = await generateGeminiContentWithRetry(
      model,
      receiptFile.type,
      buffer.toString("base64"),
    );

    const modelText = generationResult.response.text();
    if (!modelText || modelText.trim().length === 0) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Could not auto-read receipt. Please fill manually.",
      };
    }

    let parsedJson = safeParseJSON(modelText);
    if (!parsedJson) {
      logger.warn("claims.parse_receipt.invalid_json_payload", {
        errorName: "AIParseError",
        errorMessage: "Gemini output could not be parsed as JSON.",
      });

      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: GENERIC_PARSE_FALLBACK_MESSAGE,
      };
    }

    if (Array.isArray(parsedJson)) {
      parsedJson = parsedJson[0];
    }
    if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
      const parsedRecord = parsedJson as Record<string, unknown>;
      // Keep a short compatibility window for older prompts/tests that still emit expenseCategory.
      if (parsedRecord.category_name === undefined && parsedRecord.expenseCategory !== undefined) {
        parsedRecord.category_name = parsedRecord.expenseCategory;
      }

      // Backward compatibility for existing outputs that still use camelCase tax keys.
      if (parsedRecord.gst_number === undefined && parsedRecord.gstNumber !== undefined) {
        parsedRecord.gst_number = parsedRecord.gstNumber;
      }

      if (parsedRecord.cgst_amount === undefined && parsedRecord.cgstAmount !== undefined) {
        parsedRecord.cgst_amount = parsedRecord.cgstAmount;
      }

      if (parsedRecord.sgst_amount === undefined && parsedRecord.sgstAmount !== undefined) {
        parsedRecord.sgst_amount = parsedRecord.sgstAmount;
      }

      if (parsedRecord.igst_amount === undefined && parsedRecord.igstAmount !== undefined) {
        parsedRecord.igst_amount = parsedRecord.igstAmount;
      }
    }

    if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
      parsedJson = {};
    }

    const parsedSchemaResult = geminiParseResultSchema.safeParse(parsedJson);

    if (!parsedSchemaResult.success) {
      logger.warn("claims.parse_receipt.validation_failed", {
        errorName: parsedSchemaResult.error.name,
        errorMessage: parsedSchemaResult.error.issues[0]?.message ?? "Invalid parser output.",
      });
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: GENERIC_PARSE_FALLBACK_MESSAGE,
      };
    }

    const normalized = normalizeGeminiResult(parsedSchemaResult.data);

    const hasPartialData =
      normalized.vendorName !== null ||
      normalized.totalAmount > 0 ||
      normalized.transactionDate !== null ||
      normalized.billNo !== null;
    const hasMissingCriticalFields =
      normalized.totalAmount === 0 ||
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
      data: toParsedReceiptResult(normalized),
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
