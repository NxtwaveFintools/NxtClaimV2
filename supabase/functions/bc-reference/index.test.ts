import { assertEquals } from "std/assert/mod.ts";
import { __resetTokenCache, __setTestEnv } from "../_shared/bcAuth.ts";
import { __setBcFetchImpl } from "../_shared/bcClient.ts";
import { __setCorsTestOverrides } from "../_shared/cors.ts";
import { __setAuthClientFactory } from "../_shared/auth.ts";
import { __resetBcEnvCache } from "../_shared/bcEnv.ts";
import { __resetCacheForTest, handler } from "./index.ts";

function fakeAuthClient() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "test-user-id" } }, error: null }),
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
  __resetCacheForTest();
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
  __resetCacheForTest();
  __resetBcEnvCache();
}

function makeReq(type: string, method: "GET" | "POST" | "OPTIONS" = "GET"): Request {
  return new Request(`http://localhost/bc-reference?type=${type}`, {
    method,
    headers: method !== "OPTIONS" ? { Authorization: "Bearer test-token" } : {},
  });
}

Deno.test("bc-reference — currencies returns lowercased {code, description}", async () => {
  setup();
  __setBcFetchImpl(
    async () =>
      new Response(
        JSON.stringify({
          value: [
            { Code: "INR", Description: "Indian Rupee" },
            { Code: "USD", Description: "US Dollar" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  try {
    const res = await handler(makeReq("currencies"));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      value: [
        { code: "INR", description: "Indian Rupee" },
        { code: "USD", description: "US Dollar" },
      ],
    });
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — gstGroupCodes uses the gstGroup entity path", async () => {
  setup();
  let lastUrl = "";
  __setBcFetchImpl(async (input) => {
    lastUrl = typeof input === "string" ? input : (input as URL).toString();
    return new Response(JSON.stringify({ value: [{ Code: "GST18", Description: "GST 18%" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await handler(makeReq("gstGroupCodes"));
    assertEquals(
      lastUrl.endsWith("/ODataV4/Company('NxtWave')/gstGroup?$select=Code,Description"),
      true,
    );
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — hsnSacCodes uses the hsnSAC entity path", async () => {
  setup();
  let lastUrl = "";
  __setBcFetchImpl(async (input) => {
    lastUrl = typeof input === "string" ? input : (input as URL).toString();
    return new Response(JSON.stringify({ value: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await handler(makeReq("hsnSacCodes"));
    // $top=20 is now always appended for hsnSacCodes
    assertEquals(
      lastUrl.includes("/ODataV4/Company('NxtWave')/hsnSAC?$select=Code,Description"),
      true,
    );
    assertEquals(lastUrl.includes("$top=20"), true);
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — unknown type returns 400", async () => {
  setup();
  try {
    const res = await handler(makeReq("nope"));
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "UNKNOWN_TYPE");
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — non-GET returns 405", async () => {
  setup();
  try {
    const res = await handler(makeReq("currencies", "POST"));
    assertEquals(res.status, 405);
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — BC failure returns 502", async () => {
  setup();
  __setBcFetchImpl(async () => new Response("BC service unavailable", { status: 503 }));
  try {
    const res = await handler(makeReq("currencies"));
    assertEquals(res.status, 502);
    const body = await res.json();
    assertEquals(body.error, "BC_REFERENCE_FETCH_FAILED");
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — second hit within cache window does not refetch BC", async () => {
  setup();
  let calls = 0;
  __setBcFetchImpl(async () => {
    calls += 1;
    return new Response(JSON.stringify({ value: [{ Code: "INR", Description: "Indian Rupee" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await handler(makeReq("currencies"));
    await handler(makeReq("currencies"));
    assertEquals(calls, 1);
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — different types use independent cache slots", async () => {
  setup();
  let calls = 0;
  __setBcFetchImpl(async () => {
    calls += 1;
    return new Response(JSON.stringify({ value: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await handler(makeReq("currencies"));
    await handler(makeReq("gstGroupCodes"));
    await handler(makeReq("hsnSacCodes"));
    assertEquals(calls, 3);
  } finally {
    teardown();
  }
});

Deno.test("bc-reference — hsnSacCodes with no query returns first 20", async () => {
  setup();
  let capturedUrl = "";
  __setBcFetchImpl(async (input) => {
    capturedUrl = typeof input === "string" ? input : (input as URL).toString();
    return new Response(JSON.stringify({ value: [{ Code: "996", Description: "Services" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const res = await handler(makeReq("hsnSacCodes"));
    assertEquals(res.status, 200);
    assertEquals(capturedUrl.includes("%24top=20") || capturedUrl.includes("$top=20"), true);
    assertEquals(capturedUrl.includes("%24filter=") || capturedUrl.includes("$filter="), false);
  } finally {
    teardown();
  }
});

Deno.test(
  "bc-reference — hsnSacCodes with ?query=996 sends contains() filter OR-ed across case variants",
  async () => {
    setup();
    let capturedUrl = "";
    __setBcFetchImpl(async (input) => {
      capturedUrl = typeof input === "string" ? input : (input as URL).toString();
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const req = new Request("http://localhost/bc-reference?type=hsnSacCodes&query=996", {
        method: "GET",
        headers: { Authorization: "Bearer test-token" },
      });
      const res = await handler(req);
      assertEquals(res.status, 200);
      const hasTop = capturedUrl.includes("%24top=20") || capturedUrl.includes("$top=20");
      assertEquals(hasTop, true);
      const hasFilter = capturedUrl.includes("%24filter=") || capturedUrl.includes("$filter=");
      assertEquals(hasFilter, true);
      const decoded = decodeURIComponent(capturedUrl);
      assertEquals(decoded.includes("contains(Code,'996')"), true);
      assertEquals(decoded.includes("contains(Description,'996')"), true);
    } finally {
      teardown();
    }
  },
);

Deno.test("bc-reference — currencies ignores ?query= (full list always)", async () => {
  setup();
  let capturedUrl = "";
  __setBcFetchImpl(async (input) => {
    capturedUrl = typeof input === "string" ? input : (input as URL).toString();
    return new Response(JSON.stringify({ value: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const req = new Request("http://localhost/bc-reference?type=currencies&query=USD", {
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    assertEquals(capturedUrl.includes("%24filter=") || capturedUrl.includes("$filter="), false);
    assertEquals(capturedUrl.includes("%24top=") || capturedUrl.includes("$top="), false);
  } finally {
    teardown();
  }
});
