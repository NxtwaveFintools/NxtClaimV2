import { z } from "zod";
import { bcFetch } from "../_shared/bcClient.ts";
import { corsPreflightResponse, resolveCors } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";

const InputSchema = z.object({
  query: z.string().trim().min(1).max(60),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }
  const cors = resolveCors(req);

  if (req.method !== "POST") {
    return json(cors.headers, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(cors.headers, { error: "INVALID_JSON" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return json(cors.headers, { error: "INVALID_INPUT", issues: parsed.error.flatten() }, 400);
  }

  const t0 = Date.now();

  // BC's contains(tolower(field), value) is unreliable for partial substring
  // search on Name — likely because the underlying SQL collation isn't applied
  // the way OData's tolower() docs imply. Workaround: generate a small set of
  // case variants (as-typed, lower, upper, capitalize-first) and OR them
  // across the same field. BC allows OR within a field but rejects it across
  // distinct fields. No (Code field) is always upper in BC, so only upper variant.
  const q = parsed.data.query;
  const variants = Array.from(
    new Set([
      q,
      q.toLowerCase(),
      q.toUpperCase(),
      q.charAt(0).toUpperCase() + q.slice(1).toLowerCase(),
    ]),
  ).map((v) => v.replace(/'/g, "''"));

  const nameFilter = variants.map((v) => `contains(Name,'${v}')`).join(" or ");
  const noFilter = `contains(No,'${q.toUpperCase().replace(/'/g, "''")}')`;
  const path = (filter: string) => `/vendors?$filter=${encodeURIComponent(filter)}&$top=20`;

  let byName, byNo;
  try {
    [byName, byNo] = await Promise.all([
      bcFetch("odata", "GET", path(nameFilter)),
      bcFetch("odata", "GET", path(noFilter)),
    ]);
  } catch (err) {
    log("bc-vendor-search", "error", "search_outcome", {
      query: q,
      bc_status: 0,
      duration_ms: Date.now() - t0,
      error: String(err).slice(0, 500),
    });
    return json(
      cors.headers,
      { error: "BC_API_ERROR", status: 0, body: String(err).slice(0, 500) },
      502,
    );
  }

  for (const r of [byName, byNo]) {
    if (r.status < 200 || r.status >= 300) {
      log("bc-vendor-search", "warn", "search_outcome", {
        query: q,
        bc_status: r.status,
        duration_ms: Date.now() - t0,
      });
      return json(cors.headers, { error: "BC_API_ERROR", status: r.status, body: r.body }, 502);
    }
  }

  const nameData = byName.body as { value?: Array<{ No: string; Name: string }> };
  const noData = byNo.body as { value?: Array<{ No: string; Name: string }> };

  const merged = new Map<string, { no: string; name: string }>();
  for (const v of [...(nameData.value ?? []), ...(noData.value ?? [])]) {
    if (!merged.has(v.No)) merged.set(v.No, { no: v.No, name: v.Name });
    if (merged.size >= 20) break;
  }
  log("bc-vendor-search", "info", "search_outcome", {
    query: q,
    bc_status: 200,
    duration_ms: Date.now() - t0,
    result_count: merged.size,
  });
  return json(cors.headers, { vendors: Array.from(merged.values()) });
});

function json(corsHeaders: Record<string, string>, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
