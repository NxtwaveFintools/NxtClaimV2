export type PurchaseRequestErrorCode =
  | "INVALID_API_KEY"
  | "INVALID_JSON"
  | "MISSING_REQUIRED_FIELDS"
  | "VALIDATION_FAILED"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_TOO_SMALL"
  | "UNSUPPORTED_FILE_TYPE"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export function errorBody(code: PurchaseRequestErrorCode, message: string, details?: string[]) {
  return {
    success: false as const,
    error_code: code,
    message,
    ...(details ? { details } : {}),
  };
}
