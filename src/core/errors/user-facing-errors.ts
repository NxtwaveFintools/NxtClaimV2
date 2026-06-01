import { z } from "zod";

export type ErrorContext =
  | "auth"
  | "policy"
  | "claim-submission"
  | "claim-list"
  | "claim-detail"
  | "claim-action"
  | "claim-delete"
  | "claim-edit"
  | "bulk-action"
  | "file-upload"
  | "ai-extraction"
  | "export"
  | "analytics"
  | "admin"
  | "settings"
  | "unknown";

const DEFAULT_FALLBACK_MESSAGE = "Something went wrong. Please try again later.";

const TECHNICAL_MESSAGE_PATTERNS = [
  /supabase/i,
  /\bPGRST\d+\b/i,
  /\bP000\d+\b/i,
  /\b23505\b/i,
  /duplicate key value violates unique constraint/i,
  /duplicate key value/i,
  /violates foreign key constraint/i,
  /null value in column/i,
  /cannot read properties/i,
  /unexpected token/i,
  /zoderror/i,
  /json\.stringify/i,
  /\bRPC\b/i,
  /database/i,
  /gemini/i,
  /google.*provider/i,
  /microsoft.*provider/i,
  /\bat\s+.+:\d+:\d+/i,
  /[A-Z]:\\|\/src\/|\/app\/|\/modules\//i,
];

export function mapErrorCodeToMessage(code: string, context?: ErrorContext): string {
  const normalizedCode = code.trim().toUpperCase();

  switch (normalizedCode) {
    case "23505":
      return "A claim with the same bill number, date, and amount already exists.";
    case "PGRST116":
      if (context === "claim-detail") {
        return "This claim could not be found.";
      }
      if (context === "settings" || context === "admin") {
        return "We couldn't find the requested record.";
      }
      return "The requested information is unavailable.";
    case "CLAIM_NOT_FOUND":
    case "P0001":
      return "This claim could not be found.";
    case "ALREADY_SUBMITTED":
    case "P0002":
      return "This claim has already been submitted.";
    case "MISSING_MAPPING":
    case "P0003":
      return "Required system mapping is missing. Please contact an administrator.";
    case "INVALID_CLAIM_STATE":
    case "P0005":
      return "This claim is not in the right status for this action.";
    case "UNAUTHORIZED":
    case "FORBIDDEN":
    case "403":
      return getPermissionMessage(context);
    case "401":
    case "SESSION_EXPIRED":
    case "MISSING_SESSION":
      return "Your session has expired. Please sign in again.";
    case "429":
      if (context === "ai-extraction") {
        return "AI extraction is busy right now. Please try again later or enter the details manually.";
      }
      return "Too many requests. Please try again later.";
    case "503":
      if (context === "ai-extraction") {
        return "AI extraction is temporarily unavailable. Please try again in a few minutes or enter the details manually.";
      }
      return "Service is temporarily unavailable. Please try again later.";
    default:
      return getFallbackMessage(context);
  }
}

export function getUserFriendlyErrorMessage(error: unknown, context?: ErrorContext): string {
  if (typeof error === "string") {
    return mapTechnicalMessageToFriendly(error, context);
  }

  if (error instanceof z.ZodError) {
    return "Please review the form. Some required details are missing or invalid.";
  }

  if (error instanceof Error) {
    return mapTechnicalMessageToFriendly(error.message, context);
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = stringifyCandidate(record.code);
    const status = stringifyCandidate(record.status);
    const statusCode = stringifyCandidate(record.statusCode);
    const message = stringifyCandidate(record.message);

    if (code) {
      return mapErrorCodeToMessage(code, context);
    }

    if (status) {
      return mapErrorCodeToMessage(status, context);
    }

    if (statusCode) {
      return mapErrorCodeToMessage(statusCode, context);
    }

    if (message) {
      return mapTechnicalMessageToFriendly(message, context);
    }
  }

  return getFallbackMessage(context);
}

