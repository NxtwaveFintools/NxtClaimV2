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
};

let cached: BcEnv | null = null;

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
  };
  return cached;
}
