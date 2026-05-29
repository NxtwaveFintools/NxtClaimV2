import { bcFetch } from "../_shared/bcClient.ts";
import { corsPreflightResponse, resolveCors } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";
import { requireAuthenticatedUser } from "../_shared/auth.ts";
import { escapeOdataLiteral, sanitizeBcSearchQuery } from "../_shared/bcSearch.ts";

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

type BcReferenceRow = { Code?: string; Description?: string };
type ReferenceOption = { code: string; description: string };

const cache = new Map<string, CacheEntry>();

// Test seam — clears the in-memory cache between test cases.
// Prefixed __ to mark as not-for-production; matches __setBcFetchImpl in bcClient.ts.
export function __resetCacheForTest(): void {
  cache.clear();
}

function json(corsHeaders: Record<string, string>, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function normalizeRows(rows: BcReferenceRow[]): ReferenceOption[] {
  return rows.map((r) => ({
    code: r.Code ?? "",
    description: r.Description ?? "",
  }));
}

function buildContainsFilter(field: "Code" | "Description", query: string): string {
  return `contains(${field},'${escapeOdataLiteral(query)}')`;
}

function isUnsupportedDescriptionSearch(result: { status: number; body: unknown }): boolean {
  if (result.status !== 400 && result.status !== 501) return false;

  const body = result.body as { error?: { code?: unknown; message?: unknown } };
  const code = typeof body.error?.code === "string" ? body.error.code.toLowerCase() : "";
  const message = typeof body.error?.message === "string" ? body.error.message.toLowerCase() : "";

  return (
    code.includes("notimplemented") ||
    code.includes("notfound") ||
    message.includes("not supported") ||
    message.includes("could not find") ||
    message.includes("description")
  );
}

function mergeHsnSacResults(
  query: string,
  codeRows: BcReferenceRow[],
  descriptionRows: BcReferenceRow[],
): ReferenceOption[] {
  const q = query.toLowerCase();
  const codeMatches = normalizeRows(codeRows);
  const descriptionMatches = normalizeRows(descriptionRows);

  const exactCode = codeMatches.filter((r) => r.code.toLowerCase() === q);
  const prefixCode = codeMatches.filter((r) => {
    const code = r.code.toLowerCase();
    return code !== q && code.startsWith(q);
  });
  const otherCode = codeMatches.filter((r) => {
    const code = r.code.toLowerCase();
    return code !== q && !code.startsWith(q);
  });

  const merged = new Map<string, ReferenceOption>();
  for (const item of [...exactCode, ...prefixCode, ...otherCode, ...descriptionMatches]) {
    if (!merged.has(item.code)) merged.set(item.code, item);
    if (merged.size >= 20) break;
  }
  return Array.from(merged.values());
}

async function fetchHsnSacCodes(query: string): Promise<{
  body?: { value: ReferenceOption[] };
  failure?: { path: "code" | "description"; status: number; detail: unknown };
}> {
  const basePath = "/hsnSAC?$select=Code,Description&$top=20";
  const codeOnlyBasePath = "/hsnSAC?$select=Code&$top=20";

  if (!query) {
    const result = await bcFetch("odata", "GET", basePath);
    if (result.status < 200 || result.status >= 300) {
      return {
        failure: { path: "code", status: result.status, detail: result.body },
      };
    }
    const data = result.body as { value?: BcReferenceRow[] };
    return { body: { value: normalizeRows(data.value ?? []) } };
  }

  const path = (base: string, field: "Code" | "Description") =>
    `${base}&$filter=${encodeURIComponent(buildContainsFilter(field, query))}`;

  const [codeResult, descriptionResult] = await Promise.allSettled([
    bcFetch("odata", "GET", path(basePath, "Code")),
    bcFetch("odata", "GET", path(basePath, "Description")),
  ]);

  if (codeResult.status === "rejected") {
    return {
      failure: { path: "code", status: 0, detail: String(codeResult.reason) },
    };
  }

  let codeResponse = codeResult.value;
  if (codeResponse.status < 200 || codeResponse.status >= 300) {
    if (isUnsupportedDescriptionSearch(codeResponse)) {
      codeResponse = await bcFetch("odata", "GET", path(codeOnlyBasePath, "Code"));
    }
  }

  if (codeResponse.status < 200 || codeResponse.status >= 300) {
    return {
      failure: {
        path: "code",
        status: codeResponse.status,
        detail: codeResponse.body,
      },
    };
  }

  const codeData = codeResponse.body as { value?: BcReferenceRow[] };

  if (descriptionResult.status === "rejected") {
    log("bc-reference", "warn", "hsn_description_search_failed", {
      type: "hsnSacCodes",
      query,
      bc_status: 0,
      error: String(descriptionResult.reason).slice(0, 500),
    });
    return {
      body: { value: mergeHsnSacResults(query, codeData.value ?? [], []) },
    };
  }

  const descriptionResponse = descriptionResult.value;
  if (descriptionResponse.status < 200 || descriptionResponse.status >= 300) {
    if (isUnsupportedDescriptionSearch(descriptionResponse)) {
      log("bc-reference", "warn", "hsn_description_search_unsupported", {
        type: "hsnSacCodes",
        query,
        bc_status: descriptionResponse.status,
      });
      return {
        body: { value: mergeHsnSacResults(query, codeData.value ?? [], []) },
      };
    }
    return {
      failure: {
        path: "description",
        status: descriptionResponse.status,
        detail: descriptionResponse.body,
      },
    };
  }

  const descriptionData = descriptionResponse.body as {
    value?: BcReferenceRow[];
  };
  return {
    body: {
      value: mergeHsnSacResults(query, codeData.value ?? [], descriptionData.value ?? []),
    },
  };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }
  const cors = resolveCors(req);

  if (req.method !== "GET") {
    return json(cors.headers, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) {
    log("bc-reference", "warn", "auth_failed");
    return json(cors.headers, { error: "UNAUTHENTICATED" }, auth.status);
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

  // HSN/SAC alone supports an optional ?query= for search-as-you-type, since
  // BC can hold 10k+ codes; currencies (~150) and GST groups (~30) always
  // return the full list (small + rarely changes + worth caching in full).
  const query =
    type === "hsnSacCodes" ? sanitizeBcSearchQuery(url.searchParams.get("query") ?? "") : "";

  // Cache key includes the query so different searches don't poison each other.
  const cacheKey = type === "hsnSacCodes" ? `${type}::${query}` : type;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    log("bc-reference", "info", "cache_hit", {
      type,
      query: query || undefined,
    });
    return json(cors.headers, cached.body, 200);
  }

  let mapped: { value: ReferenceOption[] };
  try {
    if (type === "hsnSacCodes") {
      const result = await fetchHsnSacCodes(query);
      if (result.failure) {
        log("bc-reference", "warn", "bc_fetch_outcome", {
          type,
          path: result.failure.path,
          bc_status: result.failure.status,
        });
        return json(
          cors.headers,
          {
            error: "BC_REFERENCE_FETCH_FAILED",
            type,
            status: result.failure.status,
            detail: result.failure.detail,
          },
          502,
        );
      }
      mapped = result.body ?? { value: [] };
    } else {
      const result = await bcFetch("odata", "GET", `/${entity}?$select=Code,Description`);
      if (result.status < 200 || result.status >= 300) {
        log("bc-reference", "warn", "bc_fetch_outcome", {
          type,
          bc_status: result.status,
        });
        return json(
          cors.headers,
          {
            error: "BC_REFERENCE_FETCH_FAILED",
            type,
            status: result.status,
            detail: result.body,
          },
          502,
        );
      }
      const data = result.body as { value?: BcReferenceRow[] };
      mapped = { value: normalizeRows(data.value ?? []) };
    }
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

  log("bc-reference", "info", "bc_fetch_outcome", {
    type,
    bc_status: 200,
    count: mapped.value.length,
  });
  cache.set(cacheKey, { body: mapped, expiresAt: Date.now() + CACHE_TTL_MS });
  return json(cors.headers, mapped, 200);
}

if (import.meta.main) Deno.serve(handler);
