# Dual Duplicate Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI/finance-stage duplicate check (`find_claim_duplicates`) run the invoice-number check AND the amount+date check independently every time, and surface both result sets together in the claim panel, the finance approve guard, and the bulk-approval list.

**Architecture:** The SQL helper drops its mutual-exclusivity gate so both arms always run. The single `duplicate_status`/`duplicate_claim_ids` columns on `claim_verification_runs` are superseded by two parallel typed column-pairs (invoice arm + amount+date arm). The write path (worker → RPC) and read path (repository → UI) are migrated to carry two independent `{ status, claimIds }` arms.

**Tech Stack:** PostgreSQL (Supabase) migrations, TypeScript, Next.js App Router (server components + server actions), Jest (unit), Playwright (e2e).

## Global Constraints

- Scope is the `find_claim_duplicates` graded path ONLY. Do NOT touch `existsExpenseByCompositeKey` (intake hard-block) or `sync_duplicate_flags` / `suspected_duplicate_ids` (soft flag).
- Legacy columns `claim_verification_runs.duplicate_status` and `duplicate_claim_ids` MUST be kept (not dropped) — dropping them forces a `CREATE OR REPLACE VIEW` cascade (SQLSTATE 42P16). New code stops writing/reading them; they keep their defaults.
- The `claim_latest_verification` view can only have columns APPENDED at the end (append-only constraint). Add new columns after the existing ones.
- Per-arm status values: exactly `none` | `match` | `unavailable`.
- Migrations run with `npm run db:migrate` (custom `scripts/run-migrations.mjs`). New migration timestamp must sort AFTER `20260618120000`. Rollbacks live in `supabase/rollbacks/<same-name>_rollback.sql`.
- `src/types/database.ts` is hand-maintained — edit it directly to match schema changes.
- Match existing file style; surgical changes only.

---

### Task 1: Database migration — helper gate, columns, view, RPC

**Files:**

- Create: `supabase/migrations/20260619120000_dual_duplicate_detection.sql`
- Create: `supabase/rollbacks/20260619120000_dual_duplicate_detection_rollback.sql`
- Modify: `src/types/database.ts` (claim_verification_runs Row/Insert/Update ~lines 367/389/411, `claim_latest_verification` view Row ~line 1537, `complete_verification_run` Args ~line 1866)

**Interfaces:**

- Produces SQL function `complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb)` — params in order: `p_run_id, p_overall_verdict, p_model, p_receipt_hash, p_bank_hash, p_invoice_duplicate_status, p_invoice_duplicate_claim_ids, p_amount_date_duplicate_status, p_amount_date_duplicate_claim_ids, p_checks`.
- Produces columns `claim_verification_runs.{invoice_duplicate_status, invoice_duplicate_claim_ids, amount_date_duplicate_status, amount_date_duplicate_claim_ids}` and the same four on the `claim_latest_verification` view.
- `find_claim_duplicates(text, text, date, numeric)` signature and `(claim_id, submitted_by, match_kind)` return shape are UNCHANGED.

- [ ] **Step 1: Write the forward migration**

Create `supabase/migrations/20260619120000_dual_duplicate_detection.sql`:

