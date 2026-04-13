import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";

describe("format utilities", () => {
  test("formatCurrency renders two decimal places", () => {
    expect(formatCurrency(1234.5)).toContain("1,234.50");
  });

  test("formatCurrency handles negative numbers", () => {
    const value = formatCurrency(-10);
    expect(value).toContain("10.00");
    expect(value).toContain("-");
  });

  test("formatDate returns N/A for null", () => {
    expect(formatDate(null)).toBe("N/A");
  });

  test("formatDate returns N/A for undefined", () => {
    expect(formatDate(undefined)).toBe("N/A");
  });

  test("formatDate returns N/A for invalid values", () => {
    expect(formatDate("not-a-date")).toBe("N/A");
  });

  test("formatDate accepts Date inputs", () => {
    expect(formatDate(new Date("2026-03-14T00:00:00.000Z"))).toBe("14 Mar 2026");
  });

  test("formatDate uses Asia/Kolkata timezone", () => {
    expect(formatDate("2026-03-13T20:30:00.000Z")).toBe("14 Mar 2026");
  });

  test("formatDate formats valid date", () => {
    expect(formatDate("2026-03-14")).toMatch(/\d{2} [A-Za-z]{3} \d{4}/);
  });

  test("formatDateTime returns fallback for empty or invalid values", () => {
    expect(formatDateTime("")).toBe("Unknown time");
    expect(formatDateTime("bad")).toBe("Unknown time");
  });

  test("formatDateTime formats valid datetime", () => {
    const value = formatDateTime("2026-03-14T10:45:00.000Z");
    expect(value).toMatch(/\d{2} [A-Za-z]{3} \d{4}/);
    expect(value).toMatch(/\d{2}:\d{2}/);
  });
});
