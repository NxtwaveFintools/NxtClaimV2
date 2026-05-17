import { getBcAccessToken, invalidateBcToken } from "./bcAuth.ts";
import { getBcEnv } from "./bcEnv.ts";

/**
 * Generic Business Central HTTP wrapper used by bc-claim (POST /Claims) and
 * bc-reference (GET /ODataV4/...). Centralises:
 *  - OAuth2 token retrieval via bcAuth (cached, 60s expiry buffer).
 *  - Single retry on HTTP 401 with a forcibly refreshed token (handles
 *    the rare case where the cached token was rejected by BC, e.g. tenant
 *    revoked the secret between fetch and use).
 *  - AbortController-based timeout (default 30s) so a hung BC call cannot
 *    keep the edge function alive until Supabase's 60s kill switch.
 *  - Invalid-JSON capture: if BC returns a non-2xx body that isn't JSON,
 *    we return `{ raw_body: "..." }` instead of throwing — callers always
 *    get a structured body.
 *
 * BC has two distinct base URLs:
 *   - "claims"  → custom Alletec API at /v2.0/{environment}/api/Alletec/Claim/v1.0
 *   - "odata"   → standard OData at /v2.0/{tenantId}/{environment}/ODataV4/Company('{companyName}')
 * Callers pick via the `endpoint` parameter.
 */

export type BcEndpointKind = "claims" | "odata";

export interface BcFetchOptions {
  timeoutMs?: number;
}

export interface BcFetchResult {
  status: number;
  body: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildUrl(endpoint: BcEndpointKind, path: string): string {
  const env = getBcEnv();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  switch (endpoint) {
    case "claims":
      return `https://api.businesscentral.dynamics.com/v2.0/${env.environment}/api/Alletec/Claim/v1.0${cleanPath}`;
    case "odata":
      return `https://api.businesscentral.dynamics.com/v2.0/${env.tenantId}/${env.environment}/ODataV4/Company('${env.companyName}')${cleanPath}`;
  }
}

// Test seam — lets tests inject a fake fetch (default: globalThis.fetch).
let fetchOverride: typeof fetch | null = null;
export function __setBcFetchImpl(fn: typeof fetch | null): void {
  fetchOverride = fn;
}

async function doFetch(
  url: string,
  token: string,
  method: "GET" | "POST",
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = fetchOverride ?? globalThis.fetch;
  try {
    return await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function bcFetch(
  endpoint: BcEndpointKind,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: BcFetchOptions = {},
): Promise<BcFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildUrl(endpoint, path);

  let token = await getBcAccessToken();
  let response = await doFetch(url, token, method, body, timeoutMs);

  if (response.status === 401) {
    invalidateBcToken();
    token = await getBcAccessToken();
    response = await doFetch(url, token, method, body, timeoutMs);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    parsed = { raw_body: text };
  }

  return { status: response.status, body: parsed };
}
