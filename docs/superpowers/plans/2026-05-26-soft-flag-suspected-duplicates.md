# Soft Flag Suspected Duplicates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Finance-only warning banner to the Claim Detail page that flags expense claims sharing the same `bill_no` + `transaction_date` as other active claims (amount-variant duplicates), without touching any existing hard-block logic.

**Architecture:** A new `suspected_duplicate_ids uuid[]` column on `expense_details` is populated atomically by a Postgres RPC (`sync_duplicate_flags`) called from both the submission action and the Finance edit action. The Claim Detail page renders an amber warning banner with links to duplicate claims, visible only when `isFinanceActor` is true and the array is non-empty.

**Tech Stack:** PostgreSQL (Supabase RPC), Next.js 14 Server Actions, TypeScript, Tailwind CSS / lucide-react, Playwright E2E

---

## File Map

| File                                                                    | Change                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260526000000_soft_flag_suspected_duplicates.sql` | **Create** — column, RPC, backfill                                                                                                     |
| `src/modules/claims/repositories/SupabaseClaimRepository.ts`            | **Modify** — `ClaimDetailExpenseRow` type, `getClaimDetailById` select + return type + mapping, new `syncExpenseDuplicateFlags` method |
| `src/modules/claims/actions.ts`                                         | **Modify** — call `syncExpenseDuplicateFlags` in `submitClaimAction` and `updateClaimByFinanceAction`                                  |
| `src/app/(dashboard)/dashboard/claims/[id]/page.tsx`                    | **Modify** — import `AlertTriangle`, render Finance-only banner                                                                        |
| `tests/e2e/claims/fraud-duplicate-detection.spec.ts`                    | **Modify** — add 4 new test cases                                                                                                      |

---

## Task 1: Write the SQL Migration (local file only — do NOT execute)

**Files:**

- Create: `supabase/migrations/20260526000000_soft_flag_suspected_duplicates.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: soft_flag_suspected_duplicates
-- Adds suspected_duplicate_ids array to expense_details, a sync RPC, and a historical backfill.
-- DOES NOT touch or drop uq_expense_details_active_bill or any existing constraint.

BEGIN;

-- 1. New column
ALTER TABLE public.expense_details
  ADD COLUMN IF NOT EXISTS suspected_duplicate_ids uuid[] NOT NULL DEFAULT '{}';

