import { z } from "zod";
import { getBcAccessToken } from "../_shared/bcAuth.ts";
import { getBcEnv } from "../_shared/bcEnv.ts";

const InputSchema = z.object({
  query: z.string().trim().min(1).max(60),
});

type BcVendor = { No: string; Name: string };
type BcVendorResponse = { value?: BcVendor[] };

Deno.serve(async (req) => {
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

  // OData $filter escapes single quotes by doubling them.
  const escaped = parsed.data.query.replace(/'/g, "''");
  const filter = `contains(No,'${escaped}') or contains(Name,'${escaped}')`;
  const url =
    `https://api.businesscentral.dynamics.com/v2.0/${env.tenantId}/${env.environment}` +
    `/ODataV4/Company('${encodeURIComponent(env.companyName)}')/vendors` +
    `?$filter=${encodeURIComponent(filter)}&$top=20`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ error: "BC_API_ERROR", status: res.status, body: text.slice(0, 500) }, 502);
  }

  const data = (await res.json()) as BcVendorResponse;
  const vendors = (data.value ?? []).map((v) => ({ no: v.No, name: v.Name }));
  return json({ vendors });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