```sql
-- Migration: dual_duplicate_detection
-- Run BOTH duplicate arms independently (invoice AND amount+date), instead of
-- invoice-first-with-amount+date-fallback. Surface each arm separately.
--   * find_claim_duplicates(): amount+date arm no longer gated on invoice being absent.
--   * claim_verification_runs gains two typed column-pairs (one per arm). Legacy
--     duplicate_status / duplicate_claim_ids are KEPT (avoids view cascade) but unused.
--   * claim_latest_verification view APPENDS the four new columns.
--   * complete_verification_run() takes the four new params (one write per run).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper: both arms always run (drop the `norm.inv IS NULL` gate on arm 2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_claim_duplicates(
  p_exclude_claim_id text,
  p_bill_no          text,
  p_transaction_date date,
  p_total_amount     numeric
)
RETURNS TABLE (claim_id text, submitted_by uuid, match_kind text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH norm AS (SELECT public.normalize_invoice_no(p_bill_no) AS inv)
  -- invoice present → invoice match (any submitter)
  SELECT c.id, c.submitted_by, 'invoice_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  CROSS JOIN norm
  WHERE norm.inv IS NOT NULL
    AND ed.is_active = true
    AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status
    )
    AND ed.claim_id <> p_exclude_claim_id
    AND public.normalize_invoice_no(ed.bill_no) = norm.inv
  UNION
  -- amount + date match (runs regardless of invoice presence)
  SELECT c.id, c.submitted_by, 'amount_date_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  WHERE p_transaction_date IS NOT NULL
    AND p_total_amount IS NOT NULL
    AND ed.is_active = true
    AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status
    )
    AND ed.claim_id <> p_exclude_claim_id
    AND ed.transaction_date = p_transaction_date
    AND ed.total_amount = p_total_amount;
$$;

ALTER FUNCTION public.find_claim_duplicates(text, text, date, numeric) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 2. Two typed column-pairs on the run (legacy columns kept untouched)
-- ---------------------------------------------------------------------------
ALTER TABLE public.claim_verification_runs
  ADD COLUMN IF NOT EXISTS invoice_duplicate_status        text   NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS invoice_duplicate_claim_ids     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS amount_date_duplicate_status    text   NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS amount_date_duplicate_claim_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_invoice_duplicate_status_check;
ALTER TABLE public.claim_verification_runs
  ADD CONSTRAINT claim_verification_runs_invoice_duplicate_status_check
  CHECK (invoice_duplicate_status = ANY (ARRAY['none', 'match', 'unavailable']));

ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_amount_date_duplicate_status_check;
ALTER TABLE public.claim_verification_runs
  ADD CONSTRAINT claim_verification_runs_amount_date_duplicate_status_check
  CHECK (amount_date_duplicate_status = ANY (ARRAY['none', 'match', 'unavailable']));

-- ---------------------------------------------------------------------------
-- 3. View: APPEND the four new columns at the end (append-only; 42P16 on reorder)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claim_latest_verification
  WITH (security_invoker = on) AS
SELECT DISTINCT ON (r.claim_id)
  r.claim_id,
  r.id              AS run_id,
  r.status,
  r.overall_verdict,
  r.created_at,
  r.finished_at,
  r.duplicate_status,
  r.duplicate_claim_ids,
  r.invoice_duplicate_status,
  r.invoice_duplicate_claim_ids,
  r.amount_date_duplicate_status,
  r.amount_date_duplicate_claim_ids
FROM public.claim_verification_runs r
WHERE r.superseded = false
ORDER BY r.claim_id, r.created_at DESC;

ALTER VIEW public.claim_latest_verification OWNER TO postgres;
GRANT SELECT ON public.claim_latest_verification TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. complete_verification_run(): four new params replace the single pair
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb);

CREATE OR REPLACE FUNCTION public.complete_verification_run(
  p_run_id          uuid,
  p_overall_verdict text,
  p_model           text,
  p_receipt_hash    text,
  p_bank_hash       text,
  p_invoice_duplicate_status     text,
  p_invoice_duplicate_claim_ids  text[],
  p_amount_date_duplicate_status text,
  p_amount_date_duplicate_claim_ids text[],
  p_checks          jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_ai_verifier_id uuid := '11111111-1111-4111-8111-111111111111';
  v_run            public.claim_verification_runs%ROWTYPE;
  v_current_snap   jsonb;
  v_superseded     boolean;
BEGIN
  SELECT * INTO v_run FROM public.claim_verification_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification run % not found', p_run_id;
  END IF;

  v_current_snap := public.build_verification_snapshot(v_run.claim_id);
  v_superseded := v_run.superseded
                  OR (v_current_snap IS DISTINCT FROM v_run.submitted_values_snapshot);

  UPDATE public.claim_verification_runs
  SET    status = 'completed',
         overall_verdict = p_overall_verdict,
         model = p_model,
         receipt_file_hash = p_receipt_hash,
         bank_statement_file_hash = p_bank_hash,
         invoice_duplicate_status = coalesce(p_invoice_duplicate_status, 'unavailable'),
         invoice_duplicate_claim_ids = coalesce(p_invoice_duplicate_claim_ids, '{}'),
         amount_date_duplicate_status = coalesce(p_amount_date_duplicate_status, 'unavailable'),
         amount_date_duplicate_claim_ids = coalesce(p_amount_date_duplicate_claim_ids, '{}'),
         superseded = v_superseded,
         finished_at = now(),
         error_detail = NULL
  WHERE  id = p_run_id;

  DELETE FROM public.claim_verification_checks WHERE run_id = p_run_id;

  INSERT INTO public.claim_verification_checks (
    run_id, field, lane, submitted_value, extracted_raw, extracted_normalized,
    verdict, hardness, confidence, tolerance_applied, mismatch_reason
  )
  SELECT
    p_run_id, c->>'field', coalesce(c->>'lane', 'receipt'),
    c->>'submitted_value', c->>'extracted_raw', c->>'extracted_normalized',
    c->>'verdict', coalesce(c->>'hardness', 'soft'),
    nullif(c->>'confidence', '')::integer, c->>'tolerance_applied', c->>'mismatch_reason'
  FROM jsonb_array_elements(coalesce(p_checks, '[]'::jsonb)) AS c;

  IF NOT v_superseded THEN
    INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
    VALUES (v_run.claim_id, v_ai_verifier_id, 'AI_VERIFICATION_COMPLETED',
            format('AI verification: %s | invoice dup: %s | amount+date dup: %s',
                   p_overall_verdict,
                   coalesce(p_invoice_duplicate_status, 'unavailable'),
                   coalesce(p_amount_date_duplicate_status, 'unavailable')));
  END IF;
END
$$;

ALTER FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 5. Grants (mirror existing posture)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.find_claim_duplicates(text, text, date, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.find_claim_duplicates(text, text, date, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb) TO service_role;

COMMIT;
```

- [ ] **Step 2: Write the rollback migration**

Create `supabase/rollbacks/20260619120000_dual_duplicate_detection_rollback.sql`:

