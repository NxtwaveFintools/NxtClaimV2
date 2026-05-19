# PR #127 Residual Cleanup — Design

**Date:** 2026-05-19
**Branch:** `ForeignC`
**Triggered by:** Final holistic review (post-sweep) surfaced 4 issues + 1 CI flake. See PR #127 conversation.
**Status:** Approved, ready for implementation plan.

## Goal

Close out the 4 NEEDS_DISCUSSION items from the final code reviewer + the 2-test parallel flake, leaving the branch in a state where future engineers cannot accidentally drop the auth gates and the live submitter-edit path is protected at both the service and DB layers.

## In Scope (5 items)

| #   | Severity  | Item                 | Approach                                                                                                                                                                                                                                                                                                                                      |
| --- | --------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #5  | trivial   | CI parallel-flake    | Edit `package.json` `test:unit` script → add `--runInBand`. Stops 2 form-component tests from flaking under parallel Jest.                                                                                                                                                                                                                    |
| #2  | important | Dedup null edge      | In `SupabaseClaimRepository.existsExpenseByCompositeKey` + `findActiveExpenseDuplicateClaimIdByCompositeKey`: when EITHER input OR candidate has `foreign_basic_amount = null` for a foreign claim, return `false` (incomplete data should not dedup). Add a Jest case to `tests/unit/claims/dedup.test.ts`.                                  |
| #3  | minor     | Lock ordering        | New migration `20260519130000_reorder_submitter_auth_check.sql`: split the function into preliminary `SELECT submitted_by FROM claims WHERE id = p_claim_id` (no lock) → auth gate → then `SELECT ... FOR UPDATE` for the actual work. Idempotent via `CREATE OR REPLACE`. Rollback restores prior body.                                      |
| #1  | important | Wire RPC             | Replace direct table writes in `SupabaseClaimRepository.updateClaimDetailsBySubmitter` with `client.rpc("update_claim_by_submitter", { p_claim_id, p_actor_id, p_payload })`. The RPC body (post-#3) covers the same fields the direct writes did. Defense-in-depth: even if service-layer auth is bypassed, DB rejects unauthorized callers. |
| #4  | minor     | RPC integration test | New file `tests/integration/rpc-auth-gates.test.ts` (Jest, tagged via `describe.skip` unless `SUPABASE_TEST_PROJECT_REF` env var is set). Uses the Supabase JS client with anon key to call both auth-gated RPCs as a wrong-actor; expects them to throw. Add `npm run test:integration` script. Not part of default `npm test`.              |

## Out of Scope

- Splitting the security-invoker migration (already deferred by user, twice).
- Migrating `updateClaimDetailsByFinance` to a different pattern (current 4-arg overload is fine; only the submitter side has the dead-code issue).
- The 2 TypeScript deprecation warnings (`★`) — pre-existing, cosmetic, unrelated to this work.

## Sequencing (critical order)

1. **#5 (CI)** — trivial, do first so subsequent test runs use the new flag.
2. **#2 (dedup null)** — small, independent.
3. **#3 (lock ordering)** — new migration must land BEFORE #1 wires the repo to use the RPC. Otherwise the lock-before-auth-check pattern starts firing on production traffic.
4. **#1 (wire RPC)** — biggest change; requires #3 already applied so the RPC's auth check is fast.
5. **#4 (integration tests)** — verify the now-live RPC path holds the auth gate.
6. Final quality gate + push + comment on PR.

## Approach detail per item

### #5 — CI tweak

Single edit in `package.json`:

```diff
- "test:unit": "jest --passWithNoTests",
+ "test:unit": "jest --passWithNoTests --runInBand",
```

Trade-off: slower full-suite run (~3× longer with --runInBand vs parallel) but deterministic. Acceptable since 533 tests run in ~15s parallel / ~45s serial — still fast enough for local dev and CI.

### #2 — Dedup null edge fix

Current predicate in `SupabaseClaimRepository.ts:existsExpenseByCompositeKey`:

```ts
const inputForeignBasic = Number(input.foreignBasicAmount ?? 0);
// ...
const candidateForeignBasic = Number(row.foreign_basic_amount ?? 0);
// ...
return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
```

Problem: `null ?? 0` produces 0; two foreign claims both with `null` foreign_basic_amount collide on 0.

Fix: short-circuit when either side is null in the foreign branch:

```ts
if (isInputForeign) {
  if (candidateForeignCode !== inputForeignCode) return false;
  if (input.foreignBasicAmount == null || row.foreign_basic_amount == null) return false;
  const candidate = Number(row.foreign_basic_amount);
  const expected = Number(input.foreignBasicAmount);
  if (!Number.isFinite(candidate)) return false;
  return Math.abs(candidate - expected) <= epsilon;
}
```

Apply same pattern in `findActiveExpenseDuplicateClaimIdByCompositeKey`.

Add to `tests/unit/claims/dedup.test.ts`:

- two foreign claims with `null` foreign_basic_amount on both sides → do NOT match
- input has `null`, candidate has a value → do NOT match
- input has a value, candidate has `null` → do NOT match

