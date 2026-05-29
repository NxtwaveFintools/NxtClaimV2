/**
 * Max characters accepted for a BC search query. Caps OData filter size and
 * keeps per-query cache keys bounded.
 */
export const BC_SEARCH_MAX_LEN = 100;

/**
 * Sanitizes a user-supplied BC search term before it is used as a cache key
 * and interpolated into an OData contains() filter. Trims surrounding
 * whitespace and caps length.
 *
 * Note: this does NOT strip or escape any characters. The search term is
 * always interpolated inside a single-quoted OData string literal, and
 * single-quote escaping (doubling) is applied at filter-build time — so
 * parentheses and other punctuation inside the literal are already safe and
 * are preserved so searches like "Tech (India) Pvt Ltd" match correctly.
 */
export function sanitizeBcSearchQuery(raw: string): string {
  return raw.trim().slice(0, BC_SEARCH_MAX_LEN);
}

/**
 * Escapes a (already sanitized) term for safe interpolation inside a
 * single-quoted OData string literal: doubles `'` and strips ASCII control
 * chars. This is the single source of OData-injection defense — callers MUST
 * use it instead of ad-hoc replaces.
 */
export function escapeOdataLiteral(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, "").replace(/'/g, "''");
}