```sql
-- Rollback: dual_duplicate_detection
-- Restores the invoice-first helper + the single-pair complete_verification_run,
-- removes the four new columns and the two CHECK constraints. The view is
-- recreated WITHOUT the four new columns.
BEGIN;

-- 1. Restore invoice-first helper (amount+date arm gated on invoice absent)
CREATE OR REPLACE FUNCTION public.find_claim_duplicates(
  p_exclude_claim_id text,
  p_bill_no          text,
  p_transaction_date date,
  p_total_amount     numeric
)
RETURNS TABLE (claim_id text, submitted_by uuid, match_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  WITH norm AS (SELECT public.normalize_invoice_no(p_bill_no) AS inv)
  SELECT c.id, c.submitted_by, 'invoice_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  CROSS JOIN norm
  WHERE norm.inv IS NOT NULL
    AND ed.is_active = true AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status)
    AND ed.claim_id <> p_exclude_claim_id
    AND public.normalize_invoice_no(ed.bill_no) = norm.inv
  UNION
  SELECT c.id, c.submitted_by, 'amount_date_match'::text
  FROM public.expense_details ed
  JOIN public.claims c ON c.id = ed.claim_id
  CROSS JOIN norm
  WHERE norm.inv IS NULL
    AND p_transaction_date IS NOT NULL AND p_total_amount IS NOT NULL
    AND ed.is_active = true AND c.is_active = true
    AND c.status NOT IN (
      'Rejected - Resubmission Not Allowed'::public.claim_status,
      'Rejected - Resubmission Allowed'::public.claim_status)
    AND ed.claim_id <> p_exclude_claim_id
    AND ed.transaction_date = p_transaction_date
    AND ed.total_amount = p_total_amount;
$$;
ALTER FUNCTION public.find_claim_duplicates(text, text, date, numeric) OWNER TO postgres;

-- 2. Recreate the view without the four new columns
CREATE OR REPLACE VIEW public.claim_latest_verification
  WITH (security_invoker = on) AS
SELECT DISTINCT ON (r.claim_id)
  r.claim_id, r.id AS run_id, r.status, r.overall_verdict,
  r.created_at, r.finished_at, r.duplicate_status, r.duplicate_claim_ids
FROM public.claim_verification_runs r
WHERE r.superseded = false
ORDER BY r.claim_id, r.created_at DESC;
ALTER VIEW public.claim_latest_verification OWNER TO postgres;
GRANT SELECT ON public.claim_latest_verification TO authenticated, service_role;

-- 3. Restore the single-pair complete_verification_run
DROP FUNCTION IF EXISTS public.complete_verification_run(uuid, text, text, text, text, text, text[], text, text[], jsonb);
CREATE OR REPLACE FUNCTION public.complete_verification_run(
  p_run_id uuid, p_overall_verdict text, p_model text, p_receipt_hash text,
  p_bank_hash text, p_duplicate_status text, p_duplicate_claim_ids text[], p_checks jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_ai_verifier_id uuid := '11111111-1111-4111-8111-111111111111';
  v_run public.claim_verification_runs%ROWTYPE;
  v_current_snap jsonb; v_superseded boolean;
BEGIN
  SELECT * INTO v_run FROM public.claim_verification_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'verification run % not found', p_run_id; END IF;
  v_current_snap := public.build_verification_snapshot(v_run.claim_id);
  v_superseded := v_run.superseded OR (v_current_snap IS DISTINCT FROM v_run.submitted_values_snapshot);
  UPDATE public.claim_verification_runs
  SET status='completed', overall_verdict=p_overall_verdict, model=p_model,
      receipt_file_hash=p_receipt_hash, bank_statement_file_hash=p_bank_hash,
      duplicate_status=coalesce(p_duplicate_status,'unavailable'),
      duplicate_claim_ids=coalesce(p_duplicate_claim_ids,'{}'),
      superseded=v_superseded, finished_at=now(), error_detail=NULL
  WHERE id=p_run_id;
  DELETE FROM public.claim_verification_checks WHERE run_id = p_run_id;
  INSERT INTO public.claim_verification_checks (
    run_id, field, lane, submitted_value, extracted_raw, extracted_normalized,
    verdict, hardness, confidence, tolerance_applied, mismatch_reason)
  SELECT p_run_id, c->>'field', coalesce(c->>'lane','receipt'),
    c->>'submitted_value', c->>'extracted_raw', c->>'extracted_normalized',
    c->>'verdict', coalesce(c->>'hardness','soft'),
    nullif(c->>'confidence','')::integer, c->>'tolerance_applied', c->>'mismatch_reason'
  FROM jsonb_array_elements(coalesce(p_checks,'[]'::jsonb)) AS c;
  IF NOT v_superseded THEN
    INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
    VALUES (v_run.claim_id, v_ai_verifier_id, 'AI_VERIFICATION_COMPLETED',
            format('AI verification: %s | duplicate: %s', p_overall_verdict,
                   coalesce(p_duplicate_status,'unavailable')));
  END IF;
END $$;
ALTER FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_verification_run(uuid, text, text, text, text, text, text[], jsonb) TO service_role;

-- 4. Drop the four columns + their constraints
ALTER TABLE public.claim_verification_runs
  DROP CONSTRAINT IF EXISTS claim_verification_runs_invoice_duplicate_status_check,
  DROP CONSTRAINT IF EXISTS claim_verification_runs_amount_date_duplicate_status_check,
  DROP COLUMN IF EXISTS invoice_duplicate_status,
  DROP COLUMN IF EXISTS invoice_duplicate_claim_ids,
  DROP COLUMN IF EXISTS amount_date_duplicate_status,
  DROP COLUMN IF EXISTS amount_date_duplicate_claim_ids;

COMMIT;
```

- [ ] **Step 3: Update `src/types/database.ts`**

In the `claim_verification_runs` table type, find the three blocks containing `duplicate_status` / `duplicate_claim_ids` (Row ~367, Insert ~389, Update ~411). Directly BELOW the `duplicate_claim_ids` line in each block, add the four new fields. In the **Row** block use required types; in **Insert** and **Update** mark them optional (`?:`), mirroring how `duplicate_status` is typed in each block:

```ts
// Row block:
          invoice_duplicate_status: string;
          invoice_duplicate_claim_ids: string[];
          amount_date_duplicate_status: string;
          amount_date_duplicate_claim_ids: string[];
// Insert + Update blocks:
          invoice_duplicate_status?: string;
          invoice_duplicate_claim_ids?: string[];
          amount_date_duplicate_status?: string;
          amount_date_duplicate_claim_ids?: string[];
```

