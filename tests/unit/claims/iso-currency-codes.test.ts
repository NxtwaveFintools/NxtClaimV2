/** @jest-environment node */
import {
  ISO_CURRENCY_CODES,
  PINNED_CURRENCY_CODES,
  isIsoCurrencyCode,
} from "@/core/constants/iso-currency-codes";

describe("iso-currency-codes", () => {
  test("includes the eight minimum required codes (INR, USD, EUR, CHF, GBP, AED, SGD, JPY)", () => {
    for (const code of ["INR", "USD", "EUR", "CHF", "GBP", "AED", "SGD", "JPY"]) {
      expect(ISO_CURRENCY_CODES).toContain(code);
    }
  });

  test("all codes are unique three-letter uppercase strings", () => {
    expect(new Set(ISO_CURRENCY_CODES).size).toBe(ISO_CURRENCY_CODES.length);
    for (const code of ISO_CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  test("pinned codes are a subset of the full list, INR first", () => {
    expect(new Set(PINNED_CURRENCY_CODES).size).toBe(PINNED_CURRENCY_CODES.length);
    expect(PINNED_CURRENCY_CODES[0]).toBe("INR");
    for (const code of PINNED_CURRENCY_CODES) {
      expect(ISO_CURRENCY_CODES).toContain(code);
    }
  });

  test("isIsoCurrencyCode validates membership", () => {
    expect(isIsoCurrencyCode("INR")).toBe(true);
    expect(isIsoCurrencyCode("AED")).toBe(true);
    expect(isIsoCurrencyCode("XXX")).toBe(false);
    expect(isIsoCurrencyCode("inr")).toBe(false);
    expect(isIsoCurrencyCode("")).toBe(false);
    expect(isIsoCurrencyCode(null)).toBe(false);
  });
});
