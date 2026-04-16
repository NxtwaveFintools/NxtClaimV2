import { normalizeIsoDateOnly, toEndOfDayIso, toStartOfDayIso } from "@/lib/date-only";

describe("date-only helpers", () => {
  test("normalizeIsoDateOnly keeps valid YYYY-MM-DD values", () => {
    expect(normalizeIsoDateOnly("2026-04-14")).toBe("2026-04-14");
    expect(normalizeIsoDateOnly(" 2026-12-31 ")).toBe("2026-12-31");
  });

  test("normalizeIsoDateOnly rejects non-ISO and invalid calendar dates", () => {
    expect(normalizeIsoDateOnly("2026_04_14")).toBeUndefined();
    expect(normalizeIsoDateOnly("2026/04/14")).toBeUndefined();
    expect(normalizeIsoDateOnly("2026-02-30")).toBeUndefined();
    expect(normalizeIsoDateOnly("14-04-2026")).toBeUndefined();
  });

  test("toStartOfDayIso and toEndOfDayIso build strict day boundaries", () => {
    expect(toStartOfDayIso("2026-04-14")).toBe("2026-04-14T00:00:00.000Z");
    expect(toEndOfDayIso("2026-04-14")).toBe("2026-04-14T23:59:59.999Z");
  });
});