In the `claim_latest_verification` view Row type (~line 1537), below `duplicate_status: string | null;` add:

```ts
          duplicate_claim_ids: string[] | null;
          invoice_duplicate_status: string | null;
          invoice_duplicate_claim_ids: string[] | null;
          amount_date_duplicate_status: string | null;
          amount_date_duplicate_claim_ids: string[] | null;
```

(If `duplicate_claim_ids` is already present in the view type, do not duplicate it — only add the four `*_duplicate_*` lines that are missing.)

In the `complete_verification_run` `Args` type (~line 1866), REMOVE `p_duplicate_status: string;` and `p_duplicate_claim_ids: string[];` and replace with:

```ts
          p_invoice_duplicate_status: string;
          p_invoice_duplicate_claim_ids: string[];
          p_amount_date_duplicate_status: string;
          p_amount_date_duplicate_claim_ids: string[];
```

- [ ] **Step 4: Apply the migration and verify**

Run: `npm run db:migrate`
Expected: completes without error; the new migration is reported as applied.

Verify the schema with a quick query (via your SQL client or the Supabase MCP `execute_sql`):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'claim_verification_runs'
  AND column_name LIKE '%duplicate%'
ORDER BY column_name;
```

Expected rows: `amount_date_duplicate_claim_ids`, `amount_date_duplicate_status`, `duplicate_claim_ids`, `duplicate_status`, `invoice_duplicate_claim_ids`, `invoice_duplicate_status`.

- [ ] **Step 5: Verify types compile**

Run: `npm run typecheck`
Expected: PASS (no errors from `database.ts` edits).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260619120000_dual_duplicate_detection.sql supabase/rollbacks/20260619120000_dual_duplicate_detection_rollback.sql src/types/database.ts
git commit -m "feat(db): dual duplicate detection schema + helper + RPC"
```

---

### Task 2: Pure duplicate-grading helper + unit tests

**Files:**

- Create: `src/modules/claims/verification/duplicate-grading.ts`
- Test: `tests/unit/claims/duplicate-grading.test.ts`

**Interfaces:**

- Produces: `type DuplicateArmStatus = "none" | "match" | "unavailable"`; `type DuplicateArm = { status: DuplicateArmStatus; claimIds: string[] }`; `function gradeDuplicateArms(rows: { claim_id: string; match_kind: string }[], flags: { invoiceUnavailable: boolean; amountDateAvailable: boolean }): { invoice: DuplicateArm; amountDate: DuplicateArm }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/claims/duplicate-grading.test.ts`:

```ts
import { describe, expect, it } from "@jest/globals";
import { gradeDuplicateArms } from "@/modules/claims/verification/duplicate-grading";

describe("gradeDuplicateArms", () => {
  it("surfaces invoice and amount+date matches independently (different peers)", () => {
    const rows = [
      { claim_id: "C-INV", match_kind: "invoice_match" },
      { claim_id: "C-AMT", match_kind: "amount_date_match" },
    ];
    const result = gradeDuplicateArms(rows, {
      invoiceUnavailable: false,
      amountDateAvailable: true,
    });
    expect(result.invoice).toEqual({ status: "match", claimIds: ["C-INV"] });
    expect(result.amountDate).toEqual({ status: "match", claimIds: ["C-AMT"] });
  });

  it("invoice read-failure marks invoice unavailable but still grades amount+date", () => {
    const rows = [{ claim_id: "C-AMT", match_kind: "amount_date_match" }];
    const result = gradeDuplicateArms(rows, {
      invoiceUnavailable: true,
      amountDateAvailable: true,
    });
    expect(result.invoice).toEqual({ status: "unavailable", claimIds: [] });
    expect(result.amountDate).toEqual({ status: "match", claimIds: ["C-AMT"] });
  });

  it("no rows → both arms none when both inputs available", () => {
    const result = gradeDuplicateArms([], { invoiceUnavailable: false, amountDateAvailable: true });
    expect(result.invoice).toEqual({ status: "none", claimIds: [] });
    expect(result.amountDate).toEqual({ status: "none", claimIds: [] });
  });

  it("missing date/amount marks amount+date unavailable", () => {
    const result = gradeDuplicateArms([], {
      invoiceUnavailable: false,
      amountDateAvailable: false,
    });
    expect(result.amountDate).toEqual({ status: "unavailable", claimIds: [] });
  });

  it("collapses multiple invoice rows into one claimIds list", () => {
    const rows = [
      { claim_id: "C-1", match_kind: "invoice_match" },
      { claim_id: "C-2", match_kind: "invoice_match" },
    ];
    const result = gradeDuplicateArms(rows, {
      invoiceUnavailable: false,
      amountDateAvailable: true,
    });
    expect(result.invoice.claimIds).toEqual(["C-1", "C-2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- duplicate-grading`
Expected: FAIL — cannot find module `@/modules/claims/verification/duplicate-grading`.

- [ ] **Step 3: Write the helper**

Create `src/modules/claims/verification/duplicate-grading.ts`:

```ts
export type DuplicateArmStatus = "none" | "match" | "unavailable";
export type DuplicateArm = { status: DuplicateArmStatus; claimIds: string[] };

/**
 * Grades the two independent duplicate arms from the find_claim_duplicates rows.
 * - invoiceUnavailable: the claim has an invoice number but the AI could not extract one.
 * - amountDateAvailable: both transaction date AND total amount are present.
 */
export function gradeDuplicateArms(
  rows: { claim_id: string; match_kind: string }[],
  flags: { invoiceUnavailable: boolean; amountDateAvailable: boolean },
): { invoice: DuplicateArm; amountDate: DuplicateArm } {
  const invoiceIds = rows.filter((r) => r.match_kind === "invoice_match").map((r) => r.claim_id);
  const amountDateIds = rows
    .filter((r) => r.match_kind === "amount_date_match")
    .map((r) => r.claim_id);

  const invoice: DuplicateArm = flags.invoiceUnavailable
    ? { status: "unavailable", claimIds: [] }
    : invoiceIds.length > 0
      ? { status: "match", claimIds: invoiceIds }
      : { status: "none", claimIds: [] };

  const amountDate: DuplicateArm = !flags.amountDateAvailable
    ? { status: "unavailable", claimIds: [] }
    : amountDateIds.length > 0
      ? { status: "match", claimIds: amountDateIds }
      : { status: "none", claimIds: [] };

  return { invoice, amountDate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- duplicate-grading`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/claims/verification/duplicate-grading.ts tests/unit/claims/duplicate-grading.test.ts
git commit -m "feat: pure two-arm duplicate grading helper"
```

---

### Task 3: Wire the write path (detectDuplicate, RPC call, worker)

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseVerificationRepository.ts` (`detectDuplicate` ~122-169, `completeVerificationRun` ~93-115)
- Modify: `src/modules/claims/verification/verification-worker.ts` (no-document early-exit ~109-118, dedup block ~263-287)

**Interfaces:**

- Consumes: `gradeDuplicateArms`, `DuplicateArm`, `DuplicateArmStatus` from `@/modules/claims/verification/duplicate-grading` (Task 2).
- Produces: `detectDuplicate(...)` now returns `{ data: { invoice: DuplicateArm; amountDate: DuplicateArm }; errorMessage: string | null }`. `completeVerificationRun` input gains `invoiceDuplicateStatus: string; invoiceDuplicateClaimIds: string[]; amountDateDuplicateStatus: string; amountDateDuplicateClaimIds: string[]` and drops `duplicateStatus` / `duplicateClaimIds`.

- [ ] **Step 1: Rewrite `detectDuplicate` to grade both arms**

In `SupabaseVerificationRepository.ts`, add to the top-of-file imports:

```ts
import {
  gradeDuplicateArms,
  type DuplicateArm,
} from "@/modules/claims/verification/duplicate-grading";
```

Replace the entire `detectDuplicate` method (currently ~122-169) with:

```ts
  /**
   * Finance-stage duplicate detection on EXTRACTED values. Grades BOTH arms
   * (invoice number AND amount+date) independently — a claim may match either,
   * both, or neither, against potentially different peer claims. A failed
   * invoice read (submitted invoice present but nothing extracted) marks the
   * invoice arm `unavailable` while still grading amount+date.
   */
  async detectDuplicate(input: {
    claimId: string;
    extractedBillNo: string | null;
    submittedBillNo: string | null;
    transactionDate: string | null;
    totalAmount: number | null;
  }): Promise<{
    data: { invoice: DuplicateArm; amountDate: DuplicateArm };
    errorMessage: string | null;
  }> {
    const extractedInv = normalizeSentinel(input.extractedBillNo);
    const submittedInv = normalizeSentinel(input.submittedBillNo);
    const invoiceUnavailable = extractedInv === null && submittedInv !== null;
    const amountDateAvailable = input.transactionDate !== null && input.totalAmount !== null;

    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("find_claim_duplicates", {
      p_exclude_claim_id: input.claimId,
      p_bill_no: extractedInv, // null → invoice arm yields nothing; amount+date arm still runs
      p_transaction_date: input.transactionDate,
      p_total_amount: input.totalAmount,
    });
    if (error) {
      return {
        data: {
          invoice: { status: "unavailable", claimIds: [] },
          amountDate: { status: "unavailable", claimIds: [] },
        },
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as { claim_id: string; match_kind: string }[];
    return {
      data: gradeDuplicateArms(rows, { invoiceUnavailable, amountDateAvailable }),
      errorMessage: null,
    };
  }
```

- [ ] **Step 2: Update `completeVerificationRun` signature + RPC call**

In `SupabaseVerificationRepository.ts`, replace the `completeVerificationRun` input fields and rpc args (currently ~93-114). Change the input object's `duplicateStatus`/`duplicateClaimIds` (lines 99-100) to the four new fields, and the rpc args (lines 110-111) accordingly:

```ts
  async completeVerificationRun(input: {
    runId: string;
    overallVerdict: string;
    model: string;
    receiptHash: string | null;
    bankHash: string | null;
    invoiceDuplicateStatus: string;
    invoiceDuplicateClaimIds: string[];
    amountDateDuplicateStatus: string;
    amountDateDuplicateClaimIds: string[];
    checks: VerificationCheckInput[];
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.rpc("complete_verification_run", {
      p_run_id: input.runId,
      p_overall_verdict: input.overallVerdict,
      p_model: input.model,
      p_receipt_hash: input.receiptHash,
      p_bank_hash: input.bankHash,
      p_invoice_duplicate_status: input.invoiceDuplicateStatus,
      p_invoice_duplicate_claim_ids: input.invoiceDuplicateClaimIds,
      p_amount_date_duplicate_status: input.amountDateDuplicateStatus,
      p_amount_date_duplicate_claim_ids: input.amountDateDuplicateClaimIds,
      p_checks: input.checks,
    });
    return { errorMessage: error?.message ?? null };
  }
```

