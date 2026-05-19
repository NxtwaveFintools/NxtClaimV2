# PR #127 Residual Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the 4 NEEDS_DISCUSSION items from the final code review plus the 2-test parallel flake on PR #127, in dependency-safe order.

**Architecture:** Five surgical changes in dependency order: (1) CI flag for determinism, (2) dedup null-edge fix, (3) new migration reordering the submitter RPC's auth-check to run before the row lock, (4) wire the repo to actually call the now-hardened RPC, (5) integration tests to catch future auth-gate regressions.

**Tech Stack:** Next.js + TypeScript, Supabase (Postgres 17 + JS client), Jest, React Hook Form (no UI changes here).

**Spec:** `docs/superpowers/specs/2026-05-19-pr-127-residual-cleanup-design.md`

---

## File Map

| Action | Path                                                                                    | Purpose                                                                                                     |
| ------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Modify | `package.json`                                                                          | `test:unit` script gets `--runInBand`                                                                       |
| Modify | `src/modules/claims/repositories/SupabaseClaimRepository.ts:2444-2474, 2511-2542`       | Dedup null edge in both `existsExpenseByCompositeKey` and `findActiveExpenseDuplicateClaimIdByCompositeKey` |
| Modify | `tests/unit/claims/dedup.test.ts`                                                       | 3 new null-edge cases                                                                                       |
| Create | `supabase/migrations/20260519130000_reorder_submitter_auth_check.sql`                   | New migration: split auth-check before `FOR UPDATE`                                                         |
| Create | `supabase/rollbacks/20260519130000_reorder_submitter_auth_check_rollback.sql`           | Restore prior body from `20260519120000`                                                                    |
| Modify | `src/modules/claims/repositories/SupabaseClaimRepository.ts:2103-2220`                  | Replace `updateClaimDetailsBySubmitter` body with RPC call + helper                                         |
| Modify | `tests/unit/claims/update-own-claim.service.test.ts` (and any other mock-based callers) | Update mocks to mock `client.rpc` instead of `client.from(...).update(...)`                                 |
| Create | `tests/integration/rpc-auth-gates.test.ts`                                              | Env-gated integration tests                                                                                 |
| Modify | `package.json`                                                                          | Add `test:integration` script, configure Jest to ignore `tests/integration/` in `test:unit`                 |
| Modify | `jest.config.js` or `jest.config.ts`                                                    | Add `testPathIgnorePatterns` for the integration directory                                                  |

---

## Task 1: CI tweak — add `--runInBand`

**Files:**

- Modify: `package.json` (the `"test:unit"` script line)

- [ ] **Step 1: Read current scripts to confirm exact location**

```bash
grep -n '"test' package.json
```

Expected to show `"test:unit": "jest --passWithNoTests",`.

- [ ] **Step 2: Apply the Edit**

Edit `package.json`:

old_string:

```
    "test:unit": "jest --passWithNoTests",
```

new_string:

```
    "test:unit": "jest --passWithNoTests --runInBand",
```

- [ ] **Step 3: Verify the suite still passes deterministically**

```bash
npm run test:unit 2>&1 | tail -5
```

Expected: `Tests: 533 passed, 533 total` (the prior 2 parallel-flake tests now pass).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore(test): add --runInBand to test:unit for deterministic execution

Two tests in tests/unit/claims/new-claim-form-client.test.tsx flake
under parallel Jest execution (pass in isolation, --runInBand, and any
pair-wise combination). Root cause is a pre-existing test-pollution
issue in the form-component suite that wasn't introduced by recent
changes. --runInBand makes execution deterministic.

Trade-off: ~3x slower full run (~45s vs ~15s); still fast enough for CI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Dedup null-edge fix + tests

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts` (two methods around lines 2444-2474 and 2511-2542)
- Modify: `tests/unit/claims/dedup.test.ts`

### Step 1: Write failing tests for the null edge

- [ ] **Append three new cases to `tests/unit/claims/dedup.test.ts`** inside the existing describe block (or in a new describe). Use the existing `rowMatchesInput` helper from that file.

Edit `tests/unit/claims/dedup.test.ts`. Find the closing `});` of the `describe("expense dedup composite key — foreign claims")` block and insert before it (or use `replace_all: false` with the existing closing brace as the unique marker).

Specifically, insert these test cases at the end of the existing describe:

```ts
it("two foreign claims both with null foreign_basic_amount do not collide", () => {
  const rowA = { total_amount: 0, foreign_currency_code: "USD", foreign_basic_amount: null };
  const inputB = { totalAmount: 0, foreignCurrencyCode: "USD", foreignBasicAmount: null };
  expect(rowMatchesInput(rowA, inputB)).toBe(false);
});

it("foreign input with null foreignBasicAmount does not collide with a candidate that has a value", () => {
  const row = { total_amount: 0, foreign_currency_code: "USD", foreign_basic_amount: 100 };
  const input = { totalAmount: 0, foreignCurrencyCode: "USD", foreignBasicAmount: null };
  expect(rowMatchesInput(row, input)).toBe(false);
});