-- 2. RPC: atomically syncs bidirectional duplicate arrays for one claim.
--    Clears stale back-references first (handles Finance edits that change bill_no or date),
--    then writes fresh bidirectional links for the new bill_no + transaction_date.
CREATE OR REPLACE FUNCTION public.sync_duplicate_flags(
  p_claim_id uuid,
  p_bill_no  text,
  p_transaction_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match       RECORD;
  v_matched_ids uuid[] := '{}';
BEGIN
  -- Remove p_claim_id from any claim that currently references it
  -- (needed when Finance edits bill_no/date — old peers must lose the stale ref)
  UPDATE public.expense_details
  SET    suspected_duplicate_ids = array_remove(suspected_duplicate_ids, p_claim_id)
  WHERE  p_claim_id = ANY(suspected_duplicate_ids)
    AND  claim_id   != p_claim_id
    AND  is_active  = true;

  -- Find all active peers with the same bill_no + transaction_date
  FOR v_match IN
    SELECT claim_id
    FROM   public.expense_details
    WHERE  bill_no           = p_bill_no
      AND  transaction_date  = p_transaction_date
      AND  claim_id          != p_claim_id
      AND  is_active         = true
  LOOP
    -- Add p_claim_id into each peer's array (deduplicated)
    UPDATE public.expense_details
    SET    suspected_duplicate_ids =
             array_remove(suspected_duplicate_ids, p_claim_id) || ARRAY[p_claim_id]
    WHERE  claim_id  = v_match.claim_id
      AND  is_active = true;

    v_matched_ids := v_matched_ids || ARRAY[v_match.claim_id];
  END LOOP;

  -- Overwrite this claim's array with all current peer IDs
  UPDATE public.expense_details
  SET    suspected_duplicate_ids = v_matched_ids
  WHERE  claim_id  = p_claim_id
    AND  is_active = true;
END;
$$;

-- Revoke anon execute, consistent with codebase security posture
REVOKE EXECUTE ON FUNCTION public.sync_duplicate_flags(uuid, text, date) FROM anon, public;

-- 3. Historical backfill: link all existing pairs that share bill_no + transaction_date
--    but were submitted with different amounts (or different amounts after Finance edits).
UPDATE public.expense_details AS target
SET    suspected_duplicate_ids = agg.other_ids
FROM (
  SELECT
    a.claim_id,
    array_agg(DISTINCT b.claim_id ORDER BY b.claim_id) AS other_ids
  FROM  public.expense_details a
  JOIN  public.expense_details b
    ON  a.bill_no          = b.bill_no
    AND a.transaction_date = b.transaction_date
    AND a.claim_id         != b.claim_id
    AND b.is_active        = true
  WHERE a.is_active = true
  GROUP BY a.claim_id
) agg
WHERE target.claim_id = agg.claim_id
  AND target.is_active = true;

COMMIT;
```

Save this file. **Do not run it yourself.** After this plan is complete, tell the user:

> "Migration file written to `supabase/migrations/20260526000000_soft_flag_suspected_duplicates.sql`. Run `npx supabase db push` to apply it before testing."

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260526000000_soft_flag_suspected_duplicates.sql
git commit -m "feat(db): add suspected_duplicate_ids column, sync RPC, and historical backfill"
```

---

## Task 2: Update SupabaseClaimRepository — Types and `getClaimDetailById`

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts`

Context: `ClaimDetailExpenseRow` is defined around line 182. `getClaimDetailById` starts around line 1769. The `expense_details(...)` select string is on the single long line at ~1847. The return mapping of the expense object is at ~1911.

- [ ] **Step 1: Add `suspected_duplicate_ids` to `ClaimDetailExpenseRow`**

Find `ClaimDetailExpenseRow` (around line 182). After the line:

```typescript
foreign_total_amount: number | string | null;
```

Add:

```typescript
  suspected_duplicate_ids: string[] | null;
```

The type block will end as:

```typescript
type ClaimDetailExpenseRow = {
  id: string;
  bill_no: string;
  // ... existing fields ...
  foreign_total_amount: number | string | null;
  suspected_duplicate_ids: string[] | null;
  master_expense_categories: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_products: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_locations: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
};
```

- [ ] **Step 2: Add `suspected_duplicate_ids` to the `getClaimDetailById` select string**

In `getClaimDetailById`, find the long `.select(...)` string (~line 1847). Inside the `expense_details(...)` clause, find:

```
foreign_total_amount, master_expense_categories(name), master_products(name), master_locations(name))
```

Replace with:

```
foreign_total_amount, suspected_duplicate_ids, master_expense_categories(name), master_products(name), master_locations(name))
```

- [ ] **Step 3: Add `suspectedDuplicateIds: string[]` to the `getClaimDetailById` return type**

Find the `expense:` block in the return type signature (around line 1799). After:

```typescript
foreignTotalAmount: number | null;
```

Add:

```typescript
        suspectedDuplicateIds: string[];
```

- [ ] **Step 4: Map `suspectedDuplicateIds` in the return value**

Find the return mapping block (around line 1911) where the `expense` object is built. After:

```typescript
              foreignTotalAmount: toNumber(expense.foreign_total_amount),
```

Add:

```typescript
              suspectedDuplicateIds: expense.suspected_duplicate_ids ?? [],
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/claims/repositories/SupabaseClaimRepository.ts
git commit -m "feat(repo): expose suspected_duplicate_ids in getClaimDetailById"
```

---

## Task 3: Add `syncExpenseDuplicateFlags` Repository Method

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseClaimRepository.ts`

- [ ] **Step 1: Add the method**

At the end of the `SupabaseClaimRepository` class (before the closing `}`), add:

```typescript
  async syncExpenseDuplicateFlags(input: {
    claimId: string;
    billNo: string;
    transactionDate: string;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.rpc("sync_duplicate_flags", {
      p_claim_id: input.claimId,
      p_bill_no: input.billNo,
      p_transaction_date: input.transactionDate,
    });

    if (error) {
      return { errorMessage: error.message };
    }

    return { errorMessage: null };
  }
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/claims/repositories/SupabaseClaimRepository.ts
git commit -m "feat(repo): add syncExpenseDuplicateFlags RPC wrapper"
```

---

## Task 4: Wire `syncExpenseDuplicateFlags` into `submitClaimAction`

**Files:**

- Modify: `src/modules/claims/actions.ts`

Context: `submitClaimAction` ends around line 1090–1093 with `return { ok: true, claimId: preparedClaim.id }`. Add the sync call between the catch block and this return statement. The `repository` variable is already in scope. `logger` is already in scope.

- [ ] **Step 1: Add sync call after the try-catch block**

Find the section just before `return { ok: true, claimId: preparedClaim.id }` at the end of `submitClaimAction`. Insert:

```typescript
if (parseResult.data.detailType === "expense") {
  const syncResult = await repository.syncExpenseDuplicateFlags({
    claimId: preparedClaim.id,
    billNo: parseResult.data.expense.billNo,
    transactionDate: parseResult.data.expense.transactionDate,
  });
  if (syncResult.errorMessage) {
    logger.warn("claims.submit.sync_duplicate_flags_failed", {
      claimId: preparedClaim.id,
      errorMessage: syncResult.errorMessage,
    });
  }
}

return {
  ok: true,
  claimId: preparedClaim.id,
};
```

(Remove the existing bare `return { ok: true, claimId: preparedClaim.id };` and replace with the block above.)

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/claims/actions.ts
git commit -m "feat(actions): sync duplicate flags on expense claim submission"
```

---

## Task 5: Wire `syncExpenseDuplicateFlags` into `updateClaimByFinanceAction`

**Files:**

- Modify: `src/modules/claims/actions.ts`

Context: `updateClaimByFinanceAction` ends around line 1529–1537. After the three `revalidatePath` calls and before `return { ok: true, message: "Claim details updated." }`, insert the sync call. `parseResult.data` is a discriminated union on `detailType` — narrowing via `=== "expense"` gives access to `parseResult.data.billNo` and `parseResult.data.transactionDate`.

- [ ] **Step 1: Add sync call after revalidation in `updateClaimByFinanceAction`**

Find the end of `updateClaimByFinanceAction`:

```typescript
revalidatePath(ROUTES.claims.myClaims);
revalidatePath(ROUTES.claims.dashboardList);
revalidatePath(`${ROUTES.claims.dashboardList}/${claimIdParse.data.claimId}`, "page");

return {
  ok: true,
  message: "Claim details updated.",
};
```

Replace with:

```typescript
revalidatePath(ROUTES.claims.myClaims);
revalidatePath(ROUTES.claims.dashboardList);
revalidatePath(`${ROUTES.claims.dashboardList}/${claimIdParse.data.claimId}`, "page");

if (parseResult.data.detailType === "expense") {
  const syncResult = await repository.syncExpenseDuplicateFlags({
    claimId: claimIdParse.data.claimId,
    billNo: parseResult.data.billNo,
    transactionDate: parseResult.data.transactionDate,
  });
  if (syncResult.errorMessage) {
    logger.warn("claims.finance_edit.sync_duplicate_flags_failed", {
      claimId: claimIdParse.data.claimId,
      errorMessage: syncResult.errorMessage,
    });
  }
}

