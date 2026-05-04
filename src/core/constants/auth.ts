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
  domainNotAllowed: "Your email domain is not authorized for this workspace.",
  domainValidationFailed: "Unable to validate your email domain.",
} as const;

export const USER_ROLES = {
  employee: "employee",
  hod: "hod",
  founder: "founder",
  finance: "finance",
} as const;
