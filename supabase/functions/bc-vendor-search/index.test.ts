/**
 * Deno tests for bc-vendor-search. Locks the C3 invariant: when BC returns
 * both a code-match list (No filter) and a name-match list (Name filter),
 * code matches MUST appear first in the merged 20-cap output.
 *
 * Pattern mirrors bc-reference/index.test.ts (same auth + bcFetch + cors test
 * seams).
 */
import { assertEquals } from "std/assert/mod.ts";
import { __resetTokenCache, __setTestEnv } from "../_shared/bcAuth.ts";
import { __setBcFetchImpl } from "../_shared/bcClient.ts";
import { __setCorsTestOverrides } from "../_shared/cors.ts";
import { __setAuthClientFactory } from "../_shared/auth.ts";
import { __resetBcEnvCache } from "../_shared/bcEnv.ts";
import { handler } from "./index.ts";

function fakeAuthClient() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "u" } }, error: null }),
    },
  } as unknown as ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>;
}

const TEST_BC_ENV: Record<string, string> = {
  BC_TENANT_ID: "test-tenant",
  BC_CLIENT_ID: "test-client",
  BC_CLIENT_SECRET: "test-secret",
  BC_ENVIRONMENT: "Sandbox_Test",
  BC_COMPANY_ID: "test-company-id",
  BC_COMPANY_NAME: "NxtWave",
};

function setup(): void {
  __resetBcEnvCache();
  __resetTokenCache();
  __setCorsTestOverrides({ allowedOrigins: new Set() });
  __setAuthClientFactory(() => fakeAuthClient());
  for (const [k, v] of Object.entries(TEST_BC_ENV)) Deno.env.set(k, v);
  __setTestEnv({
    tenantId: "test-tenant",
    clientId: "test-client",
    clientSecret: "test-secret",
    environment: "Sandbox_Test",
    companyId: "test-company-id",
    companyName: "NxtWave",
    fetchImpl: async () =>
      new Response(JSON.stringify({ access_token: "tok-A", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
}

function teardown(): void {
  __setBcFetchImpl(null);
  __setCorsTestOverrides(null);
  __setAuthClientFactory(null);
  __resetTokenCache();
  __resetBcEnvCache();
}

function postSearch(query: string): Request {
  return new Request("http://localhost/bc-vendor-search", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

Deno.test(
  "bc-vendor-search — code matches appear before name matches in merged output",
  async () => {
    setup();
    // Route the two parallel BC OData fetches by inspecting the $filter param.
    // - Name filter: returns V-NAME-1 and V-NAME-2
    // - No filter:   returns V-CODE-1 and V-CODE-2
    __setBcFetchImpl(async (input) => {
      const url = typeof input === "string" ? input : (input as Request | URL).toString();
      // encodeURIComponent leaves `(` unencoded; filter is `contains(No,'…')` or
      // `contains(Name,'…')`. Test the un-encoded prefix.
      const isNoFilter = /contains\(No/.test(url);
      const value = isNoFilter
        ? [
            { No: "V-CODE-1", Name: "ACME (matched-by-code)" },
            { No: "V-CODE-2", Name: "BCDE (matched-by-code)" },
          ]
        : [
            { No: "V-NAME-1", Name: "QueryHit Alpha" },
            { No: "V-NAME-2", Name: "QueryHit Beta" },
          ];
      return new Response(JSON.stringify({ value }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const res = await handler(postSearch("query"));
      assertEquals(res.status, 200);
      const body = (await res.json()) as { vendors: Array<{ no: string; name: string }> };
      assertEquals(
        body.vendors.map((v) => v.no),
        ["V-CODE-1", "V-CODE-2", "V-NAME-1", "V-NAME-2"],
      );
    } finally {
      teardown();
    }
  },
);

Deno.test(
  "bc-vendor-search — overlapping No+Name match dedups by No, code-source wins",
  async () => {
    setup();
    // Both lists return the same vendor V-DUP. The merged map keeps the first
    // insertion (the code-source side, since [...noData, ...nameData]).
    __setBcFetchImpl(async (input) => {
      const url = typeof input === "string" ? input : (input as Request | URL).toString();
      // encodeURIComponent leaves `(` unencoded; filter is `contains(No,'…')` or
      // `contains(Name,'…')`. Test the un-encoded prefix.
      const isNoFilter = /contains\(No/.test(url);
      const value = isNoFilter
        ? [
            { No: "V-DUP", Name: "From-Code-Source" },
            { No: "V-CODE-ONLY", Name: "Code-Only" },
          ]
        : [
            { No: "V-DUP", Name: "From-Name-Source" },
            { No: "V-NAME-ONLY", Name: "Name-Only" },
          ];
      return new Response(JSON.stringify({ value }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const res = await handler(postSearch("query"));
      assertEquals(res.status, 200);
      const body = (await res.json()) as { vendors: Array<{ no: string; name: string }> };
      // V-DUP must keep the code-source name (first-write wins under Map.set guard)
      const dup = body.vendors.find((v) => v.no === "V-DUP");
      assertEquals(dup?.name, "From-Code-Source");
      // Order: V-DUP, V-CODE-ONLY (both from byNo), then V-NAME-ONLY
      assertEquals(
        body.vendors.map((v) => v.no),
        ["V-DUP", "V-CODE-ONLY", "V-NAME-ONLY"],
      );
    } finally {
      teardown();
    }
  },
);

Deno.test("bc-vendor-search — merged result is capped at 20 vendors", async () => {
  setup();
  // byNo returns 15 unique vendors; byName returns 10 more unique. Total = 25,
  // capped to 20 with byNo entries winning the cap.
  __setBcFetchImpl(async (input) => {
    const url = typeof input === "string" ? input : (input as Request | URL).toString();
    // encodeURIComponent leaves `(` unencoded; filter is `contains(No,'…')` or
    // `contains(Name,'…')`. Test the un-encoded prefix.
    const isNoFilter = /contains\(No/.test(url);
    const value = isNoFilter
      ? Array.from({ length: 15 }, (_, i) => ({ No: `V-CODE-${i}`, Name: `code ${i}` }))
      : Array.from({ length: 10 }, (_, i) => ({ No: `V-NAME-${i}`, Name: `name ${i}` }));
    return new Response(JSON.stringify({ value }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  try {
    const res = await handler(postSearch("query"));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { vendors: Array<{ no: string; name: string }> };
    assertEquals(body.vendors.length, 20);
    // First 15 must all be code matches; last 5 are name matches.
    for (let i = 0; i < 15; i++) assertEquals(body.vendors[i].no, `V-CODE-${i}`);
    for (let i = 15; i < 20; i++) assertEquals(body.vendors[i].no, `V-NAME-${i - 15}`);
  } finally {
    teardown();
  }
});
