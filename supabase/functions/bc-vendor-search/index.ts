import { z } from "zod";
import { getBcAccessToken } from "../_shared/bcAuth.ts";
import { getBcEnv } from "../_shared/bcEnv.ts";
import { CORS_HEADERS, corsPreflight } from "../_shared/cors.ts";

const InputSchema = z.object({
  query: z.string().trim().min(1).max(60),
});

type BcVendor = { No: string; Name: string };
type BcVendorResponse = { value?: BcVendor[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsPreflight();
  }
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return json({ error: "INVALID_INPUT", issues: parsed.error.flatten() }, 400);

  const env = getBcEnv();
  const token = await getBcAccessToken();

  // BC's OData contains() is case-sensitive, so we wrap both sides in
  // tolower() to give Finance approvers an ergonomic, case-insensitive
  // search. Also: BC rejects OR across distinct fields, so we issue two
  // parallel queries (Name, No) and merge/dedupe.
  const lower = parsed.data.query.toLowerCase();
  const escaped = lower.replace(/'/g, "''");
  const baseUrl =
    `https://api.businesscentral.dynamics.com/v2.0/${env.tenantId}/${env.environment}` +
    `/ODataV4/Company('${encodeURIComponent(env.companyName)}')/vendors`;
  const buildUrl = (filter: string) => `${baseUrl}?$filter=${encodeURIComponent(filter)}&$top=20`;

  const [byName, byNo] = await Promise.all([
    fetch(buildUrl(`contains(tolower(Name),'${escaped}')`), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(buildUrl(`contains(tolower(No),'${escaped}')`), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  for (const r of [byName, byNo]) {
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return json({ error: "BC_API_ERROR", status: r.status, body: text.slice(0, 500) }, 502);
    }
  }

  const [nameData, noData] = (await Promise.all([
    byName.json(),
    byNo.json(),
  ])) as BcVendorResponse[];
  const merged = new Map<string, { no: string; name: string }>();
  for (const v of [...(nameData.value ?? []), ...(noData.value ?? [])]) {
    if (!merged.has(v.No)) merged.set(v.No, { no: v.No, name: v.Name });
    if (merged.size >= 20) break;
  }
  return json({ vendors: Array.from(merged.values()) });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
