type SupabaseAuthErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
};

const SESSION_MISSING_ERROR_REGEX = /auth\s+session\s+missing/i;
const REFRESH_TOKEN_NOT_FOUND_REGEX =
  /refresh[_\s-]*token[_\s-]*(not\s+found|missing)|refresh_token_not_found/i;
const INVALID_REFRESH_TOKEN_REGEX = /invalid\s+refresh\s+token/i;
const INVALID_GRANT_REGEX = /invalid[_\s-]*grant/i;
const EXPIRED_SESSION_REGEX = /jwt\s+expired|token\s+has\s+expired|session\s+expired/i;

function asSupabaseAuthErrorLike(error: unknown): SupabaseAuthErrorLike {
  if (!error || typeof error !== "object") {
    return {};
  }

  return error as SupabaseAuthErrorLike;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function getSupabaseAuthErrorMessage(error: unknown): string {
  const parsed = asSupabaseAuthErrorLike(error);
  return typeof parsed.message === "string" ? parsed.message : "";
}

export function getSupabaseAuthErrorCode(error: unknown): string {
  const parsed = asSupabaseAuthErrorLike(error);
  return normalizeString(parsed.code);
}

export function isSupabaseAuthSessionMissingError(error: unknown): boolean {
  const message = getSupabaseAuthErrorMessage(error);
  return SESSION_MISSING_ERROR_REGEX.test(message);
}

export function isSupabaseRefreshTokenNotFoundError(error: unknown): boolean {
  const message = getSupabaseAuthErrorMessage(error);
  const code = getSupabaseAuthErrorCode(error);

  return REFRESH_TOKEN_NOT_FOUND_REGEX.test(message) || code === "refresh_token_not_found";
}

export function isSupabaseInvalidRefreshTokenError(error: unknown): boolean {
  const message = getSupabaseAuthErrorMessage(error);
  const code = getSupabaseAuthErrorCode(error);

  return INVALID_REFRESH_TOKEN_REGEX.test(message) || code === "invalid_refresh_token";
}

export function isSupabaseExpiredSessionError(error: unknown): boolean {
  const message = getSupabaseAuthErrorMessage(error);
  return EXPIRED_SESSION_REGEX.test(message);
}

export function isSupabaseInvalidGrantError(error: unknown): boolean {
  const message = getSupabaseAuthErrorMessage(error);
  const code = getSupabaseAuthErrorCode(error);

  return INVALID_GRANT_REGEX.test(message) || code === "invalid_grant";
}

/**
 * Terminal session errors should never trigger retries/refresh loops.
 * They require deterministic logout/cookie cleanup and a fresh sign-in.
 */
export function isSupabaseTerminalSessionError(error: unknown): boolean {
  return (
    isSupabaseAuthSessionMissingError(error) ||
    isSupabaseRefreshTokenNotFoundError(error) ||
    isSupabaseInvalidRefreshTokenError(error) ||
    isSupabaseInvalidGrantError(error) ||
    isSupabaseExpiredSessionError(error)
  );
}