return {
  ok: true,
  message: "Claim details updated.",
};
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/claims/actions.ts
git commit -m "feat(actions): re-sync duplicate flags on Finance expense edit"
```

---

## Task 6: Build the Finance-Only Suspected Duplicate Banner

**Files:**

- Modify: `src/app/(dashboard)/dashboard/claims/[id]/page.tsx`

Context: `isFinanceActor` is computed around line 602–603. The render section of `ClaimDetailCore` starts around line 778. The rejection-reason banner is rendered around line 805–815. The hero section starts around line 817. We add our banner between these two.

`AlertTriangle` is not yet imported — add it to the existing lucide-react import line. `ROUTES.claims.detail` is available (used elsewhere in the file). `Link` is imported from `"next/link"`.

- [ ] **Step 1: Add `AlertTriangle` to the lucide-react import**

Find:

```typescript
import { ExternalLink, X } from "lucide-react";
```

Replace with:

```typescript
import { AlertTriangle, ExternalLink, X } from "lucide-react";
```

- [ ] **Step 2: Add the banner between the rejection-reason block and the hero section**

Find the existing rejection reason banner block (inside the `<section className="relative z-10 ...">` column):

```tsx
{
  DB_REJECTED_STATUSES.some((status) => status === claim.status) && claim.rejectionReason ? (
    <section className="border-l-2 border-rose-500/70 bg-rose-50/55 px-4 py-3 dark:border-rose-500/60 dark:bg-rose-900/10">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">
        Rejection Reason
      </h2>
      <p className="mt-1 text-sm text-rose-700 dark:text-rose-200">{claim.rejectionReason}</p>
    </section>
  ) : null;
}
```

After this block (still inside the `<section className="relative z-10 ...">` column), insert:

```tsx
{
  isFinanceActor && (claim.expense?.suspectedDuplicateIds?.length ?? 0) > 0 ? (
    <section className="border-l-2 border-amber-500/70 bg-amber-50/55 px-4 py-3 dark:border-amber-500/60 dark:bg-amber-900/10">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
            Suspected Duplicate
          </h2>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-200">
            This bill number and date match {claim.expense!.suspectedDuplicateIds.length} other
            claim
            {claim.expense!.suspectedDuplicateIds.length !== 1 ? "s" : ""}.
          </p>
          <ul className="mt-2 space-y-1">
            {claim.expense!.suspectedDuplicateIds.map((dupId) => (
              <li key={dupId}>
                <Link
                  href={ROUTES.claims.detail(dupId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-amber-700 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                >
                  View claim {dupId}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  ) : null;
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/dashboard/claims/[id]/page.tsx
git commit -m "feat(ui): add Finance-only suspected duplicate banner to Claim Detail page"
```

---

## Task 7: Write Playwright E2E Tests

**Files:**

- Modify: `tests/e2e/claims/fraud-duplicate-detection.spec.ts`

Context: The existing file already imports `getAdminSupabaseClient`, `resolveLatestActiveExpenseClaimByBillNo`, `resolveRuntimeClaimData`, `setClaimToFinancePending`, `selectOptionByLabel`, `submitExpenseClaim`, and `withActorPage` from `../support/claims-e2e-runtime`. `RUN_TAG` is already defined. Add the new `describe` block at the end of the file (after the closing `}` of the existing describe block).

The `submitExpenseClaim` helper fills `basicAmount` = `input.amount`. When no GST is entered, `totalAmount = basicAmount`. So amount=1000 and amount=999 differ in `totalAmount` → the existing hard-block (`existsExpenseByCompositeKey` checks `totalAmount`) is bypassed for 999, but the soft-flag fires because `bill_no + transaction_date` match.

- [ ] **Step 1: Append the new describe block to the test file**

Add at the end of `tests/e2e/claims/fraud-duplicate-detection.spec.ts`:

```typescript
test.describe("Soft Flag - Suspected Duplicate Detection", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  // Shared bill identifier for this describe block
  const SOFT_FLAG_BILL = `BILL-SOFTFLAG-${process.env.E2E_RUN_TAG ?? `SF-${Date.now()}`}`;
  const SOFT_FLAG_DATE = "2026-05-15";
  let claimAId: string;
  let claimBId: string;

  test("hard-block regression: exact duplicate (same amount) is still blocked", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();
    const billNo = `BILL-HARDBLOCK-${process.env.E2E_RUN_TAG ?? Date.now()}`;
    const transactionDate = "2026-05-14";
    const amount = 500;

    // Submit claim A
    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo,
        amount,
        employeeId: `EMP-HB-A-${Date.now()}`,
        purpose: "Hard-block regression: claim A",
        transactionDate,
      });
    });

    const client = getAdminSupabaseClient();

    // Attempt exact duplicate (same bill, date, amount) — must NOT produce a second row
    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await page.goto("/claims/new", { waitUntil: "domcontentloaded" });

      await selectOptionByLabel(page, /Department/i, runtime.submitterDepartmentName);
      await selectOptionByLabel(page, /Payment Mode/i, runtime.reimbursementPaymentModeName);
      await selectOptionByLabel(page, /Expense Category/i, runtime.expenseCategoryName);

      await page.getByRole("textbox", { name: /^Employee ID \*/i }).fill(`EMP-HB-B-${Date.now()}`);
      await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(billNo);
      await page
        .getByRole("textbox", { name: /^Purpose/i })
        .fill("Hard-block regression: claim B (exact duplicate)");
      await page.getByRole("spinbutton", { name: /^Basic Amount \*/i }).fill(String(amount));
      await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(transactionDate);
      await page.locator("#receiptFile").setInputFiles("tests/fixtures/dummy-receipt.pdf");

      await page.getByRole("button", { name: /submit claim/i }).click();
      // Should stay on the new-claim page (not redirect away)
      await expect(page).toHaveURL(/\/claims\/new(?:\?|$)/, { timeout: 15000 });
    });

    // DB: still only 1 active row for that fingerprint
    const { count, error } = await client
      .from("expense_details")
      .select("id", { count: "exact", head: true })
      .eq("bill_no", billNo)
      .eq("transaction_date", transactionDate)
      .eq("total_amount", amount)
      .eq("is_active", true);

    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  test("soft flag: amount-variant duplicate succeeds and both claims reference each other", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();

    // Claim A: amount 1000
    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: SOFT_FLAG_BILL,
        amount: 1000,
        employeeId: `EMP-SFA-${Date.now()}`,
        purpose: "Soft-flag claim A",
        transactionDate: SOFT_FLAG_DATE,
      });
    });

    const claimA = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: SOFT_FLAG_BILL,
    });
    claimAId = claimA.claimId;

    // Claim B: same bill + date, different amount (999) — bypasses hard-block
    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: SOFT_FLAG_BILL,
        amount: 999,
        employeeId: `EMP-SFB-${Date.now()}`,
        purpose: "Soft-flag claim B (amount-variant)",
        transactionDate: SOFT_FLAG_DATE,
      });
    });

    const claimB = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: SOFT_FLAG_BILL,
      excludeClaimId: claimAId,
    });
    claimBId = claimB.claimId;

    const client = getAdminSupabaseClient();

    // Claim A's expense_details row must contain claimBId in suspected_duplicate_ids
    await expect
      .poll(
        async () => {
          const { data, error } = await client
            .from("expense_details")
            .select("suspected_duplicate_ids")
            .eq("claim_id", claimAId)
            .eq("is_active", true)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data?.suspected_duplicate_ids as string[] | null) ?? [];
        },
        { timeout: 30000, message: "waiting for claimA to reference claimB" },
      )
      .toContain(claimBId);

    // Claim B's expense_details row must contain claimAId in suspected_duplicate_ids
    await expect
      .poll(
        async () => {
          const { data, error } = await client
            .from("expense_details")
            .select("suspected_duplicate_ids")
            .eq("claim_id", claimBId)
            .eq("is_active", true)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data?.suspected_duplicate_ids as string[] | null) ?? [];
        },
        { timeout: 30000, message: "waiting for claimB to reference claimA" },
      )
      .toContain(claimAId);
  });

  test("banner is NOT visible to the submitter on the Claim Detail page", async ({ browser }) => {
    const runtime = await resolveRuntimeClaimData();

    // claimBId is set by the previous serial test
    expect(claimBId).toBeTruthy();

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await page.goto(`/dashboard/claims/${claimBId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(claimBId, { exact: true })).toBeVisible({ timeout: 20000 });

      await expect(page.getByText(/suspected duplicate/i)).toHaveCount(0, { timeout: 5000 });
    });
  });

  test("banner IS visible to Finance with correct count and target=_blank links", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();

    // claimBId and claimAId are set by the earlier serial tests
    expect(claimBId).toBeTruthy();
    expect(claimAId).toBeTruthy();

    await withActorPage(browser, runtime.financeEmail, async (page) => {
      await page.goto(`/dashboard/claims/${claimBId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(claimBId, { exact: true })).toBeVisible({ timeout: 20000 });

      // Banner heading must be visible
      await expect(page.getByText(/suspected duplicate/i).first()).toBeVisible({ timeout: 10000 });

      // Count text — 1 other claim (claimA)
      await expect(page.getByText(/match 1 other claim/i)).toBeVisible({ timeout: 5000 });

      // Link to claimA must exist and have target=_blank
      const dupLink = page.getByRole("link", { name: new RegExp(escapeRegExp(claimAId)) });
      await expect(dupLink).toBeVisible({ timeout: 5000 });
      await expect(dupLink).toHaveAttribute("target", "_blank");
    });
  });
});
```

- [ ] **Step 2: Verify the test file has no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/claims/fraud-duplicate-detection.spec.ts
git commit -m "test(e2e): add soft-flag duplicate detection tests"
```

