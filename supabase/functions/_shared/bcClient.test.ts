import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { __resetTokenCache, __setTestEnv } from "./bcAuth.ts";
import { __setBcFetchImpl, bcFetch } from "./bcClient.ts";

function setupAuth(): void {
  __resetTokenCache();
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
  __resetTokenCache();
}

Deno.test("bcFetch — claims endpoint builds Alletec URL", async () => {
  setupAuth();
  let lastUrl = "";
  __setBcFetchImpl(async (input, _init) => {
    lastUrl = typeof input === "string" ? input : (input as URL).toString();
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const result = await bcFetch("claims", "POST", "/companies(company-uuid)/Claims", { x: 1 });
    assertEquals(result.status, 200);
    assertEquals(result.body, { ok: true });
    assertEquals(
      lastUrl,
      "https://api.businesscentral.dynamics.com/v2.0/Sandbox_Test/api/Alletec/Claim/v1.0/companies(company-uuid)/Claims",
    );
  } finally {
    teardown();
  }
});

Deno.test("bcFetch — odata endpoint builds Company OData URL", async () => {
  setupAuth();
  let lastUrl = "";
  __setBcFetchImpl(async (input, _init) => {
    lastUrl = typeof input === "string" ? input : (input as URL).toString();
    return new Response(JSON.stringify({ value: [] }), { status: 200 });
  });
  try {
    await bcFetch("odata", "GET", "/currencies?$select=Code,Description");
    assertEquals(
      lastUrl,
      "https://api.businesscentral.dynamics.com/v2.0/T/Sandbox_Test/ODataV4/Company('NxtWave')/currencies?$select=Code,Description",
    );
  } finally {
    teardown();
  }
});

Deno.test("bcFetch — non-JSON body captured as { raw_body }", async () => {
  setupAuth();
  __setBcFetchImpl(async () => new Response("BC service unavailable", { status: 503 }));
  try {
    const result = await bcFetch("claims", "GET", "/probe");
    assertEquals(result.status, 503);
    assertEquals(result.body, { raw_body: "BC service unavailable" });
  } finally {
    teardown();
  }
});

Deno.test("bcFetch — empty body returns null", async () => {
  setupAuth();
  __setBcFetchImpl(async () => new Response(null, { status: 204 }));
  try {
    const result = await bcFetch("claims", "POST", "/probe");
    assertEquals(result.status, 204);
    assertEquals(result.body, null);
  } finally {
    teardown();
  }
});

Deno.test("bcFetch — retries once on HTTP 401 with refreshed token", async () => {
  setupAuth();
  let calls = 0;
  __setBcFetchImpl(async () => {
    calls += 1;
    if (calls === 1) return new Response("unauthorized", { status: 401 });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const result = await bcFetch("claims", "GET", "/probe");
    assertEquals(calls, 2);
    assertEquals(result.status, 200);
    assertEquals(result.body, { ok: true });
  } finally {
    teardown();
  }
});

Deno.test("bcFetch — does NOT retry a non-401 error", async () => {
  setupAuth();
  let calls = 0;
  __setBcFetchImpl(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const result = await bcFetch("claims", "POST", "/probe", { x: 1 });
    assertEquals(calls, 1);
    assertEquals(result.status, 400);
  } finally {
    teardown();
  }
});

Deno.test("bcFetch — AbortController timeout fires", async () => {
  setupAuth();
  __setBcFetchImpl(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  try {
    await assertRejects(
      () => bcFetch("claims", "GET", "/probe", undefined, { timeoutMs: 30 }),
      DOMException,
      "aborted",
    );
  } finally {
    teardown();
  }
});