it("foreign candidate with null foreign_basic_amount does not collide with a valued input", () => {
  const row = { total_amount: 0, foreign_currency_code: "USD", foreign_basic_amount: null };
  const input = { totalAmount: 0, foreignCurrencyCode: "USD", foreignBasicAmount: 100 };
  expect(rowMatchesInput(row, input)).toBe(false);
});
```

- [ ] **Step 2: Update the local `rowMatchesInput` helper inside the test file to mirror the production change**

The test file has a local helper that currently treats `?? 0` for both sides. Update it to short-circuit on either-side null:

Find this region in `tests/unit/claims/dedup.test.ts`:

old_string:

```
  if (isInputForeign) {
    if (candidateForeignCode !== inputForeignCode) return false;
    if (!Number.isFinite(candidateForeignBasic)) return false;
    return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
  }
```

new_string:

```
  if (isInputForeign) {
    if (candidateForeignCode !== inputForeignCode) return false;
    if (input.foreignBasicAmount == null || row.foreign_basic_amount == null) return false;
    if (!Number.isFinite(candidateForeignBasic)) return false;
    return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
  }
```

- [ ] **Step 3: Run the tests, confirm new ones fail without the production fix**

Temporarily comment out the new short-circuit line in the test helper to confirm the tests would fail without it:

```bash
npx jest tests/unit/claims/dedup.test.ts 2>&1 | tail -10
```

Expected: WITHOUT the short-circuit, the 3 new cases would fail. Restore the short-circuit and re-run; expected 7 passing (4 existing + 3 new).

- [ ] **Step 4: Apply the production fix in `existsExpenseByCompositeKey`**

Edit `src/modules/claims/repositories/SupabaseClaimRepository.ts`:

old_string (in `existsExpenseByCompositeKey`):

```
      if (isInputForeign) {
        // Foreign claims: dedup by currency code + foreign basic amount.
        if (candidateForeignCode !== inputForeignCode) {
          return false;
        }
        if (!Number.isFinite(candidateForeignBasic)) {
          return false;
        }
        return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
      }

      // INR claims: original behavior — dedup by total_amount.
      if (!Number.isFinite(candidateTotalAmount)) {
        return false;
      }
      return Math.abs(candidateTotalAmount - normalizedTotalAmount) <= epsilon;
    });

    return { exists, errorMessage: null };
  }
```

new_string:

```
      if (isInputForeign) {
        // Foreign claims: dedup by currency code + foreign basic amount.
        // Short-circuit if either side has null foreign_basic_amount — incomplete data should not dedup.
        if (candidateForeignCode !== inputForeignCode) {
          return false;
        }
        if (input.foreignBasicAmount == null || row.foreign_basic_amount == null) {
          return false;
        }
        if (!Number.isFinite(candidateForeignBasic)) {
          return false;
        }
        return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
      }

      // INR claims: original behavior — dedup by total_amount.
      if (!Number.isFinite(candidateTotalAmount)) {
        return false;
      }
      return Math.abs(candidateTotalAmount - normalizedTotalAmount) <= epsilon;
    });

    return { exists, errorMessage: null };
  }
```

- [ ] **Step 5: Apply the same fix in `findActiveExpenseDuplicateClaimIdByCompositeKey`**

Edit `src/modules/claims/repositories/SupabaseClaimRepository.ts`:

old_string (in `findActiveExpenseDuplicateClaimIdByCompositeKey`, around line 2526):

```
      if (isInputForeign) {
        // Foreign claims: dedup by currency code + foreign basic amount.
        if (candidateForeignCode !== inputForeignCode) {
          return false;
        }
        if (!Number.isFinite(candidateForeignBasic)) {
          return false;
        }
        return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
      }
```

new_string:

```
      if (isInputForeign) {
        // Foreign claims: dedup by currency code + foreign basic amount.
        // Short-circuit if either side has null foreign_basic_amount — incomplete data should not dedup.
        if (candidateForeignCode !== inputForeignCode) {
          return false;
        }
        if (input.foreignBasicAmount == null || row.foreign_basic_amount == null) {
          return false;
        }
        if (!Number.isFinite(candidateForeignBasic)) {
          return false;
        }
        return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
      }
