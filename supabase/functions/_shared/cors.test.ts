import { assertEquals, assert } from "std/assert/mod.ts";
import { __resetBcEnvCache } from "./bcEnv.ts";
import { __setCorsTestOverrides, resolveCors, corsPreflightResponse } from "./cors.ts";

function reqWith(origin: string | null, method = "OPTIONS"): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  return new Request("https://example.com/fn", { method, headers });
}

Deno.test("resolveCors: allowed origin echoes back ACAO + Vary", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({
    allowedOrigins: new Set(["http://localhost:3000", "https://app.example"]),
  });
  const r = resolveCors(reqWith("http://localhost:3000"));
  assertEquals(r.allow, true);
  assertEquals(r.headers["Access-Control-Allow-Origin"], "http://localhost:3000");
  assertEquals(r.headers["Vary"], "Origin");
  assert(r.headers["Access-Control-Allow-Methods"].includes("POST"));
  assert(r.headers["Access-Control-Allow-Headers"].includes("authorization"));
  __setCorsTestOverrides(null);
});

Deno.test("resolveCors: disallowed origin returns Vary only, no ACAO", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({
    allowedOrigins: new Set(["https://app.example"]),
  });
  const r = resolveCors(reqWith("https://evil.example"));
  assertEquals(r.allow, false);
  assertEquals(r.headers["Vary"], "Origin");
  assertEquals(r.headers["Access-Control-Allow-Origin"], undefined);
  __setCorsTestOverrides(null);
});

Deno.test("resolveCors: missing Origin header is treated as disallowed", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set(["https://app.example"]) });
  const r = resolveCors(reqWith(null));
  assertEquals(r.allow, false);
  assertEquals(r.headers["Access-Control-Allow-Origin"], undefined);
  __setCorsTestOverrides(null);
});

Deno.test("resolveCors: empty allow-list denies everything", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set() });
  const r = resolveCors(reqWith("http://localhost:3000"));
  assertEquals(r.allow, false);
  __setCorsTestOverrides(null);
});

Deno.test("corsPreflightResponse: 204 when allowed", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set(["http://localhost:3000"]) });
  const resp = corsPreflightResponse(reqWith("http://localhost:3000"));
  assertEquals(resp.status, 204);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
  __setCorsTestOverrides(null);
});

Deno.test("corsPreflightResponse: 403 when not allowed", () => {
  __resetBcEnvCache();
  __setCorsTestOverrides({ allowedOrigins: new Set(["https://app.example"]) });
  const resp = corsPreflightResponse(reqWith("https://evil.example"));
  assertEquals(resp.status, 403);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(resp.headers.get("Vary"), "Origin");
  __setCorsTestOverrides(null);
});
