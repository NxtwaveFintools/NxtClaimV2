import { describe, expect, it } from "@jest/globals";
import { computeInrTotal, computeForeignTotal } from "@/modules/claims/utils/compute-totals";

describe("computeInrTotal", () => {
  it("sums all four components and rounds to 2 decimals", () => {
    expect(computeInrTotal({ basicAmount: 100, cgstAmount: 9, sgstAmount: 9, igstAmount: 0 })).toBe(
      118,
    );
  });

  it("rounds half-up at the second decimal", () => {
    expect(
      computeInrTotal({ basicAmount: 100.115, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 }),
    ).toBe(100.12);
  });

  it("returns 0 when all components are 0", () => {
    expect(computeInrTotal({ basicAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 })).toBe(
      0,
    );
  });
});

describe("computeForeignTotal", () => {
  it("sums basic + gst and rounds to 2 decimals", () => {
    expect(computeForeignTotal({ basicAmount: 99.5, gstAmount: 0.5 })).toBe(100);
  });

  it("handles fractional gst", () => {
    expect(computeForeignTotal({ basicAmount: 100, gstAmount: 18.345 })).toBe(118.35);
  });

  it("returns 0 when both are 0", () => {
    expect(computeForeignTotal({ basicAmount: 0, gstAmount: 0 })).toBe(0);
  });
});
