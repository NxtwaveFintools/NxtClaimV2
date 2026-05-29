import { assertEquals } from "std/assert/mod.ts";
import { BC_SEARCH_MAX_LEN, escapeOdataLiteral, sanitizeBcSearchQuery } from "./bcSearch.ts";

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

Deno.test("escapeOdataLiteral doubles single quotes", () => {
  assertEquals(escapeOdataLiteral("o'brien"), "o''brien");
});

Deno.test("escapeOdataLiteral doubles every single quote (global)", () => {
  assertEquals(escapeOdataLiteral("a'b'c"), "a''b''c");
});

Deno.test(
  "escapeOdataLiteral strips ASCII control characters incl DEL (keeps normal spaces)",
  () => {
    assertEquals(escapeOdataLiteral("ab cd\n\t\x7f"), "ab cd");
  },
);

Deno.test("escapeOdataLiteral leaves ordinary punctuation intact", () => {
  assertEquals(escapeOdataLiteral("Tech (India) Pvt Ltd"), "Tech (India) Pvt Ltd");
});
