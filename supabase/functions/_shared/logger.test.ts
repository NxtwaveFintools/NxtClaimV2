// supabase/functions/_shared/logger.test.ts
import { assertEquals, assertMatch } from "std/assert/mod.ts";
import { log, __setLoggerWriter } from "./logger.ts";

function captureOne(fn: () => void): unknown {
  let captured = "";
  __setLoggerWriter((line) => {
    captured = line;
  });
  try {
    fn();
  } finally {
    __setLoggerWriter(null);
  }
  return JSON.parse(captured);
}

Deno.test("log emits one JSON line with ts, fn, level, event", () => {
  const out = captureOne(() => log("bc-claim", "info", "request_start"));
  const o = out as Record<string, unknown>;
  assertEquals(o.fn, "bc-claim");
  assertEquals(o.level, "info");
  assertEquals(o.event, "request_start");
  assertMatch(o.ts as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

Deno.test("log includes arbitrary fields after the base shape", () => {
  const out = captureOne(() =>
    log("bc-claim", "error", "bc_post_outcome", {
      claim_id: "CLM-123",
      bc_status: 400,
      duration_ms: 842,
    }),
  );
  const o = out as Record<string, unknown>;
  assertEquals(o.claim_id, "CLM-123");
  assertEquals(o.bc_status, 400);
  assertEquals(o.duration_ms, 842);
});

Deno.test("log level error is preserved verbatim", () => {
  const out = captureOne(() => log("bc-reference", "warn", "cache_miss"));
  const o = out as Record<string, unknown>;
  assertEquals(o.level, "warn");
  assertEquals(o.fn, "bc-reference");
});
