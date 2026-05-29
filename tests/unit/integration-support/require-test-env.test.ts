/**
 * Unit tests for the integration-suite env gate.
 *
 * The helper returns either `describe` (proceed) or `describe.skip` (skip)
 * based on which env-var requirements are satisfied. In CI (process.env.CI
 * truthy) it throws instead of skipping, so a misconfigured CI run surfaces
 * the gap as a failure rather than a silent pass.
 */
import { describe as jestDescribe, expect, it, afterEach } from "@jest/globals";
import { describeRequiringTestEnv } from "../../integration/_support/require-test-env";

const originalCi = process.env.CI;

afterEach(() => {
  if (originalCi === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = originalCi;
  }
});

jestDescribe("describeRequiringTestEnv", () => {
  it("returns describe when every requirement is satisfied", () => {
    delete process.env.CI;
    const d = describeRequiringTestEnv([
      { label: "FOO", value: "x" },
      { label: "BAR", value: "y" },
    ]);
    expect(d).toBe(jestDescribe);
  });

  it("returns describe.skip when a requirement is missing and CI is unset", () => {
    delete process.env.CI;
    const d = describeRequiringTestEnv([
      { label: "FOO", value: "x" },
      { label: "MISSING", value: undefined },
    ]);
    expect(d).toBe(jestDescribe.skip);
  });

  it("returns describe.skip when a requirement is empty string and CI is unset", () => {
    delete process.env.CI;
    const d = describeRequiringTestEnv([{ label: "FOO", value: "" }]);
    expect(d).toBe(jestDescribe.skip);
  });

  it("throws when a requirement is missing and CI is set", () => {
    process.env.CI = "true";
    expect(() =>
      describeRequiringTestEnv([
        { label: "FOO", value: "x" },
        { label: "MISSING_A", value: undefined },
        { label: "MISSING_B", value: undefined },
      ]),
    ).toThrow(/MISSING_A.*MISSING_B/);
  });

  it("does not throw in CI when every requirement is satisfied", () => {
    process.env.CI = "1";
    expect(() => describeRequiringTestEnv([{ label: "FOO", value: "x" }])).not.toThrow();
  });
});