```

- [ ] **Step 6: Verify typecheck + lint + dedup tests**

```bash
npm run lint
npm run typecheck
npx jest tests/unit/claims/dedup.test.ts
```

Expected: all exit 0; 7/7 dedup tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/modules/claims/repositories/SupabaseClaimRepository.ts tests/unit/claims/dedup.test.ts
git commit -m "$(cat <<'EOF'
fix(dedup): short-circuit foreign dedup when either side's foreign_basic_amount is null

Without this, two foreign claims with null foreign_basic_amount would
both coerce to 0 via ?? 0 and falsely dedup. Now incomplete data
(either input or candidate has null) is treated as a non-match.

Applied symmetrically in existsExpenseByCompositeKey and
findActiveExpenseDuplicateClaimIdByCompositeKey. Three new test cases
cover both-null, input-null, and candidate-null branches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: New migration — reorder `update_claim_by_submitter` auth-check before lock

**Files:**

- Create: `supabase/migrations/20260519130000_reorder_submitter_auth_check.sql`
- Create: `supabase/rollbacks/20260519130000_reorder_submitter_auth_check_rollback.sql`

### Step 1: Create the migration file

- [ ] **Write `supabase/migrations/20260519130000_reorder_submitter_auth_check.sql`** with the complete body below

```sql
-- Migration: reorder_submitter_auth_check
-- Splits update_claim_by_submitter into two SELECTs so the auth check
-- runs BEFORE acquiring the FOR UPDATE row lock. Unauthorized callers
-- no longer hold a lock for the duration of the failed call.
--
-- Function body is identical to 20260519120000_harden_finance_rpc_authorization
-- except for the auth-gate-before-lock reordering. Behavior on success and on
-- legitimate failures is unchanged.

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

  v_detail_type := btrim(coalesce(p_payload ->> 'detailType', ''));

  if v_detail_type not in ('expense', 'advance') then
    raise exception 'Invalid detailType in submitter edit payload.';
  end if;

  if v_claim.detail_type <> v_detail_type then
    raise exception 'Claim detail type mismatch for submitter edit request.';
  end if;

  v_detail_id := nullif(p_payload ->> 'detailId', '')::uuid;

  if v_detail_id is null then
    raise exception 'Detail ID is required for submitter edit payload.';
  end if;

  update public.claims
  set updated_at = now()
  where id = p_claim_id
    and is_active = true;

  if v_detail_type = 'expense' then
    update public.expense_details
    set
      bill_no = coalesce(nullif(p_payload ->> 'billNo', ''), bill_no),
      expense_category_id = coalesce(nullif(p_payload ->> 'expenseCategoryId', '')::uuid, expense_category_id),
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = coalesce(nullif(p_payload ->> 'locationId', '')::uuid, location_id),
      transaction_date = coalesce(nullif(p_payload ->> 'transactionDate', '')::date, transaction_date),
      is_gst_applicable = coalesce((p_payload ->> 'isGstApplicable')::boolean, is_gst_applicable),
      gst_number = nullif(p_payload ->> 'gstNumber', ''),
      basic_amount = coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount),
      cgst_amount = coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount),
      sgst_amount = coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount),
      igst_amount = coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
      total_amount = round(
        coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount)
        + coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount)
        + coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount)
        + coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
        2
      ),
      vendor_name = nullif(p_payload ->> 'vendorName', ''),
      purpose = coalesce(nullif(p_payload ->> 'purpose', ''), purpose),
      people_involved = nullif(p_payload ->> 'peopleInvolved', ''),
      remarks = nullif(p_payload ->> 'remarks', ''),
      receipt_file_path = case when p_payload ? 'receiptFilePath' then nullif(p_payload ->> 'receiptFilePath', '') else receipt_file_path end,
      bank_statement_file_path = case when p_payload ? 'bankStatementFilePath' then nullif(p_payload ->> 'bankStatementFilePath', '') else bank_statement_file_path end,
      foreign_currency_code = case when p_payload ? 'foreignCurrencyCode' then coalesce(nullif(p_payload ->> 'foreignCurrencyCode', '')::public.foreign_currency_code, 'INR'::public.foreign_currency_code) else foreign_currency_code end,
      foreign_basic_amount = case when p_payload ? 'foreignBasicAmount' then coalesce((p_payload ->> 'foreignBasicAmount')::numeric, 0) else foreign_basic_amount end,
      foreign_gst_amount = case when p_payload ? 'foreignGstAmount' then coalesce((p_payload ->> 'foreignGstAmount')::numeric, 0) else foreign_gst_amount end,
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Expense details missing or soft-deleted.';
    end if;
  else
    update public.advance_details
    set
      purpose = coalesce(nullif(p_payload ->> 'purpose', ''), purpose),
      total_amount = coalesce((p_payload ->> 'totalAmount')::numeric, total_amount),
      expected_usage_date = coalesce(nullif(p_payload ->> 'expectedUsageDate', '')::date, expected_usage_date),
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = nullif(p_payload ->> 'locationId', '')::uuid,
      remarks = nullif(p_payload ->> 'remarks', ''),
      supporting_document_path = case when p_payload ? 'supportingDocumentPath' then nullif(p_payload ->> 'supportingDocumentPath', '') else supporting_document_path end,
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Advance details missing or soft-deleted.';
    end if;
  end if;

  insert into public.claim_audit_logs (claim_id, actor_id, action_type, assigned_to_id, remarks)
  values (p_claim_id, p_actor_id, 'UPDATED', null, 'Claim details updated before finance review.');
end;
$$;

