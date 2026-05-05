import { getEmailDomain } from "@/lib/email-domain";

describe("getEmailDomain", () => {
  test("normalizes email domains", () => {
    expect(getEmailDomain("  USER@NXTWAVE.CO.IN  ")).toBe("nxtwave.co.in");
  });

  test("returns empty string when email is malformed", () => {
    expect(getEmailDomain("missing-at-symbol")).toBe("");
  });
});
