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
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "test-user-id" } },
          error: null,
        }),
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

function makeReq(
  type: string,
  method: "GET" | "POST" | "OPTIONS" = "GET",
  params: Record<string, string> = {},
): Request {
  const search = new URLSearchParams({ type, ...params });
  return new Request(`http://localhost/bc-reference?${search.toString()}`, {
    method,
    headers: method !== "OPTIONS" ? { Authorization: "Bearer test-token" } : {},
  });
}

Deno.test("bc-reference - currencies returns lowercased {code, description}", async () => {
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

Deno.test("bc-reference - gstGroupCodes uses the gstGroup entity path", async () => {
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

Deno.test("bc-reference - hsnSacCodes uses the hsnSAC entity path", async () => {
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
    assertEquals(
      lastUrl.includes("/ODataV4/Company('NxtWave')/hsnSAC?$select=Code,Description"),
      true,
    );
    assertEquals(lastUrl.includes("$top=20"), true);
  } finally {
    teardown();
  }
});

Deno.test("bc-reference - unknown type returns 400", async () => {
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

Deno.test("bc-reference - non-GET returns 405", async () => {
  setup();
  try {
    const res = await handler(makeReq("currencies", "POST"));
    assertEquals(res.status, 405);
  } finally {
    teardown();
  }
});

Deno.test("bc-reference - BC failure returns 502", async () => {
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

Deno.test("bc-reference - second hit within cache window does not refetch BC", async () => {
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

Deno.test("bc-reference - different types use independent cache slots", async () => {
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

Deno.test("bc-reference - hsnSacCodes with no query returns first 20", async () => {
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

Deno.test("bc-reference - hsnSacCodes query never sends an OData OR filter", async () => {
  setup();
  const capturedUrls: string[] = [];
  __setBcFetchImpl(async (input) => {
    capturedUrls.push(typeof input === "string" ? input : (input as URL).toString());
    return new Response(JSON.stringify({ value: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const res = await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
    assertEquals(res.status, 200);
    assertEquals(capturedUrls.length, 2);
    assertEquals(
      capturedUrls.some((u) => decodeURIComponent(u).includes(" or ")),
      false,
    );
  } finally {
    teardown();
  }
});

Deno.test(
  "bc-reference - hsnSacCodes query uses separate Code and Description requests",
  async () => {
    setup();
    const capturedUrls: string[] = [];
    __setBcFetchImpl(async (input) => {
      capturedUrls.push(typeof input === "string" ? input : (input as URL).toString());
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const res = await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
      assertEquals(res.status, 200);
      assertEquals(capturedUrls.length, 2);
      const decoded = capturedUrls.map((u) => decodeURIComponent(u));
      assertEquals(
        decoded.some((u) => u.includes("contains(Code,'998')")),
        true,
      );
      assertEquals(
        decoded.some((u) => u.includes("contains(Description,'998')")),
        true,
      );
    } finally {
      teardown();
    }
  },
);

Deno.test(
  "bc-reference - hsnSacCodes merges, dedupes, and orders code matches before description matches",
  async () => {
    setup();
    __setBcFetchImpl(async (input) => {
      const url = decodeURIComponent(typeof input === "string" ? input : (input as URL).toString());
      const value = url.includes("contains(Code")
        ? [
            { Code: "1998", Description: "Contains code match" },
            { Code: "9980", Description: "Prefix code match" },
            { Code: "998", Description: "Exact code match" },
            { Code: "DUP", Description: "From code search" },
          ]
        : [
            { Code: "DUP", Description: "From description search" },
            { Code: "DESC1", Description: "998 services" },
          ];
      return new Response(JSON.stringify({ value }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const res = await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        value: Array<{ code: string; description: string }>;
      };
      assertEquals(
        body.value.map((v) => v.code),
        ["998", "9980", "1998", "DUP", "DESC1"],
      );
      assertEquals(body.value.find((v) => v.code === "DUP")?.description, "From code search");
    } finally {
      teardown();
    }
  },
);

Deno.test("bc-reference - hsnSacCodes merged result is capped at 20", async () => {
  setup();
  __setBcFetchImpl(async (input) => {
    const url = decodeURIComponent(typeof input === "string" ? input : (input as URL).toString());
    const value = url.includes("contains(Code")
      ? Array.from({ length: 15 }, (_, i) => ({ Code: `998${i}`, Description: `code ${i}` }))
      : Array.from({ length: 10 }, (_, i) => ({ Code: `DESC${i}`, Description: `desc ${i}` }));
    return new Response(JSON.stringify({ value }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const res = await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      value: Array<{ code: string; description: string }>;
    };
    assertEquals(body.value.length, 20);
  } finally {
    teardown();
  }
});

Deno.test("bc-reference - hsnSacCodes cache key includes query", async () => {
  setup();
  const capturedUrls: string[] = [];
  __setBcFetchImpl(async (input) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    capturedUrls.push(url);
    const decoded = decodeURIComponent(url);
    const code = decoded.includes("'998'") ? "998" : "997";
    return new Response(JSON.stringify({ value: [{ Code: code, Description: code }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
    await handler(makeReq("hsnSacCodes", "GET", { query: "997" }));
    await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
    assertEquals(capturedUrls.length, 4);
  } finally {
    teardown();
  }
});

Deno.test(
  "bc-reference - hsnSacCodes returns code results when Description search is unsupported",
  async () => {
    setup();
    __setBcFetchImpl(async (input) => {
      const url = decodeURIComponent(typeof input === "string" ? input : (input as URL).toString());
      if (url.includes("contains(Description")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "BadRequest_FieldNotFound",
              message: "Could not find a property named 'Description'.",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          value: [{ Code: "998", Description: "Code result" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const res = await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), {
        value: [{ code: "998", description: "Code result" }],
      });
    } finally {
      teardown();
    }
  },
);

Deno.test(
  "bc-reference - hsnSacCodes retries code search without Description when field is missing",
  async () => {
    setup();
    const capturedUrls: string[] = [];
    __setBcFetchImpl(async (input) => {
      const rawUrl = typeof input === "string" ? input : (input as URL).toString();
      const url = decodeURIComponent(rawUrl);
      capturedUrls.push(url);

      if (url.includes("$select=Code,Description")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "BadRequest_FieldNotFound",
              message: "Could not find a property named 'Description'.",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ value: [{ Code: "998" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const res = await handler(makeReq("hsnSacCodes", "GET", { query: "998" }));
      assertEquals(res.status, 200);
      assertEquals(await res.json(), {
        value: [{ code: "998", description: "" }],
      });
      assertEquals(
        capturedUrls.some((u) => u.includes("$select=Code&")),
        true,
      );
    } finally {
      teardown();
    }
  },
);

Deno.test("bc-reference - currencies ignores ?query= (full list always)", async () => {
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
    const res = await handler(makeReq("currencies", "GET", { query: "USD" }));
    assertEquals(res.status, 200);
    assertEquals(capturedUrl.includes("%24filter=") || capturedUrl.includes("$filter="), false);
    assertEquals(capturedUrl.includes("%24top=") || capturedUrl.includes("$top="), false);
  } finally {
    teardown();
  }
});