- [ ] **Step 3: Update the worker no-document early-exit**

In `verification-worker.ts`, the `completeVerificationRun` call inside the "Neither document on record" branch (~109-118): replace the `duplicateStatus`/`duplicateClaimIds` lines with:

```ts
        invoiceDuplicateStatus: "unavailable",
        invoiceDuplicateClaimIds: [],
        amountDateDuplicateStatus: "unavailable",
        amountDateDuplicateClaimIds: [],
```

- [ ] **Step 4: Update the worker dedup block + final completeVerificationRun**

In `verification-worker.ts`, replace the dedup block (currently ~263-287, from `let duplicateStatus = "unavailable";` through the `completeVerificationRun({...})` call) with:

```ts
// Finance-stage duplicate detection on the extracted values (degrades to unavailable).
let invoiceDuplicate: { status: string; claimIds: string[] } = {
  status: "unavailable",
  claimIds: [],
};
let amountDateDuplicate: { status: string; claimIds: string[] } = {
  status: "unavailable",
  claimIds: [],
};
if (dedupInputs) {
  const dup = await this.repository.detectDuplicate({
    claimId: run.claim_id,
    extractedBillNo: dedupInputs.extractedBillNo,
    submittedBillNo: run.submitted_values_snapshot.bill_no,
    transactionDate: dedupInputs.transactionDate,
    totalAmount: dedupInputs.totalAmount,
  });
  invoiceDuplicate = dup.data.invoice;
  amountDateDuplicate = dup.data.amountDate;
}

const { errorMessage } = await this.repository.completeVerificationRun({
  runId: run.id,
  overallVerdict: overall,
  model: serverEnv.GEMINI_MODEL,
  receiptHash,
  bankHash,
  invoiceDuplicateStatus: invoiceDuplicate.status,
  invoiceDuplicateClaimIds: invoiceDuplicate.claimIds,
  amountDateDuplicateStatus: amountDateDuplicate.status,
  amountDateDuplicateClaimIds: amountDateDuplicate.claimIds,
  checks: checks.map(toCheckInput),
});
```

- [ ] **Step 5: Verify typecheck + existing unit tests pass**

Run: `npm run typecheck`
Expected: PASS. (Note: any test that constructs a `completeVerificationRun` argument with the old `duplicateStatus` field will fail to compile — update those call sites in the same step if present; search with `grep -rn "duplicateStatus" tests/`.)

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/claims/repositories/SupabaseVerificationRepository.ts src/modules/claims/verification/verification-worker.ts
git commit -m "feat: worker writes both duplicate arms"
```

---

### Task 4: Read path + types + UI surfaces

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseVerificationRepository.ts` (`VerificationSummary` type ~411-421, `VerificationRunSummaryRow` ~371-381, `LatestVerificationRow` ~432-437, `DuplicateStatus` ~409, `getClaimVerificationSummary` ~203-261, `getLatestVerdictsByClaimIds` ~263-289)
- Modify: `src/modules/claims/ui/verification-panel.tsx` (~333-364)
- Modify: `src/app/(dashboard)/dashboard/claims/[id]/page.tsx` (~759-772)
- Modify: `src/modules/claims/ui/finance-approvals-bulk-table.tsx` (prop ~55, badge map ~58-81, render ~705)
- Modify: `src/modules/claims/ui/claims-approvals-section.tsx` (empty-data literal ~206-209, row mapping ~289)

**Interfaces:**

- Consumes: `DuplicateArm`, `DuplicateArmStatus` from `@/modules/claims/verification/duplicate-grading`.
- Produces: `VerificationSummary` gains `invoiceDuplicate: DuplicateArm; amountDateDuplicate: DuplicateArm` (drops `duplicateStatus`/`duplicateClaimIds`). `getLatestVerdictsByClaimIds` returns `Record<string, { verdict: VerificationBadgeState; invoiceDuplicate: DuplicateArmStatus; amountDateDuplicate: DuplicateArmStatus }>`. Bulk-table row gains `aiInvoiceDuplicate?: DuplicateArmStatus | null; aiAmountDateDuplicate?: DuplicateArmStatus | null` (drops `aiDuplicate`).

- [ ] **Step 1: Update repository types**

In `SupabaseVerificationRepository.ts`, add to the duplicate-grading import from Task 3 the `DuplicateArmStatus` type:

```ts
import {
  gradeDuplicateArms,
  type DuplicateArm,
  type DuplicateArmStatus,
} from "@/modules/claims/verification/duplicate-grading";
```

Delete the line `export type DuplicateStatus = "none" | "invoice_match" | "amount_date_match" | "unavailable";` (~409).

In `VerificationRunSummaryRow` (~371-381), replace `duplicate_status: DuplicateStatus;` and `duplicate_claim_ids: string[] | null;` with:

```ts
  invoice_duplicate_status: DuplicateArmStatus;
  invoice_duplicate_claim_ids: string[] | null;
  amount_date_duplicate_status: DuplicateArmStatus;
  amount_date_duplicate_claim_ids: string[] | null;
```

In `VerificationSummary` (~411-421), replace `duplicateStatus: DuplicateStatus;` and `duplicateClaimIds: string[];` with:

```ts
invoiceDuplicate: DuplicateArm;
amountDateDuplicate: DuplicateArm;
```

In `LatestVerificationRow` (~432-437), replace `duplicate_status: DuplicateStatus | null;` with:

```ts
invoice_duplicate_status: DuplicateArmStatus | null;
amount_date_duplicate_status: DuplicateArmStatus | null;
```

