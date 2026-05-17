// supabase/functions/_shared/logger.ts

/**
 * One-line JSON logger for BC edge functions. Each call emits a single
 * console.log() with a stable shape; Supabase's log explorer indexes
 * JSON keys so callers can filter by fn / claim_id / event in production.
 *
 * Redaction rules (enforced by callers, documented here):
 *  - Never include bearer tokens or Authorization headers.
 *  - Never include user PII beyond the auth.users uuid.
 *  - Truncate raw BC error bodies to the first 500 chars before passing in.
 */

export type BcFnName = "bc-claim" | "bc-reference" | "bc-vendor-search";
export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  fn: BcFnName;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

// Test seam — overridden by tests to capture emitted lines.
let writer: (line: string) => void = (line) => console.log(line);
export function __setLoggerWriter(w: ((line: string) => void) | null): void {
  writer = w ?? ((line) => console.log(line));
}

export function log(
  fn: BcFnName,
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    fn,
    level,
    event,
    ...(fields ?? {}),
  };
  writer(JSON.stringify(entry));
}
