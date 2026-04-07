"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const CONFIDENCE_THRESHOLD = 80;
const GENERIC_PARSE_FALLBACK_MESSAGE =
  "AI could not read the text formatting in this document. Please fill the details manually.";
const GEMINI_QUOTA_FALLBACK_PREFIX =
  "AI auto-parse is temporarily unavailable due to usage limits.";
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
  cgstAmount: looseNumber,
  sgstAmount: looseNumber,
  igstAmount: looseNumber,
  totalAmount: looseNumber,
  expenseCategory: looseNullableString,
  confidenceScore: looseNumber,
});

const GEMINI_SYSTEM_INSTRUCTION = `You are an expert financial document parser. Extract structured financial data from the attached receipt/invoice.
The document may be torn, blurred, rotated, or missing edges. Use contextual reasoning.

EXTRACTION RULES:
- billNo: Look for Invoice No, Bill No, Txn No.
- transactionDate: strictly YYYY-MM-DD.
- GST: If percentages (e.g., CGST 9%) appear but amounts do not, calculate the amount from the taxable value.
- Calculate missing taxes based on standard Indian GST slabs (5%, 12%, 18%, 28%).
- Math Validation: basicAmount + cgstAmount + sgstAmount + igstAmount MUST equal totalAmount.

CONFIDENCE SCORING (0-100):
- Base it on text clarity and numerical consistency.
- If the Math Validation fails, heavily reduce the confidence score to below 80.

CRITICAL: You must return exactly ONE JSON object. If multiple receipts or copies are detected in the document, extract data from the first one only. DO NOT return a JSON array.

Return ONLY valid JSON matching this schema:
{
  "billNo": string | null,
  "transactionDate": string | null,
  "vendorName": string | null,
  "basicAmount": number,
  "cgstAmount": number,
  "sgstAmount": number,
  "igstAmount": number,
  "totalAmount": number,
  "expenseCategory": string | null,
  "confidenceScore": number
}`;

export type ParsedReceiptResult = {
  billNo: string | null;
  transactionDate: string | null;
  vendorName: string | null;
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  expenseCategory: string | null;
  confidenceScore: number;
};

export type ParseReceiptActionResult = {
  ok: boolean;
  data: ParsedReceiptResult | null;
  autoFillAllowed: boolean;
  message: string | null;
};

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

function getQuotaExceededMessage(error: unknown): string {
  const retryDelaySeconds = extractRetryDelaySeconds(error);
  const retryHint =
    retryDelaySeconds !== null
      ? ` Please retry in about ${Math.ceil(retryDelaySeconds)} seconds.`
      : " Please try again shortly.";

  return `${GEMINI_QUOTA_FALLBACK_PREFIX}${retryHint} You can still fill the details manually.`;
}

function normalizeGeminiResult(raw: z.infer<typeof geminiParseResultSchema>): ParsedReceiptResult {
  const basicAmount = normalizeAmount(raw.basicAmount);
  const cgstAmount = normalizeAmount(raw.cgstAmount);
  const sgstAmount = normalizeAmount(raw.sgstAmount);
  const igstAmount = normalizeAmount(raw.igstAmount);
  const totalAmount = normalizeAmount(raw.totalAmount);

  const normalizedConfidence = clampConfidence(raw.confidenceScore);

  return {
    billNo: normalizeNullableText(raw.billNo),
    transactionDate: raw.transactionDate,
    vendorName: normalizeNullableText(raw.vendorName),
    basicAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount,
    expenseCategory: normalizeNullableText(raw.expenseCategory),
    confidenceScore: normalizedConfidence,
  };
}

function createGeminiModel(): ReturnType<GoogleGenerativeAI["getGenerativeModel"]> {
  const client = new GoogleGenerativeAI(serverEnv.GEMINI_API_KEY);
  return client.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });
}

export async function parseReceiptAction(input: FormData): Promise<ParseReceiptActionResult> {
  const fileEntry = input.get("receiptFile");

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
    const model = createGeminiModel();
    const generationResult = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: receiptFile.type,
                data: buffer.toString("base64"),
              },
            },
          ],
        },
      ],
    });

    const modelText = generationResult.response.text();
    if (!modelText || modelText.trim().length === 0) {
      return {
        ok: false,
        data: null,
        autoFillAllowed: false,
        message: "Could not auto-read receipt. Please fill manually.",
      };
    }

    let cleanText = modelText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    cleanText = cleanText.replace(/\\u(?![0-9a-fA-F]{4})/g, "");

    let parsedJson = JSON.parse(cleanText);
    if (Array.isArray(parsedJson)) {
      parsedJson = parsedJson[0];
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