### #3 — Lock ordering migration

New file `supabase/migrations/20260519130000_reorder_submitter_auth_check.sql`:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.update_claim_by_submitter(
  p_claim_id text,
  p_actor_id uuid,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_submitter uuid;
  v_claim public.claims%rowtype;
  v_detail_type text;
  v_detail_id uuid;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  -- AUTH GATE: cheap pre-check, no row lock yet.
  select submitted_by into v_submitter
  from public.claims
  where id = p_claim_id and is_active = true;

  if not found then
    raise exception 'Claim not found or inactive.';
  end if;

  if p_actor_id is distinct from v_submitter then
    raise exception 'p_actor_id is not the claim submitter';
  end if;

  -- Re-fetch with lock now that auth passed.
  select *
  into v_claim
  from public.claims
  where id = p_claim_id and is_active = true
  for update;

  if not found then
    raise exception 'Claim disappeared between auth check and lock.';
  end if;

  -- (rest of the body unchanged from 20260519120000_harden_finance_rpc_authorization.sql)
  ...
end;
$$;

COMMIT;
```

Rollback file restores the prior single-fetch-then-check body from `20260519120000`.

Sequencing note: `update_claim_by_finance` keeps its current ordering (auth check is on `master_finance_approvers`, not on the claim row, so it's not coupled).

### #1 — Wire the repo to call the RPC

Read the current `SupabaseClaimRepository.updateClaimDetailsBySubmitter` body (around lines 2101-2160). Identify every field it writes to `claims`, `expense_details`, `advance_details`. Cross-reference against the RPC body in migration `20260519100000` + `20260519120000` + the new `20260519130000`.

Required: a JSON payload structure that the RPC consumes. Build it from the existing input shape used in `UpdateOwnClaimService` → `updateClaimDetailsBySubmitter`.

Replacement skeleton:

```ts
async updateClaimDetailsBySubmitter(input: { /* unchanged signature */ }) {
  const client = getServiceRoleSupabaseClient();
  const payload = buildSubmitterEditPayload(input); // helper to translate input → RPC payload
  const { error } = await client.rpc("update_claim_by_submitter", {
    p_claim_id: input.claimId,
    p_actor_id: input.actorUserId,
    p_payload: payload,
  });
  if (error) return { ok: false, errorMessage: error.message };
  return { ok: true, errorMessage: null };
}
```

The `buildSubmitterEditPayload` helper centralizes the translation; place it in the same file or in a small adjacent module. Test it with a unit test that feeds a known input and asserts the payload shape.

### #4 — RPC integration test

New file `tests/integration/rpc-auth-gates.test.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "@jest/globals";

const projectUrl = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const skip = !projectUrl || !anonKey || !serviceKey;

(skip ? describe.skip : describe)("RPC auth gates (integration)", () => {
  const client = createClient(projectUrl!, serviceKey!);

  it("update_claim_by_finance rejects non-finance actor", async () => {
    const { error } = await client.rpc("update_claim_by_finance", {
      p_claim_id: "__fake__",
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_edit_reason: "integration test",
      p_payload: {},
    });
    expect(error?.message ?? "").toContain("p_actor_id is not an active finance approver");
  });

  it("update_claim_by_submitter rejects non-owner actor", async () => {
    // Pick an arbitrary real claim_id; bad actor
    const { data: claims } = await client
      .from("claims")
      .select("id")
      .eq("is_active", true)
      .limit(1);
    const claimId = claims?.[0]?.id ?? "__fake__";
    const { error } = await client.rpc("update_claim_by_submitter", {
      p_claim_id: claimId,
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_payload: { detailType: "expense", detailId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(error?.message ?? "").toContain("p_actor_id is not the claim submitter");
  });
});

if (skip) {
  console.warn(
    "[rpc-auth-gates] Skipped: set SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_ROLE_KEY to run.",
  );
}
```

Add to `package.json`:

```json
"test:integration": "jest tests/integration --passWithNoTests"
```

Default `npm test` (and `test:unit`) ignore `tests/integration/`. CI can opt in by setting the env vars.

## Risks & mitigations

- **#1 behavior drift between direct writes and RPC.** Mitigation: detailed field-by-field comparison before flipping the call; full test suite run after; document a few-day soak on test environment before production rollout.
- **#3 lock split visibility window.** A row could change between preliminary select and `FOR UPDATE`. Not a deadlock risk. Worst case: write fails because the row state changed; correct behavior.
- **#4 requires DB credentials.** Solution: env-var gated, skipped by default, CI opt-in.

## Verification (evidence-before-claims)

- `npm run lint` exit 0
- `npm run typecheck` exit 0
- `npm run test:unit` (now `--runInBand` by default) → 533+ passing
- `npm run test:integration` (if creds set) → 2/2 passing
- Manual via Supabase MCP: call both auth-gated RPCs with bad actor IDs → both raise
- After #1: a full pass of any test that exercises the submitter-edit path (e.g., `update-own-claim.service.test.ts`) — mocks need to be updated to mock `client.rpc` instead of `client.from(...).update(...)`
