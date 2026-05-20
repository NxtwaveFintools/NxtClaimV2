import { getBcEnv } from "./bcEnv.ts";

const BASE_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
} as const;

type TestOverrides = { allowedOrigins: Set<string> };
let overrides: TestOverrides | null = null;

// Test-only seam. In tests, call __setCorsTestOverrides({ allowedOrigins: ... })
// to bypass the env reader. Pass null to restore env-driven behaviour.
export function __setCorsTestOverrides(o: TestOverrides | null): void {
  overrides = o;
}

function getAllowedOrigins(): Set<string> {
  if (overrides) return overrides.allowedOrigins;
  return getBcEnv().allowedOrigins;
}

/**
 * Resolves CORS for a request. NOTE: the returned `allow` flag is advisory — it
 * governs only the preflight (corsPreflightResponse) and which response headers a
 * browser will honor. It is NOT an authorization gate: every BC endpoint
 * independently enforces auth (requireAuthenticatedUser / requireFinanceApprover),
 * which is the real protection. We deliberately do not 403 real requests on Origin
 * so server-to-server callers (which send no Origin header) keep working.
 */
export function resolveCors(req: Request): {
  allow: boolean;
  headers: Record<string, string>;
} {
  const origin = req.headers.get("Origin");
  if (!origin) {
    return { allow: false, headers: { Vary: "Origin" } };
  }
  const allowed = getAllowedOrigins();
  if (allowed.has(origin)) {
    return {
      allow: true,
      headers: { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin },
    };
  }
  return { allow: false, headers: { Vary: "Origin" } };
}

export function corsPreflightResponse(req: Request): Response {
  const { allow, headers } = resolveCors(req);
  return new Response(null, { status: allow ? 204 : 403, headers });
}