---

## Task 8: Final Checkpoint — Instruct User to Apply Migration and Run Tests

- [ ] **Step 1: Remind user to apply the migration**

Tell the user:

> "All code changes are committed. **Before running the E2E tests**, apply the migration:
>
> ```
> npx supabase db push
> ```
>
> This adds the `suspected_duplicate_ids` column and the `sync_duplicate_flags` RPC to your database."

- [ ] **Step 2: Verify TypeScript build is clean across the whole project**

```bash
npx tsc --noEmit
```

Expected: exit code 0, no errors.

- [ ] **Step 3: Run the new E2E tests**

```bash
npx playwright test tests/e2e/claims/fraud-duplicate-detection.spec.ts --project=chromium
```

Expected: all tests pass. If any test fails, investigate the specific failure before declaring the plan complete.

- [ ] **Step 4: Final commit (if any fixes were needed)**

If any TypeScript or test fixes were required, commit them:

```bash
git add -A
git commit -m "fix: address post-migration review feedback for soft-flag feature"
```

---

## Self-Review Checklist

| Spec requirement                                                 | Covered in task                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| New `suspected_duplicate_ids uuid[]` column on `expense_details` | Task 1                                                                               |
| Atomic bidirectional array sync via Postgres RPC                 | Task 1 (RPC), Task 3 (repo method)                                                   |
| Stale-ref cleanup on Finance edit (self-healing)                 | Task 1 (RPC step 1), Task 5                                                          |
| Historical backfill for existing claims                          | Task 1 (backfill UPDATE)                                                             |
| Existing hard-block NOT modified                                 | Plan never touches `uq_expense_details_active_bill` or `existsExpenseByCompositeKey` |
| `syncExpenseDuplicateFlags` called on submission                 | Task 4                                                                               |
| `syncExpenseDuplicateFlags` called on Finance expense edit       | Task 5                                                                               |
| Non-fatal sync (log warn, never block)                           | Tasks 4 and 5                                                                        |
| Finance-only banner with `AlertTriangle`                         | Task 6                                                                               |
| Banner links use `target="_blank"`                               | Task 6                                                                               |
| Banner references `ROUTES.claims.detail(id)`                     | Task 6                                                                               |
| Hard-block regression test                                       | Task 7                                                                               |
| Soft-flag DB assertion test                                      | Task 7                                                                               |
| Banner hidden from submitter test                                | Task 7                                                                               |
| Banner visible to Finance with count + links test                | Task 7                                                                               |
| Migration file is local only (no execution)                      | Task 1, Task 8                                                                       |
