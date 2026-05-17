import { getBcEnv } from "./bcEnv.ts";

type TokenCache = { token: string; expiresAt: number };

type TestOverrides = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
  companyName: string;
  fetchImpl: typeof fetch;
};

let cache: TokenCache | null = null;
let overrides: TestOverrides | null = null;

export function __setTestEnv(o: TestOverrides): void {
  overrides = o;
}
export function __resetTokenCache(): void {
  cache = null;
  overrides = null;
}

/**
 * Force the next getBcAccessToken() call to re-fetch from Microsoft.
 * Called by bcClient on HTTP 401 (the cached token was rejected mid-flight,
 * e.g. tenant rotated the client secret between cache fill and use).
 * Unlike __resetTokenCache, this does NOT clear test overrides — it is a
 * production code path that needs to survive between test invocations.
 */
export function invalidateBcToken(): void {
  cache = null;
}

export async function getBcAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt - now > 60_000) {
    return cache.token;
  }

  const env = overrides ?? getBcEnv();
  const fetchImpl = overrides?.fetchImpl ?? fetch;

  const url = `https://login.microsoftonline.com/${env.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.businesscentral.dynamics.com/.default",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BC token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cache.token;
}