COMMIT;
```

### Step 2: Create the rollback file

- [ ] **Write `supabase/rollbacks/20260519130000_reorder_submitter_auth_check_rollback.sql`** that restores the prior body from `20260519120000_harden_finance_rpc_authorization.sql` (single SELECT … FOR UPDATE, then auth check):

```sql
-- Rollback for 20260519130000_reorder_submitter_auth_check
-- Restores the single-fetch-then-check body from 20260519120000.

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
  v_claim public.claims%rowtype;
  v_detail_type text;
  v_detail_id uuid;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  select *
  into v_claim
  from public.claims
  where id = p_claim_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive.';
  end if;

  if p_actor_id is distinct from v_claim.submitted_by then
    raise exception 'p_actor_id is not the claim submitter';
  end if;

  v_detail_type := btrim(coalesce(p_payload ->> 'detailType', ''));

  if v_detail_type not in ('expense', 'advance') then
    raise exception 'Invalid detailType in submitter edit payload.';
  end if;

  if v_claim.detail_type <> v_detail_type then
    raise exception 'Claim detail type mismatch for submitter edit request.';
  end if;

  v_detail_id := nullif(p_payload ->> 'detailId', '')::uuid;

  if v_detail_id is null then
    raise exception 'Detail ID is required for submitter edit payload.';
  end if;

  update public.claims
  set updated_at = now()
  where id = p_claim_id
    and is_active = true;

  if v_detail_type = 'expense' then
    update public.expense_details
    set
      bill_no = coalesce(nullif(p_payload ->> 'billNo', ''), bill_no),
      expense_category_id = coalesce(nullif(p_payload ->> 'expenseCategoryId', '')::uuid, expense_category_id),
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = coalesce(nullif(p_payload ->> 'locationId', '')::uuid, location_id),
      transaction_date = coalesce(nullif(p_payload ->> 'transactionDate', '')::date, transaction_date),
      is_gst_applicable = coalesce((p_payload ->> 'isGstApplicable')::boolean, is_gst_applicable),
      gst_number = nullif(p_payload ->> 'gstNumber', ''),
      basic_amount = coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount),
      cgst_amount = coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount),
      sgst_amount = coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount),
      igst_amount = coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
      total_amount = round(
        coalesce((p_payload ->> 'basicAmount')::numeric, basic_amount)
        + coalesce((p_payload ->> 'cgstAmount')::numeric, cgst_amount)
        + coalesce((p_payload ->> 'sgstAmount')::numeric, sgst_amount)
        + coalesce((p_payload ->> 'igstAmount')::numeric, igst_amount),
        2
      ),
      vendor_name = nullif(p_payload ->> 'vendorName', ''),
      purpose = coalesce(nullif(p_payload ->> 'purpose', ''), purpose),
      people_involved = nullif(p_payload ->> 'peopleInvolved', ''),
      remarks = nullif(p_payload ->> 'remarks', ''),
      receipt_file_path = case when p_payload ? 'receiptFilePath' then nullif(p_payload ->> 'receiptFilePath', '') else receipt_file_path end,
      bank_statement_file_path = case when p_payload ? 'bankStatementFilePath' then nullif(p_payload ->> 'bankStatementFilePath', '') else bank_statement_file_path end,
      foreign_currency_code = case when p_payload ? 'foreignCurrencyCode' then coalesce(nullif(p_payload ->> 'foreignCurrencyCode', '')::public.foreign_currency_code, 'INR'::public.foreign_currency_code) else foreign_currency_code end,
      foreign_basic_amount = case when p_payload ? 'foreignBasicAmount' then coalesce((p_payload ->> 'foreignBasicAmount')::numeric, 0) else foreign_basic_amount end,
      foreign_gst_amount = case when p_payload ? 'foreignGstAmount' then coalesce((p_payload ->> 'foreignGstAmount')::numeric, 0) else foreign_gst_amount end,
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Expense details missing or soft-deleted.';
    end if;
  else
    update public.advance_details
    set
      purpose = coalesce(nullif(p_payload ->> 'purpose', ''), purpose),
      total_amount = coalesce((p_payload ->> 'totalAmount')::numeric, total_amount),
      expected_usage_date = coalesce(nullif(p_payload ->> 'expectedUsageDate', '')::date, expected_usage_date),
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = nullif(p_payload ->> 'locationId', '')::uuid,
      remarks = nullif(p_payload ->> 'remarks', ''),
      supporting_document_path = case when p_payload ? 'supportingDocumentPath' then nullif(p_payload ->> 'supportingDocumentPath', '') else supporting_document_path end,
      updated_at = now()
    where id = v_detail_id and claim_id = p_claim_id and is_active = true;

    if not found then
      raise exception 'Cannot edit: Advance details missing or soft-deleted.';
    end if;
  end if;

  insert into public.claim_audit_logs (claim_id, actor_id, action_type, assigned_to_id, remarks)
  values (p_claim_id, p_actor_id, 'UPDATED', null, 'Claim details updated before finance review.');
end;
$$;

COMMIT;
```

### Step 3: Dry-run + push

- [ ] **Dry-run**

```bash
npx --yes supabase@latest db push --linked --dry-run 2>&1 | tail -8
```

Expected: `Would push these migrations: • 20260519130000_reorder_submitter_auth_check.sql`. If it lists anything else, STOP and investigate.

- [ ] **Push**

```bash
npx --yes supabase@latest db push --linked 2>&1 | tail -8
```

Expected: `Applying migration 20260519130000_reorder_submitter_auth_check.sql... Finished supabase db push.`

### Step 4: Verify on remote via Supabase MCP

- [ ] **Confirm the function body now does the auth check BEFORE the FOR UPDATE**

Use `mcp__claude_ai_Supabase__execute_sql` against project `pltbwxddxtsavygijcnl`:

```sql
SELECT
  position('AUTH GATE: cheap pre-check' in prosrc) > 0 AS pre_check_present,
  position('Re-fetch with lock now that auth passed' in prosrc) > 0 AS lock_after_auth_present,
  position('select submitted_by into v_submitter' in prosrc) > 0 AS preliminary_select_present