- [ ] **Step 2: Update `getClaimVerificationSummary`**

In the `.select(...)` (~209-211) replace `duplicate_status, duplicate_claim_ids` with `invoice_duplicate_status, invoice_duplicate_claim_ids, amount_date_duplicate_status, amount_date_duplicate_claim_ids`. The line becomes:

```ts
        "id, status, overall_verdict, invoice_duplicate_status, invoice_duplicate_claim_ids, amount_date_duplicate_status, amount_date_duplicate_claim_ids, model, receipt_file_hash, finished_at, created_at",
```

In the returned object (~241-242) replace the `duplicateStatus`/`duplicateClaimIds` fields with:

```ts
        invoiceDuplicate: {
          status: run.invoice_duplicate_status,
          claimIds: run.invoice_duplicate_claim_ids ?? [],
        },
        amountDateDuplicate: {
          status: run.amount_date_duplicate_status,
          claimIds: run.amount_date_duplicate_claim_ids ?? [],
        },
```

- [ ] **Step 3: Update `getLatestVerdictsByClaimIds`**

Replace the method body's return-type, select, and map (~263-289) with:

```ts
  /** Bulk badge state + both duplicate arms for the finance queue, one entry per claim id. */
  async getLatestVerdictsByClaimIds(claimIds: string[]): Promise<{
    data: Record<
      string,
      {
        verdict: VerificationBadgeState;
        invoiceDuplicate: DuplicateArmStatus;
        amountDateDuplicate: DuplicateArmStatus;
      }
    >;
    errorMessage: string | null;
  }> {
    if (claimIds.length === 0) {
      return { data: {}, errorMessage: null };
    }
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claim_latest_verification")
      .select("claim_id, status, overall_verdict, invoice_duplicate_status, amount_date_duplicate_status")
      .in("claim_id", claimIds);

    if (error) {
      return { data: {}, errorMessage: error.message };
    }

    const map: Record<
      string,
      {
        verdict: VerificationBadgeState;
        invoiceDuplicate: DuplicateArmStatus;
        amountDateDuplicate: DuplicateArmStatus;
      }
    > = {};
    for (const row of (data ?? []) as LatestVerificationRow[]) {
      map[row.claim_id] = {
        verdict: deriveBadgeState(row.status, row.overall_verdict),
        invoiceDuplicate: (row.invoice_duplicate_status ?? "unavailable") as DuplicateArmStatus,
        amountDateDuplicate: (row.amount_date_duplicate_status ?? "unavailable") as DuplicateArmStatus,
      };
    }
    return { data: map, errorMessage: null };
  }
```

- [ ] **Step 4: Verification panel — two independent boxes**

In `verification-panel.tsx`, replace the single duplicate block (~333-364) with two independent blocks:

```tsx
{
  summary && summary.invoiceDuplicate.status === "match" ? (
    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-800/50 dark:bg-rose-900/15">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        Possible duplicate — same invoice number as:
      </p>
      <ul className="mt-2 space-y-1">
        {summary.invoiceDuplicate.claimIds.map((id) => (
          <li key={id}>
            <a
              href={`/dashboard/claims/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-primary hover:underline"
            >
              {id}
            </a>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

