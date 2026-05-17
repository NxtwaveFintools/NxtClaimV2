import { bcFetch } from "../_shared/bcClient.ts";
import { corsPreflightResponse, resolveCors } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";

/**
 * bc-reference — returns code+description pairs for Finance modal dropdowns.
 * Three entity types map to BC OData entity paths:
 *   currencies     → /currencies
 *   gstGroupCodes  → /gstGroup
 *   hsnSacCodes    → /hsnSAC
 *
 * Each request pulls only Code + Description via `$select=Code,Description`
 * to avoid BC's 35+ field default response.
 *
 * In-memory cache per edge function instance — 15-minute TTL. Currency / GST /
 * HSN-SAC tables change rarely (weeks to months), so this collapses every
 * subsequent modal open into a sub-50ms cache hit. Cache is per-instance:
 * cold start re-fetches, which is fine for idempotent reference data.
 */

const CACHE_TTL_MS = 15 * 60 * 1000;

const ENTITY_MAP: Record<string, string> = {
  currencies: "currencies",
  gstGroupCodes: "gstGroup",
  hsnSacCodes: "hsnSAC",
};

interface CacheEntry {
  body: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function __resetCacheForTest(): void {
  cache.clear();
}

function json(corsHeaders: Record<string, string>, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }
  const cors = resolveCors(req);

  if (req.method !== "GET") {
    return json(cors.headers, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";

  const entity = ENTITY_MAP[type];
  if (!entity) {
    return json(
      cors.headers,
      { error: "UNKNOWN_TYPE", type, allowed: Object.keys(ENTITY_MAP) },
      400,
    );
  }

  const cached = cache.get(type);
  if (cached && cached.expiresAt > Date.now()) {
    log("bc-reference", "info", "cache_hit", { type });
    return json(cors.headers, cached.body, 200);
  }

  const path = `/${entity}?$select=Code,Description`;
  let result;
  try {
    result = await bcFetch("odata", "GET", path);
  } catch (err) {
    log("bc-reference", "error", "bc_fetch_outcome", {
      type,
      bc_status: 0,
      error: String(err).slice(0, 500),
    });
    return json(
      cors.headers,
      { error: "BC_REFERENCE_FETCH_FAILED", type, detail: String(err) },
      502,
    );
  }

  if (result.status < 200 || result.status >= 300) {
    log("bc-reference", "warn", "bc_fetch_outcome", {
      type,
      bc_status: result.status,
    });
    return json(
      cors.headers,
      { error: "BC_REFERENCE_FETCH_FAILED", type, status: result.status, detail: result.body },
      502,
    );
  }

  const data = result.body as { value?: Array<{ Code?: string; Description?: string }> };
  const mapped = {
    value: (data.value ?? []).map((r) => ({
      code: r.Code ?? "",
      description: r.Description ?? "",
    })),
  };

  log("bc-reference", "info", "bc_fetch_outcome", {
    type,
    bc_status: result.status,
    count: mapped.value.length,
  });
  cache.set(type, { body: mapped, expiresAt: Date.now() + CACHE_TTL_MS });
  return json(cors.headers, mapped, 200);
}

Deno.serve(handler);