function stringifyCandidate(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function mapTechnicalMessageToFriendly(message: string, context?: ErrorContext): string {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return getFallbackMessage(context);
  }

  if (context === "auth") {
    if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
      return "Invalid email or password. Please check your credentials and try again.";
    }
    if (lower.includes("disallowed domain") || lower.includes("approved company email")) {
      return "Please sign in using an approved company email address.";
    }
    if (
      lower.includes("session has expired") ||
      lower.includes("refresh_token_not_found") ||
      lower.includes("missing token") ||
      lower.includes("missing session")
    ) {
      return "Your session has expired. Please sign in again.";
    }
    if (lower.includes("oauth") || lower.includes("provider")) {
      return "We couldn't complete sign-in with this provider. Please try again.";
    }
  }

  if (context === "policy") {
    if (lower.includes("no active policy")) {
      return "Company policy is currently unavailable. Please contact your administrator.";
    }
    if (lower.includes("accept")) {
      return "We couldn't record your policy acceptance. Please try again.";
    }
    if (lower.includes("pdf") || lower.includes("document") || lower.includes("file")) {
      return "We couldn't load the company policy document. Please try again later.";
    }
  }

  if (context === "ai-extraction") {
    if (lower.includes("required") || lower.includes("no file")) {
      return "Please upload a file before extracting details.";
    }
    if (lower.includes("25mb") || lower.includes("25 mb") || lower.includes("too large")) {
      return "The file is too large for extraction. Please upload a file under 25 MB.";
    }
    if (
      lower.includes("must be pdf") ||
      lower.includes("unsupported") ||
      lower.includes("file type")
    ) {
      return "This file type is not supported for extraction. Please upload a PDF, JPG, PNG, or WEBP file.";
    }
    if (
      lower.includes("too many requests") ||
      lower.includes("quota") ||
      lower.includes("rate limit")
    ) {
      return "AI extraction is busy right now. Please try again later or enter the details manually.";
    }
    if (lower.includes("service unavailable") || lower.includes("busy") || lower.includes("503")) {
      return "AI extraction is temporarily unavailable. Please try again in a few minutes or enter the details manually.";
    }
    if (lower.includes("low confidence")) {
      return "Some extracted details may be inaccurate. Please review all fields before submitting.";
    }
    if (lower.includes("invalid json") || lower.includes("could not be parsed")) {
      return "We couldn't extract clear details from this file. Please enter the claim details manually.";
    }
  }

  if (context === "export") {
    if (lower.includes("both start and end") || lower.includes("date range filter")) {
      return "Please select both start and end dates before exporting.";
    }
    if (lower.includes("valid export") || lower.includes("invalid date")) {
      return "Please select a valid export date range.";
    }
    if (lower.includes("90 days") || lower.includes("too large")) {
      return "Exports are limited to 90 days. Please choose a shorter date range.";
    }
    if (lower.includes("permission") || lower.includes("access")) {
      return "You don't have permission to export this claim view.";
    }
  }

  if (lower.includes("uq_expense_details_active_bill")) {
    return "A claim with the same bill number, date, and amount already exists.";
  }

  if (
    lower.includes("duplicate key value violates unique constraint") ||
    lower.includes("duplicate key value")
  ) {
    if (context === "claim-submission") {
      return "A claim with the same bill number, date, and amount already exists.";
    }
    return "An item with this name already exists.";
  }

  if (lower.includes("violates foreign key constraint")) {
    return "We couldn't complete this action because a related record is missing.";
  }

  if (lower.includes("null value in column")) {
    return "Some required information is missing. Please review and try again.";
  }

  if (lower.includes("exceeds 25mb") || lower.includes("25 mb") || lower.includes("too large")) {
    return context === "ai-extraction"
      ? "The file is too large for extraction. Please upload a file under 25 MB."
      : "The uploaded file is too large. Please upload a file under 25 MB.";
  }

  if (
    lower.includes("not supported") ||
    lower.includes("mime type") ||
    lower.includes("must be pdf")
  ) {
    if (context === "policy") {
      return "Please upload the company policy as a PDF file.";
    }
    if (context === "ai-extraction") {
      return "This file type is not supported for extraction. Please upload a PDF, JPG, PNG, or WEBP file.";
    }
    return "This file type is not supported. Please upload a PDF, JPG, PNG, or WEBP file.";
  }

  if (
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("unauthorized")
  ) {
    return getPermissionMessage(context);
  }

  if (lower.includes("already submitted")) {
    return context === "claim-action"
      ? "This claim has already been submitted to Business Central."
      : "This claim has already been submitted.";
  }

  if (lower.includes("missing mapping")) {
    return "Required system mapping is missing. Please contact an administrator.";
  }

  if (lower.includes("invalid claim state") || lower.includes("not in the right status")) {
    return "This claim is not in the right status for this action.";
  }

  if (/^(failed|unable) to /i.test(trimmed)) {
    return getFallbackMessage(context);
  }

  if (TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return getFallbackMessage(context);
  }

  if (isSafeFriendlyMessage(trimmed)) {
    return trimmed;
  }

  return getFallbackMessage(context);
}

function isSafeFriendlyMessage(message: string): boolean {
  if (message.length > 140) {
    return false;
  }

  if (/[\{\}\[\]`]/.test(message) || /[_=]{2,}/.test(message)) {
    return false;
  }

  if (/^[A-Z_]+$/.test(message)) {
    return false;
  }

  return !TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function getPermissionMessage(context?: ErrorContext): string {
  switch (context) {
    case "auth":
      return "We couldn't verify your session. Please sign in again.";
    case "claim-detail":
      return "You don't have permission to view this claim.";
    case "claim-list":
      return "You don't have access to this claims view.";
    case "analytics":
      return "You don't have access to analytics.";
    case "admin":
    case "settings":
      return "You don't have permission to access system settings.";
    case "export":
      return "You don't have permission to export this claim view.";
    default:
      return "You don't have permission to perform this action.";
  }
}

function getFallbackMessage(context?: ErrorContext): string {
  switch (context) {
    case "auth":
      return "We couldn't sign you in. Please try again.";
    case "policy":
      return "Company policy is currently unavailable. Please contact your administrator.";
    case "claim-submission":
      return "We couldn't submit this claim. Please review the details and try again.";
    case "claim-list":
      return "We couldn't load claims. Please try again.";
    case "claim-detail":
      return "We couldn't load claim details. Please try again.";
    case "claim-action":
      return "We couldn't complete this action. Please refresh and try again.";
    case "claim-delete":
      return "We couldn't delete this claim. It may no longer be eligible for deletion.";
    case "claim-edit":
      return "We couldn't save your changes. Please review the details and try again.";
    case "bulk-action":
      return "We couldn't process the selected claims. Please refresh and try again.";
    case "file-upload":
      return "We couldn't upload the file. Please try again.";
    case "ai-extraction":
      return "We couldn't extract details from this file. Please enter the details manually.";
    case "export":
      return "We couldn't export claims. Please try again.";
    case "analytics":
      return "We couldn't load analytics. Please try again.";
    case "admin":
    case "settings":
      return "We couldn't save these settings. Please review and try again.";
    default:
      return DEFAULT_FALLBACK_MESSAGE;
  }
}