{
  summary && summary.amountDateDuplicate.status === "match" ? (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/15">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        Possible duplicate — same amount & date as:
      </p>
      <ul className="mt-2 space-y-1">
        {summary.amountDateDuplicate.claimIds.map((id) => (
          <li key={id}>
            <a
              href={`/dashboard/claims/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-primary hover:underline"
            >
              {id}
            </a>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
```

- [ ] **Step 5: Finance approve guard — fire on either arm**

In `page.tsx`, replace the guard block (~766-772, from `if (dup?.duplicateStatus === "invoice_match") {`) with:

```ts
const matchedDuplicateIds = Array.from(
  new Set([
    ...(dup?.invoiceDuplicate.status === "match" ? dup.invoiceDuplicate.claimIds : []),
    ...(dup?.amountDateDuplicate.status === "match" ? dup.amountDateDuplicate.claimIds : []),
  ]),
);
if (matchedDuplicateIds.length > 0) {
  financeApproveConfirmMessage = `AI flagged this as a possible duplicate of: ${matchedDuplicateIds.join(", ")}. Approve and pay anyway?`;
} else if (!dup || dup.status !== "completed") {
  financeApproveConfirmMessage =
    "AI verification is still pending for this claim. Approve without it?";
}
```

- [ ] **Step 6: Bulk table — two independent badges**

In `finance-approvals-bulk-table.tsx`, update the import of `DuplicateStatus` to `DuplicateArmStatus` from `@/modules/claims/verification/duplicate-grading` (replace the existing `DuplicateStatus` import). Replace the row prop (~55) `aiDuplicate?: DuplicateStatus | null;` with:

```ts
  aiInvoiceDuplicate?: DuplicateArmStatus | null;
  aiAmountDateDuplicate?: DuplicateArmStatus | null;
```

Replace the `AI_DUPLICATE_BADGE` map and `AiDuplicateBadge` component (~58-81) with:

```tsx
const AI_DUPLICATE_BADGES: { key: "invoice" | "amountDate"; label: string; className: string }[] = [
  {
    key: "invoice",
    label: "Dup: invoice",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  },
  {
    key: "amountDate",
    label: "Dup: amt+date",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  },
];

function AiDuplicateBadges({
  invoice,
  amountDate,
}: {
  invoice: DuplicateArmStatus | null;
  amountDate: DuplicateArmStatus | null;
}) {
  const active = AI_DUPLICATE_BADGES.filter((b) =>
    b.key === "invoice" ? invoice === "match" : amountDate === "match",
  );
  if (active.length === 0) {
    return null;
  }
  return (
    <>
      {active.map((b) => (
        <span
          key={b.key}
          className={`mt-1 inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${b.className}`}
        >
          {b.label}
        </span>
      ))}
    </>
  );
}
```

Replace the render site (~705) `<AiDuplicateBadge status={claim.aiDuplicate ?? null} />` with:

```tsx
<AiDuplicateBadges
  invoice={claim.aiInvoiceDuplicate ?? null}
  amountDate={claim.aiAmountDateDuplicate ?? null}
/>
```

- [ ] **Step 7: Claims approvals section — thread both arms**

In `claims-approvals-section.tsx`, update the `DuplicateStatus` import to `DuplicateArmStatus` from `@/modules/claims/verification/duplicate-grading`. Replace the empty-data type literal (~206-209) with:

```tsx
            data: {} as Record<
              string,
              {
                verdict: VerificationBadgeState;
                invoiceDuplicate: DuplicateArmStatus;
                amountDateDuplicate: DuplicateArmStatus;
              }
            >,
```

Replace the row mapping line (~289) `aiDuplicate: aiVerdicts[claim.id]?.duplicate ?? null,` with:

```tsx
                  aiInvoiceDuplicate: aiVerdicts[claim.id]?.invoiceDuplicate ?? null,
                  aiAmountDateDuplicate: aiVerdicts[claim.id]?.amountDateDuplicate ?? null,
```

- [ ] **Step 8: Verify typecheck, lint, unit tests**

Run: `npm run typecheck`
Expected: PASS. (If any other file imported the deleted `DuplicateStatus` type or `summary.duplicateStatus`, the compiler points to it — update those references to the new arm fields.)

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/claims/repositories/SupabaseVerificationRepository.ts "src/app/(dashboard)/dashboard/claims/[id]/page.tsx" src/modules/claims/ui/verification-panel.tsx src/modules/claims/ui/finance-approvals-bulk-table.tsx src/modules/claims/ui/claims-approvals-section.tsx
git commit -m "feat: surface both duplicate arms in panel, guard, and list"
```

---

### Task 5: E2E coverage for both-arm match

**Files:**

- Modify: `tests/e2e/claims/fraud-duplicate-detection.spec.ts`

**Interfaces:**

- Consumes: existing e2e helpers/fixtures in that spec file (follow the patterns already present — claim seeding, finance login, verification panel assertions).

- [ ] **Step 1: Read the existing spec to match its fixture/helper conventions**

Open `tests/e2e/claims/fraud-duplicate-detection.spec.ts` and identify how it currently seeds two claims and asserts a duplicate box/badge. Reuse those helpers — do not invent new fixtures.

- [ ] **Step 2: Add the both-arm test**

Add a test that seeds a claim matching one peer on invoice number AND another peer on amount+date, runs verification, then asserts on the claim detail panel that BOTH boxes render — "same invoice number as:" and "same amount & date as:" — and (if the spec exercises the finance queue) that both `Dup: invoice` and `Dup: amt+date` chips appear in the bulk table row. Mirror the assertion style already used in the file (e.g. `expect(page.getByText(...))`).

- [ ] **Step 3: Run the e2e spec**

Run: `npm run test:e2e -- fraud-duplicate-detection`
Expected: PASS (new test included). If the suite requires a running app/DB, follow the project's existing e2e setup (the same prerequisites the file's other tests already assume).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/claims/fraud-duplicate-detection.spec.ts
git commit -m "test(e2e): both duplicate arms surface together"
```

---

## Self-Review

**Spec coverage:**

- SQL helper both-arms (spec §1) → Task 1 Step 1.
- Schema four columns + CHECK + legacy kept (spec §2) → Task 1 Steps 1, 3.
- View append (spec §2) → Task 1 Step 1.
- RPC signature (spec §3) → Task 1 Step 1; TS RPC call → Task 3 Step 2.
- `detectDuplicate` dual-arm incl. invoice-unavailable still computes amount+date (spec §4) → Task 2 + Task 3 Step 1.
- Worker pass-through incl. no-document early exit (spec §4) → Task 3 Steps 3-4.
- Summary types + both summary getters (spec §4) → Task 4 Steps 1-3.
- Detail panel two boxes (spec §5) → Task 4 Step 4.
- Approve guard either-match (spec §5) → Task 4 Step 5.
- List/bulk two badges (spec §5) → Task 4 Steps 6-7.
- Unit tests (spec §Testing) → Task 2. E2E both-arm (spec §Testing) → Task 5. Migration forward+rollback (spec §Testing) → Task 1 Steps 1-2, 4.

**Placeholder scan:** No TBD/TODO. The only prose-only step is Task 5 Step 2 (e2e test body), intentionally deferred to the existing spec's fixture conventions, which must be read first (Step 1) — the assertions and the seeding strategy are described concretely.

**Type consistency:** `DuplicateArm` / `DuplicateArmStatus` / `gradeDuplicateArms` defined in Task 2 and consumed identically in Tasks 3-4. `invoiceDuplicate` / `amountDateDuplicate` summary fields, `invoiceDuplicateStatus` etc. RPC-input fields, and `aiInvoiceDuplicate` / `aiAmountDateDuplicate` row props are spelled consistently across tasks. The old `DuplicateStatus` type and `duplicateStatus`/`duplicateClaimIds`/`aiDuplicate` names are removed everywhere they appeared (Tasks 3-4).
