import { assertEquals } from "std/assert/mod.ts";
import { BC_SEARCH_MAX_LEN, sanitizeBcSearchQuery } from "./bcSearch.ts";

Deno.test("sanitizeBcSearchQuery trims surrounding whitespace", () => {
  assertEquals(sanitizeBcSearchQuery("  996  "), "996");
});

Deno.test("sanitizeBcSearchQuery preserves parentheses (safe inside quoted OData literal)", () => {
  assertEquals(sanitizeBcSearchQuery("Tech (India) Pvt Ltd"), "Tech (India) Pvt Ltd");
});

Deno.test("sanitizeBcSearchQuery caps length at BC_SEARCH_MAX_LEN", () => {
  const long = "a".repeat(BC_SEARCH_MAX_LEN + 50);
  assertEquals(sanitizeBcSearchQuery(long).length, BC_SEARCH_MAX_LEN);
});

Deno.test("sanitizeBcSearchQuery leaves a normal query unchanged", () => {
  assertEquals(sanitizeBcSearchQuery("software"), "software");
});

Deno.test("sanitizeBcSearchQuery preserves single quotes (escaped later at filter build)", () => {
  assertEquals(sanitizeBcSearchQuery("o'brien"), "o'brien");
});

Deno.test("sanitizeBcSearchQuery returns empty string unchanged", () => {
  assertEquals(sanitizeBcSearchQuery("   "), "");
});
