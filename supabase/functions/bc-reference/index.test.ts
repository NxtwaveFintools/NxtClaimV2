import { assertEquals } from "std/assert/mod.ts";
import { __resetTokenCache, __setTestEnv } from "../_shared/bcAuth.ts";
import { __setBcFetchImpl } from "../_shared/bcClient.ts";
import { __setCorsTestOverrides } from "../_shared/cors.ts";
import { __resetCacheForTest, handler } from "./index.ts";

function setup(): void {
  __resetCacheForTest();
  __resetTokenCache();
  __setCorsTestOverrides({ allowedOrigins: new Set() });
  __setTestEnv({
    tenantId: "T",
    clientId: "C",
    clientSecret: "S",
    environment: "Sandbox_Test",
    companyId: "company-uuid",
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
  __resetTokenCache();
  __resetCacheForTest();
}

function makeReq(type: string, method: "GET" | "POST" | "OPTIONS" = "GET"): Request {
  return new Request(`http://localhost/bc-reference?type=${type}`, { method });
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
    assertEquals(
      lastUrl.endsWith("/ODataV4/Company('NxtWave')/hsnSAC?$select=Code,Description"),
      true,
    );
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
