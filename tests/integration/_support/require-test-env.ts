/**
 * Env gate for the integration suite.
 *
 * Each integration file declares the env vars it needs and passes their
 * resolved values to this helper. Behaviour:
 *   - All values truthy  -> returns `describe` (suite runs).
 *   - Anything missing + process.env.CI unset -> returns `describe.skip`
 *     (local dev convenience: missing creds shouldn't block running the rest
 *     of the suite).
 *   - Anything missing + process.env.CI set   -> throws.
 *     In CI, missing creds is a config bug, not a reason to silently pass.
 *
 * Why pass `{ label, value }` instead of just env-var names: a couple of the
 * BC suites accept fallback chains (e.g. NEXT_PUBLIC_SUPABASE_ANON_KEY OR
 * SUPABASE_LEGACY_ANON_KEY) and a predicate (must be a JWT). The caller
 * resolves the value and we just gate on the result, keeping this helper
 * dumb and reusable.
 */
import { describe } from "@jest/globals";

export type EnvRequirement = {
  /** Human-readable name surfaced in CI error messages. */
  label: string;
  /** Resolved value; falsy (undefined/empty) means missing. */
  value: string | undefined;
};

// `describe.skip` is typed as `DescribeBase` (no `.only`/`.skip` of its own),
// so a return type of `typeof describe` is too narrow. We only need the
// callable form here — callers just do `describeIf("...", () => {})`.
type DescribeFn = (name: string, fn: () => void) => void;

export function describeRequiringTestEnv(requirements: EnvRequirement[]): DescribeFn {
  const missing = requirements.filter((r) => !r.value).map((r) => r.label);
  if (missing.length === 0) return describe;

  if (process.env.CI) {
    throw new Error(
      `Integration tests require these env vars in CI but they are missing: ${missing.join(", ")}`,
    );
  }
  return describe.skip;
}
