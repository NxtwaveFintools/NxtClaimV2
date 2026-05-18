const REQUIRED_KEYS = [
  "BC_TENANT_ID",
  "BC_CLIENT_ID",
  "BC_CLIENT_SECRET",
  "BC_ENVIRONMENT",
  "BC_COMPANY_ID",
  "BC_COMPANY_NAME",
] as const;

export type BcEnv = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
  companyName: string;
  // BC_ALLOWED_ORIGINS is optional. Empty/missing => empty set => browsers
  // from any origin are blocked by the CORS check. Server-to-server callers
  // (without an Origin header) are unaffected by the allow-list.
  allowedOrigins: Set<string>;
};

let cached: BcEnv | null = null;

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function getBcEnv(): BcEnv {
  if (cached) return cached;

  const missing: string[] = [];
  const values: Record<string, string> = {};

  for (const key of REQUIRED_KEYS) {
    const v = Deno.env.get(key);
    if (!v || v.trim().length === 0) {
      missing.push(key);
    } else {
      values[key] = v;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing BC environment variables: ${missing.join(", ")}`);
  }

  cached = {
    tenantId: values.BC_TENANT_ID,
    clientId: values.BC_CLIENT_ID,
    clientSecret: values.BC_CLIENT_SECRET,
    environment: values.BC_ENVIRONMENT,
    companyId: values.BC_COMPANY_ID,
    companyName: values.BC_COMPANY_NAME,
    allowedOrigins: parseAllowedOrigins(Deno.env.get("BC_ALLOWED_ORIGINS")),
  };
  return cached;
}

// Test-only seam. Allows tests to reset the module-level cache.
export function __resetBcEnvCache(): void {
  cached = null;
}