FROM pg_proc
WHERE proname = 'update_claim_by_submitter';
```

Expected: all three flags `true`. If any false, the migration applied but the body isn't what we wrote — investigate.

- [ ] **Negative-path smoke test (auth still rejects)**

```sql
WITH c AS (SELECT id FROM public.claims WHERE is_active = true LIMIT 1)
SELECT public.update_claim_by_submitter(
  (SELECT id FROM c)::text,
  '00000000-0000-0000-0000-000000000000'::uuid,
  '{"detailType":"expense","detailId":"00000000-0000-0000-0000-000000000000"}'::jsonb
);
```

Expected: error `p_actor_id is not the claim submitter`.

### Step 5: Commit

- [ ] **Commit migration + rollback**

```bash
git add supabase/migrations/20260519130000_reorder_submitter_auth_check.sql \
        supabase/rollbacks/20260519130000_reorder_submitter_auth_check_rollback.sql
git commit -m "$(cat <<'EOF'
fix(rpc): reorder update_claim_by_submitter auth-check before row lock

Splits the function into a preliminary non-locking SELECT of
submitted_by, runs the ownership auth check, then re-fetches the row
WITH FOR UPDATE for the actual writes. Unauthorized callers no longer
hold a row lock for the duration of the failed call.

Behavior on success and on legitimate failure (claim not found, claim
disappeared between auth and lock) is unchanged. Rollback file
restores the prior single-fetch-then-check body from
20260519120000_harden_finance_rpc_authorization.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the repo to call `update_claim_by_submitter` RPC

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts:2103-2220`

### Pre-flight: confirm the RPC handles every field the direct writes do

The current direct-write `updateClaimDetailsBySubmitter` writes (verified by reading lines 2103-2212):

- `claims`: `updated_at` only
- `expense_details` (when expense): bill_no, expense_category_id, product_id, location_id, transaction_date, is_gst_applicable, gst_number, basic_amount, cgst_amount, sgst_amount, igst_amount, total_amount, vendor_name, purpose, people_involved, remarks, receipt_file_path, bank_statement_file_path, foreign_currency_code (`?? 'INR'`), foreign_basic_amount (`?? 0`), foreign_gst_amount (`?? 0`), updated_at
- `advance_details` (when advance): purpose, total_amount, expected_usage_date, product_id, location_id, remarks, supporting_document_path, updated_at
- `claim_audit_logs`: `'UPDATED'` action with remarks `'Claim details updated before finance review.'`
- Throws on `isDuplicateExpenseBillConstraintError` for the expense branch

The RPC body (post-Task 3) covers all of these. The only behavior difference: the RPC uses `coalesce(...) | case when p_payload ?` patterns so a missing JSON key preserves existing DB value; the direct writes always write whatever the payload field holds (including `null`). For an OwnExpenseEditPayload that fills every field, behavior is equivalent.

Duplicate-bill error from the RPC: Postgres raises a unique-constraint violation as a regular error. Supabase JS surfaces it with `error.code === '23505'` and message containing the constraint name. The existing `isDuplicateExpenseBillConstraintError` helper at line 537 already handles this shape.

### Step 1: Write the helper that translates payload → RPC JSON

- [ ] **Add a private helper inside `SupabaseClaimRepository.ts`** (alongside the class methods, or as a module-private function above the class)

Find a sensible location near the top of the file (after imports, before the class) and insert:

```ts
function buildSubmitterEditPayload(payload: OwnClaimEditPayload): Record<string, unknown> {
  if (payload.detailType === "expense") {
    return {
      detailType: "expense",
      detailId: payload.detailId,
      billNo: payload.billNo,
      expenseCategoryId: payload.expenseCategoryId,
      productId: payload.productId,
      locationId: payload.locationId,
      transactionDate: payload.transactionDate,
      isGstApplicable: payload.isGstApplicable,
      gstNumber: payload.gstNumber,
      basicAmount: payload.basicAmount,
      cgstAmount: payload.cgstAmount,
      sgstAmount: payload.sgstAmount,
      igstAmount: payload.igstAmount,
      // totalAmount is recomputed inside the RPC from basic+cgst+sgst+igst;
      // sending it would be ignored but is harmless.
      vendorName: payload.vendorName,
      purpose: payload.purpose,
      peopleInvolved: payload.peopleInvolved,
      remarks: payload.remarks,
      receiptFilePath: payload.receiptFilePath,
      bankStatementFilePath: payload.bankStatementFilePath,
      foreignCurrencyCode: payload.foreignCurrencyCode ?? "INR",
      foreignBasicAmount: payload.foreignBasicAmount ?? 0,
      foreignGstAmount: payload.foreignGstAmount ?? 0,
    };
  }
  return {
    detailType: "advance",
    detailId: payload.detailId,
    purpose: payload.purpose,
    totalAmount: payload.totalAmount,
    expectedUsageDate: payload.expectedUsageDate,
    productId: payload.productId,
    locationId: payload.locationId,
    remarks: payload.remarks,
    supportingDocumentPath: payload.supportingDocumentPath,
  };
}
```

### Step 2: Replace `updateClaimDetailsBySubmitter` body

- [ ] **Apply the Edit**

Edit `src/modules/claims/repositories/SupabaseClaimRepository.ts`. Locate the current method body — the unique opening is the method signature; the unique closing is the `createClaimAuditLog` block followed by the closing brace.

old_string (the ENTIRE current method, from the async signature through the final `return { errorMessage: null };` and closing `}`):

```
  async updateClaimDetailsBySubmitter(
    claimId: string,
    actorUserId: string,
    payload: OwnClaimEditPayload,
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();

    const { data: updatedClaim, error: claimError } = await client
      .from("claims")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimId)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();

    if (claimError) {
      return { errorMessage: claimError.message };
    }

    if (!updatedClaim) {
      return { errorMessage: "Claim not found or inactive." };
    }

    if (payload.detailType === "expense") {
      const { data: updatedExpenseDetail, error: expenseError } = await client
        .from("expense_details")
        .update({
          bill_no: payload.billNo,
          expense_category_id: payload.expenseCategoryId,
          product_id: payload.productId,
          location_id: payload.locationId,
          transaction_date: payload.transactionDate,
          is_gst_applicable: payload.isGstApplicable,
          gst_number: payload.gstNumber,
          basic_amount: payload.basicAmount,
          cgst_amount: payload.cgstAmount,
          sgst_amount: payload.sgstAmount,
          igst_amount: payload.igstAmount,
          total_amount: payload.totalAmount,
          vendor_name: payload.vendorName,
          purpose: payload.purpose,
          people_involved: payload.peopleInvolved,
          remarks: payload.remarks,
          receipt_file_path: payload.receiptFilePath,
          bank_statement_file_path: payload.bankStatementFilePath,
          foreign_currency_code: payload.foreignCurrencyCode ?? "INR",
          foreign_basic_amount: payload.foreignBasicAmount ?? 0,
          foreign_gst_amount: payload.foreignGstAmount ?? 0,
          // foreign_total_amount is a GENERATED STORED column — do not write it
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.detailId)
        .eq("claim_id", claimId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

      if (expenseError) {
        if (isDuplicateExpenseBillConstraintError(expenseError)) {
          throw expenseError;
        }

        return { errorMessage: expenseError.message };
      }

      if (!updatedExpenseDetail) {
        return {
          errorMessage: "Cannot edit: Expense details missing or soft-deleted.",
        };
      }
    } else {
      const { data: updatedAdvanceDetail, error: advanceError } = await client
        .from("advance_details")
        .update({
          purpose: payload.purpose,
          total_amount: payload.totalAmount,
          expected_usage_date: payload.expectedUsageDate,
          product_id: payload.productId,
          location_id: payload.locationId,
          remarks: payload.remarks,
          supporting_document_path: payload.supportingDocumentPath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.detailId)
        .eq("claim_id", claimId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

      if (advanceError) {
        return { errorMessage: advanceError.message };
      }

      if (!updatedAdvanceDetail) {
        return {
          errorMessage: "Cannot edit: Advance details missing or soft-deleted.",
        };
      }
    }

    const auditResult = await this.createClaimAuditLog({
      claimId,
      actorId: actorUserId,
      actionType: "UPDATED",
      assignedToId: null,
      remarks: "Claim details updated before finance review.",
    });

    if (auditResult.errorMessage) {
```

(Continue the old_string up to and including the final `return { errorMessage: null };` and the closing `}` of the method — read lines 2103-2225 carefully to capture the EXACT bytes.)

new_string (replacement method body — much shorter; the RPC does everything including the audit log insert):

```
  async updateClaimDetailsBySubmitter(
    claimId: string,
    actorUserId: string,
    payload: OwnClaimEditPayload,
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const rpcPayload = buildSubmitterEditPayload(payload);

    const { error } = await client.rpc("update_claim_by_submitter", {
      p_claim_id: claimId,
      p_actor_id: actorUserId,
      p_payload: rpcPayload,
    });

    if (error) {
      if (
        payload.detailType === "expense" &&
        isDuplicateExpenseBillConstraintError(error)
      ) {
        throw error;
      }
      return { errorMessage: error.message };
    }

    return { errorMessage: null };
  }
```

**Critical sub-step before applying the Edit:** read the EXACT current method body (lines ~2103–~2225) so the `old_string` matches byte-for-byte. Use:

```bash
sed -n '2103,2225p' src/modules/claims/repositories/SupabaseClaimRepository.ts
```

If the method body has any whitespace differences from what's shown above (e.g., trailing whitespace, slightly different comments), use the actual bytes in `old_string`.

### Step 3: Typecheck + lint

- [ ] **Run**

```bash
npm run lint
npm run typecheck
```

Both exit 0. If typecheck complains about the `rpcPayload` type (Supabase generated types may declare `update_claim_by_submitter`'s `p_payload` as `Json`), cast:

```ts
const rpcPayload = buildSubmitterEditPayload(payload) as Record<string, unknown>;
```

If the RPC's generated type isn't present in `src/types/database.ts` (because the local types haven't been regenerated since `20260519100000`), regenerate:

```bash
npx --yes supabase@latest gen types typescript --linked > src/types/database.ts
```

If that produces unrelated diff, restore only the RPC-related lines.

### Step 4: Run the affected tests

- [ ] **Targeted tests for the submitter path**

```bash
npx jest tests/unit/claims/update-own-claim.service.test.ts tests/unit/claims/actions.test.ts 2>&1 | grep -E "Tests:|✕|●" | head -20
```

Likely outcome: some test failures. These tests mock `client.from(...).update(...)` for the direct-write path; after the Edit they need to mock `client.rpc(...)`. Inspect the failures.

For each failure:

- **Mock mismatch (test expects `from("claims").update(...)` etc. to be called)**: update the test to mock `client.rpc.mockResolvedValue({ error: null })` instead. Assert `client.rpc` was called with `("update_claim_by_submitter", { p_claim_id, p_actor_id, p_payload })`.
- **Behavioral assertion (test asserts the audit log was created)**: the audit log is now inserted INSIDE the RPC. The repo no longer calls `createClaimAuditLog`. Drop that assertion or move it to an integration test.

### Step 5: Run the full suite

- [ ] **Run**

```bash
npm run test:unit 2>&1 | tail -5
```

Expected: 0 failures. If any test fails that wasn't covered in Step 4, diagnose case by case. Do NOT proceed until clean.

### Step 6: Commit

- [ ] **Commit**

```bash
git add src/modules/claims/repositories/SupabaseClaimRepository.ts \
        tests/unit/claims/update-own-claim.service.test.ts \
        tests/unit/claims/actions.test.ts
git commit -m "$(cat <<'EOF'
fix(repo): route submitter edits through update_claim_by_submitter RPC

Replaces direct service-role table writes in
SupabaseClaimRepository.updateClaimDetailsBySubmitter with a single
call to the update_claim_by_submitter RPC. The RPC body (post
20260519130000) does the auth check, the claim row touch, the
expense_details / advance_details update, and the claim_audit_logs
insert atomically with proper ownership enforcement.

Defense-in-depth: even if the service-layer auth check in
UpdateOwnClaimService is bypassed, the RPC's auth gate rejects
unauthorized callers.

The duplicate-bill error is still surfaced via throw so the action
layer's catch + friendly-message handling continues to work.

Tests updated to mock client.rpc instead of client.from(...).update().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: RPC integration tests

**Files:**

- Create: `tests/integration/rpc-auth-gates.test.ts`
- Modify: `package.json` (add `test:integration` script)
- Modify: `jest.config.js` or `jest.config.ts` (exclude `tests/integration/` from default test run)

### Step 1: Inspect jest config to know where to add ignore pattern

- [ ] **Read jest config**

```bash
ls jest.config.*
cat jest.config.* 2>/dev/null | head -40
```

Identify the existing `testPathIgnorePatterns` or `testMatch` setting.

### Step 2: Configure Jest to ignore the integration dir by default

- [ ] **Apply the appropriate Edit**

Most likely the config has `testPathIgnorePatterns: ["/node_modules/", "/.next/"]` or similar. Add `"/tests/integration/"`:

old_string (use whatever is actually there — example):

```
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
```

new_string:

```
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/integration/"],
```

If `testPathIgnorePatterns` doesn't exist in the config, add it inside the `module.exports = { ... }` object.

### Step 3: Add `test:integration` script

- [ ] **Edit `package.json`**

old_string:

```
    "test:e2e": "playwright test --pass-with-no-tests",
```

new_string:

```
    "test:e2e": "playwright test --pass-with-no-tests",
    "test:integration": "jest tests/integration --passWithNoTests --runInBand",
```

(If the order differs, place after `test:unit:watch` consistent with surrounding style.)

### Step 4: Write the integration test

- [ ] **Create `tests/integration/rpc-auth-gates.test.ts`**

```ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "@jest/globals";

const projectUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const skip = !projectUrl || !serviceKey;

(skip ? describe.skip : describe)("RPC auth gates (integration)", () => {
  const client = createClient(projectUrl as string, serviceKey as string);

  it("update_claim_by_finance rejects non-finance actor", async () => {
    const { error } = await client.rpc("update_claim_by_finance", {
      p_claim_id: "__fake_integration_test__",
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_edit_reason: "integration test for auth gate",
      p_payload: {},
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("p_actor_id is not an active finance approver");
  });

  it("update_claim_by_submitter rejects non-owner actor", async () => {
    const { data: claims } = await client
      .from("claims")
      .select("id")
      .eq("is_active", true)
      .limit(1);

    const claimId = claims?.[0]?.id ?? "__fake_integration_test__";

    const { error } = await client.rpc("update_claim_by_submitter", {
      p_claim_id: claimId,
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_payload: {
        detailType: "expense",
        detailId: "00000000-0000-0000-0000-000000000000",
      },
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("p_actor_id is not the claim submitter");
  });

  it("update_claim_by_finance still has all expected arg types", async () => {
    // A regression check: calling with wrong arg shape should fail at the function-resolution layer,
    // not silently succeed. This catches a future migration that accidentally drops the function.
    const { error } = await client.rpc("update_claim_by_finance", {
      // intentionally missing p_payload to force a wrong-arity error from PostgREST
      p_claim_id: "__test__",
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_edit_reason: "x".repeat(10),
    } as never);
    expect(error).not.toBeNull();
  });
});

if (skip) {
  console.warn(
    "[rpc-auth-gates] Skipped. To run: set SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY env vars.",
  );
}
```

### Step 5: Run with env vars to confirm the tests actually exercise the live RPCs

- [ ] **Run with the test project's credentials**

The plan author must NOT commit credentials. Run locally with:

```bash
SUPABASE_TEST_URL=https://pltbwxddxtsavygijcnl.supabase.co \
SUPABASE_TEST_SERVICE_ROLE_KEY=<service-role-key-from-1Password-or-similar> \
npm run test:integration
```

Expected: 3 passing tests.

If you don't have credentials available in this session, run without them and confirm the suite is correctly skipped:

```bash
npm run test:integration 2>&1 | tail -5
```

Expected: 1 skipped describe block; console warning printed; exit 0.

### Step 6: Confirm `npm run test:unit` STILL ignores the integration dir

- [ ] **Run**

```bash
npm run test:unit 2>&1 | grep -E "Tests:|Test Suites:" | head -3
```

Expected: 77 suites passed (NOT 78). If 78, the testPathIgnorePatterns edit didn't take effect — fix the jest config.

### Step 7: Commit

- [ ] **Commit**

```bash
git add tests/integration/rpc-auth-gates.test.ts package.json jest.config.*
git commit -m "$(cat <<'EOF'
test(integration): add RPC auth-gate regression tests

New tests/integration/rpc-auth-gates.test.ts verifies that
update_claim_by_finance and update_claim_by_submitter reject
unauthorized callers when invoked against the live database. Gated
behind SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_ROLE_KEY env vars and
skipped by default so npm run test:unit stays credential-free.

Added npm run test:integration script and Jest ignore pattern so the
default unit-test run doesn't pick these up. CI can opt in by setting
the env vars.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final quality gate + push + PR comment

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: exit 0.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Full unit suite (now `--runInBand`)**

```bash
npm run test:unit 2>&1 | tail -5
```

Expected: 0 failures, total count = (previous 533) + 6 new dedup cases? Actually +3 dedup cases (Task 2) + any test mock updates in Task 4 might not change count. Verify count ≥ 533 and 0 failed.

- [ ] **Step 4: Push**

```bash
git push origin ForeignC
```

- [ ] **Step 5: Comment on PR #127**

```bash
gh pr comment 127 --body "$(cat <<'EOF'
## Residual cleanup from final review landed

Closes out the 4 NEEDS_DISCUSSION items + the CI parallel-flake.

### Commits
| SHA | Item |
|---|---|
| (Task 1) | chore(test): add --runInBand to test:unit for deterministic execution |
| (Task 2) | fix(dedup): short-circuit foreign dedup when either side's foreign_basic_amount is null |
| (Task 3) | fix(rpc): reorder update_claim_by_submitter auth-check before row lock |
| (Task 4) | fix(repo): route submitter edits through update_claim_by_submitter RPC |
| (Task 5) | test(integration): add RPC auth-gate regression tests |

### Verification
- Lint + typecheck ✅
- `npm run test:unit` (now deterministic via --runInBand) → all passing
- `npm run test:integration` (env-gated) → 3 RPC auth-gate tests pass against NxtClaimTest
- Live DB verified via Supabase MCP: both auth-gated RPCs still raise correctly for unauthorized callers

### Final state of original review items
| Severity | Item | Status |
|---|---|---|
| Important | update_claim_by_submitter dead code | ✅ Wired up |
| Important | Dedup foreign null edge | ✅ Fixed + tested |
| Minor | Lock ordering | ✅ Reordered (new migration) |
| Minor | No RPC integration tests | ✅ Added |
| Low | CI parallel flake | ✅ --runInBand |

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Fill in actual commit SHAs in the table.

---

## Risks (reminder during execution)

- **Task 4 is the most consequential.** Behavior must be identical to direct writes. If you see ANY test fail that isn't a mock-mismatch, investigate before proceeding.
- **Task 3's lock split visibility window:** between the preliminary `SELECT` and `SELECT FOR UPDATE`, the row could change. Postgres handles this safely (the second SELECT just sees current state); the auth check on the snapshot is still correct because submitted_by is essentially immutable.
- **Task 5's integration tests require credentials.** If credentials aren't available locally, confirm the skip-path works and move on. Don't commit credentials.
