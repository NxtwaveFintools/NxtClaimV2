import { assertEquals, assert } from "std/assert/mod.ts";
import { __setTestEnv, __resetTokenCache, getBcAccessToken } from "./bcAuth.ts";

Deno.test("caches the token across calls within expiry", async () => {
  __resetTokenCache();

  let fetchCount = 0;
  __setTestEnv({
    tenantId: "T",
    clientId: "C",
    clientSecret: "S",
    environment: "Sandbox",
    companyId: "X",
    companyName: "Y",
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ access_token: "tok-A", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const t1 = await getBcAccessToken();
  const t2 = await getBcAccessToken();
  assertEquals(t1, "tok-A");
  assertEquals(t2, "tok-A");
  assertEquals(fetchCount, 1); // second call hits cache
});

Deno.test("refreshes when within 60s of expiry", async () => {
  __resetTokenCache();
  let calls = 0;
  __setTestEnv({
    tenantId: "T",
    clientId: "C",
    clientSecret: "S",
    environment: "Sandbox",
    companyId: "X",
    companyName: "Y",
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          access_token: calls === 1 ? "old" : "new",
          expires_in: calls === 1 ? 30 : 3600,
        }),
        { status: 200 },
      );
    },
  });
  const a = await getBcAccessToken();
  const b = await getBcAccessToken();
  assertEquals(a, "old");
  assertEquals(b, "new");
  assertEquals(calls, 2);
});

Deno.test("throws on non-2xx", async () => {
  __resetTokenCache();
  __setTestEnv({
    tenantId: "T",
    clientId: "C",
    clientSecret: "S",
    environment: "Sandbox",
    companyId: "X",
    companyName: "Y",
    fetchImpl: async () => new Response("bad", { status: 401 }),
  });
  let err: unknown = null;
  try {
    await getBcAccessToken();
  } catch (e) {
    err = e;
  }
  assert(err instanceof Error);
  assert((err as Error).message.includes("401"));
});
