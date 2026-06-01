export const AUTH_PROVIDERS = {
  microsoft: "azure",
  google: "google",
} as const;

export const AUTH_ERROR_CODES = {
  unauthorized: "UNAUTHORIZED",
  domainNotAllowed: "DOMAIN_NOT_ALLOWED",
  validationError: "VALIDATION_ERROR",
  authFailed: "AUTH_FAILED",
  sessionExpired: "SESSION_EXPIRED",
} as const;

export const AUTH_ERROR_MESSAGES = {
  domainNotAllowed: "Please sign in using an approved company email address.",
  domainValidationFailed: "We couldn't verify your session. Please sign in again.",
} as const;
