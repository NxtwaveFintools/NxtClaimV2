# Bulk Re-verify Extraction-Failed Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-click "Re-verify all (N)" button on the finance queue's "Extraction failed" AI-check chip that re-queues every extraction-failed claim for AI verification in a single action.

**Architecture:** The AI work stays asynchronous — "bulk re-verify" is bulk _enqueueing_; the existing pg_cron worker drains the queue. A new set-based Postgres RPC (`bulk_rerun_extraction_failed`) selects targets from `finance_verification_queue_badge` (the same view that drives the chip counts, so the set re-queued always matches what the user sees), enqueues each via the existing `enqueue_verification_run`, and writes per-claim audit logs. A finance-approver-gated server action calls it via the service-role client; the chips component gains the button.

**Tech Stack:** Next.js App Router server actions, Supabase (plpgsql RPC, service-role client), Jest + Testing Library, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-07-02-bulk-rerun-extraction-failed-design.md`

## Global Constraints

- New RPC follows `rerun_verification` conventions exactly: `SECURITY DEFINER`, `SET search_path TO ''`, `OWNER TO postgres`, EXECUTE revoked from `PUBLIC, anon, authenticated`, granted to `service_role` only (see `supabase/migrations/20260615130000_ai_claim_verification_ledger.sql:502-523`).
- Non-approver rejection message must be exactly: `Only finance approvers can re-run AI verification.` (same string as `rerunClaimVerificationAction`).
- Audit remarks must be exactly: `Manual re-run requested (bulk)` with `action_type = 'AI_VERIFICATION_RERUN'`.
- `tests/unit/claims/actions.test.ts` has ~9 pre-existing failures unrelated to this work (baseline last confirmed 2026-06-19). Re-baseline before starting (`npx jest tests/unit/claims/actions.test.ts --runInBand`); your new tests must pass and you must not increase the failure count. Do not fix the pre-existing failures.
- **Migration application caution:** `.mcp.json` was repointed to the PROD Supabase project (`hhqgxbltlkymfpvihlzx`) on 2026-06-19. Before applying the migration via the Supabase MCP, check which project the MCP is bound to. Apply to the DEV project (`pltbwxddxtsavygijcnl`) only. If the MCP is still bound to prod, STOP and ask the user rather than applying.
- Windows/PowerShell environment: chain commands with `;`, not `&&`.

---

### Task 1: Migration — `bulk_rerun_extraction_failed` RPC + generated-types entry

**Files:**

- Create: `supabase/migrations/20260702120000_bulk_rerun_extraction_failed.sql`
- Modify: `src/types/database.ts` (Functions section, alphabetical — near line ~2035 where `rerun_verification` lives)

**Interfaces:**

- Consumes: `public.finance_verification_queue_badge` view (`claim_id text, badge_state text`); `public.enqueue_verification_run(p_claim_id text, p_trigger text) RETURNS uuid` (returns NULL when the claim has no active expense detail; supersedes any queued/running run before inserting — this is what makes the bulk RPC idempotent); `public.claim_audit_logs (claim_id, actor_id, action_type, remarks)`.
- Produces: `public.bulk_rerun_extraction_failed(p_actor_id uuid) RETURNS integer` — count of claims actually re-queued. Task 2's repository method calls this via `client.rpc("bulk_rerun_extraction_failed", { p_actor_id })`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260702120000_bulk_rerun_extraction_failed.sql`:

```sql
-- Migration: bulk_rerun_extraction_failed
-- One-click bulk re-queue of every extraction-failed claim in the finance queue.
-- Targets come from finance_verification_queue_badge — the same view that drives
-- the AI-check chip counts — so the set re-queued always matches the count the
-- finance approver is looking at. Enqueueing goes through the existing
-- enqueue_verification_run, which supersedes queued/running runs first, making
-- this idempotent under double-clicks.

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_rerun_extraction_failed(
  p_actor_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_claim_id text;
  v_run_id   uuid;
  v_count    integer := 0;
BEGIN
  FOR v_claim_id IN
    SELECT claim_id
    FROM public.finance_verification_queue_badge
    WHERE badge_state = 'extraction_failed'
  LOOP
    v_run_id := public.enqueue_verification_run(v_claim_id, 'manual_rerun');
    IF v_run_id IS NOT NULL THEN
      INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, remarks)
      VALUES (v_claim_id, p_actor_id, 'AI_VERIFICATION_RERUN', 'Manual re-run requested (bulk)');
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END
$$;

ALTER FUNCTION public.bulk_rerun_extraction_failed(uuid) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.bulk_rerun_extraction_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_rerun_extraction_failed(uuid) TO service_role;

COMMIT;
```

- [ ] **Step 2: Add the RPC to the generated types**

In `src/types/database.ts`, find the `Functions` section (search for `rerun_verification: {`). Insert this entry in alphabetical position (immediately after `build_verification_snapshot`; match the file's existing formatting):

```ts
bulk_rerun_extraction_failed: {
  Args: {
    p_actor_id: string;
  }
  Returns: number;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 4: Apply the migration to the DEV Supabase project**

First verify the Supabase MCP target project (per Global Constraints — must be dev `pltbwxddxtsavygijcnl`, NOT prod). Then apply via the MCP `apply_migration` tool with name `bulk_rerun_extraction_failed` and the SQL above.

- [ ] **Step 5: Verify function exists with correct grants (read-only smoke)**

Run via MCP `execute_sql`:

```sql
SELECT
  p.proname,
  p.prosecdef AS is_security_definer,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_can_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'bulk_rerun_extraction_failed';
```

Expected: 1 row — `is_security_definer = true`, `service_role_can_exec = true`, `authenticated_can_exec = false`.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20260702120000_bulk_rerun_extraction_failed.sql src/types/database.ts
git commit -m "feat: bulk_rerun_extraction_failed RPC for one-click bulk AI re-verification"
```

---

### Task 2: Repository method + server action (TDD)

**Files:**

- Modify: `src/modules/claims/repositories/SupabaseVerificationRepository.ts` (add method directly after `rerunVerification`, which ends at line ~393)
- Modify: `src/modules/claims/actions.ts` (add action directly after `rerunClaimVerificationAction`, which ends at line ~2196)
- Test: `tests/unit/claims/actions.test.ts` (append a new `describe` block; add mocks near the existing `const mock… = jest.fn()` declarations at the top)

**Interfaces:**

- Consumes: `bulk_rerun_extraction_failed` RPC (Task 1); existing module-level singletons in `actions.ts` — `authRepository.getCurrentUser()` → `{ user, errorMessage }`, `repository.getFinanceApproverIdsForUser(userId)` → `{ data: string[], errorMessage: string | null }`, `verificationRepository`; `getServiceRoleSupabaseClient` from `@/core/infra/supabase/server-client`; `ROUTES.claims.myClaims` (`"/dashboard/my-claims"`) from `@/core/config/route-registry` (already imported in `actions.ts`).
- Produces:
  - `SupabaseVerificationRepository.bulkRerunExtractionFailed(input: { actorId: string }): Promise<{ data: number | null; errorMessage: string | null }>`
  - `bulkRerunExtractionFailedAction(): Promise<{ ok: boolean; count?: number; message?: string }>` — Task 3's UI imports this from `@/modules/claims/actions`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/claims/actions.test.ts`, add these mock declarations alongside the existing `const mock… = jest.fn()` block at the top of the file:

```ts
const mockBulkRerunExtractionFailed = jest.fn();
const mockEnqueueVerificationRun = jest.fn();
const mockRerunVerification = jest.fn();
const mockOverrideVerification = jest.fn();
```

Then add this module mock alongside the existing `jest.mock("@/modules/claims/repositories/SupabaseClaimRepository", …)` call (the file does not currently mock the verification repository — the real class was harmless because `enqueueVerificationBestEffort` swallows errors; this mock keeps that behavior deterministic):

```ts
jest.mock("@/modules/claims/repositories/SupabaseVerificationRepository", () => ({
  SupabaseVerificationRepository: jest.fn().mockImplementation(() => ({
    enqueueVerificationRun: mockEnqueueVerificationRun,
    rerunVerification: mockRerunVerification,
    overrideVerification: mockOverrideVerification,
    bulkRerunExtractionFailed: mockBulkRerunExtractionFailed,
  })),
}));
```

Then append this `describe` block at the end of the file (the file's convention is `await import("@/modules/claims/actions")` inside each test):

```ts
describe("bulkRerunExtractionFailedAction", () => {
  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue({
      user: { id: "user-1", email: "fin@nxtwave.co.in" },
      errorMessage: null,
    });
    mockGetFinanceApproverIdsForUser.mockResolvedValue({
      data: ["approver-1"],
      errorMessage: null,
    });
    mockBulkRerunExtractionFailed.mockResolvedValue({ data: 7, errorMessage: null });
  });

  test("rejects unauthenticated sessions", async () => {
    mockGetCurrentUser.mockResolvedValue({ user: null, errorMessage: "No session." });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result.ok).toBe(false);
    expect(mockBulkRerunExtractionFailed).not.toHaveBeenCalled();
  });

  test("rejects non finance approvers", async () => {
    mockGetFinanceApproverIdsForUser.mockResolvedValue({ data: [], errorMessage: null });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result).toEqual({
      ok: false,
      message: "Only finance approvers can re-run AI verification.",
    });
    expect(mockBulkRerunExtractionFailed).not.toHaveBeenCalled();
  });

  test("re-queues via the repository and returns the count for approvers", async () => {
    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(mockBulkRerunExtractionFailed).toHaveBeenCalledWith({ actorId: "user-1" });
    expect(result).toEqual({ ok: true, count: 7 });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims", "page");
  });

  test("surfaces repository errors", async () => {
    mockBulkRerunExtractionFailed.mockResolvedValue({
      data: null,
      errorMessage: "rpc exploded",
    });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result).toEqual({ ok: false, message: "rpc exploded" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  test("returns count 0 when nothing matched", async () => {
    mockBulkRerunExtractionFailed.mockResolvedValue({ data: 0, errorMessage: null });

    const { bulkRerunExtractionFailedAction } = await import("@/modules/claims/actions");
    const result = await bulkRerunExtractionFailedAction();

    expect(result).toEqual({ ok: true, count: 0 });
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest tests/unit/claims/actions.test.ts -t "bulkRerunExtractionFailedAction" --runInBand`
Expected: FAIL — `bulkRerunExtractionFailedAction` is not exported.

Also re-run the whole file to confirm the new module mock didn't break existing tests beyond the pre-existing baseline:
Run: `npx jest tests/unit/claims/actions.test.ts --runInBand`
Expected: same failure count as your re-baseline run plus the new `bulkRerunExtractionFailedAction` failures only.

- [ ] **Step 3: Implement the repository method**

In `src/modules/claims/repositories/SupabaseVerificationRepository.ts`, add directly after the `rerunVerification` method (inside the class, before its closing brace):

```ts
  async bulkRerunExtractionFailed(input: {
    actorId: string;
  }): Promise<{ data: number | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("bulk_rerun_extraction_failed", {
      p_actor_id: input.actorId,
    });
    if (error) {
      return { data: null, errorMessage: error.message };
    }
    return { data: (data as number | null) ?? null, errorMessage: null };
  }
```

- [ ] **Step 4: Implement the server action**

In `src/modules/claims/actions.ts`, add directly after `rerunClaimVerificationAction` (ends ~line 2196):

```ts
export async function bulkRerunExtractionFailedAction(): Promise<{
  ok: boolean;
  count?: number;
  message?: string;
}> {
  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return { ok: false, message: currentUserResult.errorMessage ?? "Unauthorized session." };
  }

  const approverIds = await repository.getFinanceApproverIdsForUser(currentUserResult.user.id);
  if (approverIds.errorMessage || approverIds.data.length === 0) {
    return { ok: false, message: "Only finance approvers can re-run AI verification." };
  }

  const result = await verificationRepository.bulkRerunExtractionFailed({
    actorId: currentUserResult.user.id,
  });
  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidatePath(ROUTES.claims.myClaims, "page");
  return { ok: true, count: result.data ?? 0 };
}
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `npx jest tests/unit/claims/actions.test.ts -t "bulkRerunExtractionFailedAction" --runInBand`
Expected: 5 passing.

Run: `npx jest tests/unit/claims/actions.test.ts --runInBand`
Expected: failure count back to the pre-existing baseline (new tests green, no new failures).

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/claims/repositories/SupabaseVerificationRepository.ts src/modules/claims/actions.ts tests/unit/claims/actions.test.ts
git commit -m "feat: bulkRerunExtractionFailedAction server action + repository method"
```

---

### Task 3: "Re-verify all (N)" button on the extraction-failed chip (TDD)

**Files:**

- Modify: `src/modules/claims/ui/verification-filter-chips.tsx`
- Test: Create `tests/unit/claims/verification-filter-chips.test.tsx`

**Interfaces:**

- Consumes: `bulkRerunExtractionFailedAction(): Promise<{ ok: boolean; count?: number; message?: string }>` from `@/modules/claims/actions` (Task 2); `VerificationBadgeState` type (union includes `"mismatch" | "statement_mismatch" | "needs_review" | "verified" | "pending" | "extraction_failed" | "no_document"`); `toast` from `sonner`; the component already receives `counts: Record<VerificationBadgeState, number>` and reads the active filter from the `ai_verdict` search param.
- Produces: UI behavior only — no new exports beyond the existing `VerificationFilterChips`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/claims/verification-filter-chips.test.tsx` (mock style follows `tests/unit/claims/verification-panel.test.tsx`; `useSearchParams` needs a real `URLSearchParams` because the component calls `.get("ai_verdict")` and `.toString()`):

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VerificationFilterChips } from "@/modules/claims/ui/verification-filter-chips";
import { bulkRerunExtractionFailedAction } from "@/modules/claims/actions";
import { toast } from "sonner";
import type { VerificationBadgeState } from "@/modules/claims/repositories/SupabaseVerificationRepository";

let mockSearch = "";
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: mockRefresh }),
  usePathname: () => "/dashboard/my-claims",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/modules/claims/actions", () => ({
  bulkRerunExtractionFailedAction: jest.fn(),
}));

const mockAction = bulkRerunExtractionFailedAction as jest.Mock;

function makeCounts(
  overrides?: Partial<Record<VerificationBadgeState, number>>,
): Record<VerificationBadgeState, number> {
  return {
    mismatch: 0,
    statement_mismatch: 0,
    needs_review: 0,
    verified: 0,
    pending: 0,
    extraction_failed: 0,
    no_document: 0,
    ...overrides,
  };
}

describe("VerificationFilterChips — bulk re-verify button", () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    mockSearch = "";
  });

  test("hides the button when the extraction_failed filter is not active", () => {
    mockSearch = "";
    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    expect(screen.queryByText(/Re-verify all/)).not.toBeInTheDocument();
  });

  test("hides the button when the filter is active but the count is 0", () => {
    mockSearch = "ai_verdict=extraction_failed";
    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 0 })} />);
    expect(screen.queryByText(/Re-verify all/)).not.toBeInTheDocument();
  });

  test("shows the button with the count when the filter is active", () => {
    mockSearch = "ai_verdict=extraction_failed";
    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    expect(screen.getByText("Re-verify all (5)")).toBeInTheDocument();
  });

  test("confirms, calls the action, toasts the actual count, and refreshes", async () => {
    mockSearch = "ai_verdict=extraction_failed";
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockAction.mockResolvedValue({ ok: true, count: 4 });

    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    fireEvent.click(screen.getByText("Re-verify all (5)"));

    await waitFor(() => {
      expect(mockAction).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith("Re-queued 4 claims for verification");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  test("does not call the action when the confirm is dismissed", () => {
    mockSearch = "ai_verdict=extraction_failed";
    jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    fireEvent.click(screen.getByText("Re-verify all (5)"));

    expect(mockAction).not.toHaveBeenCalled();
  });

  test("shows an error toast when the action fails", async () => {
    mockSearch = "ai_verdict=extraction_failed";
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockAction.mockResolvedValue({
      ok: false,
      message: "Only finance approvers can re-run AI verification.",
    });

    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    fireEvent.click(screen.getByText("Re-verify all (5)"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Only finance approvers can re-run AI verification.",
      );
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/claims/verification-filter-chips.test.tsx --runInBand`
Expected: FAIL — the three "hides/shows button" tests fail because the button doesn't exist yet (the two "hides" tests may pass trivially; the "shows"/click tests must fail).

- [ ] **Step 3: Implement the button**

In `src/modules/claims/ui/verification-filter-chips.tsx`:

Replace the current import block additions — add `useState`, `toast`, and the action:

```tsx
"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { bulkRerunExtractionFailedAction } from "@/modules/claims/actions";
import type { VerificationBadgeState } from "@/modules/claims/repositories/SupabaseVerificationRepository";
```

Inside the component, after the `active` const, add:

```tsx
const [isRerunning, setIsRerunning] = useState(false);
const extractionFailedCount = counts.extraction_failed ?? 0;
const showBulkRerun = active === "extraction_failed" && extractionFailedCount > 0;

const submitBulkRerun = async () => {
  if (isRerunning) return;
  const confirmed = window.confirm(
    `Re-queue ${extractionFailedCount} extraction-failed claim${
      extractionFailedCount === 1 ? "" : "s"
    } for AI verification?`,
  );
  if (!confirmed) return;
  setIsRerunning(true);
  try {
    const result = await bulkRerunExtractionFailedAction();
    if (result.ok) {
      toast.success(`Re-queued ${result.count ?? 0} claims for verification`);
      router.refresh();
    } else {
      toast.error(result.message ?? "Bulk re-verification failed.");
    }
  } finally {
    setIsRerunning(false);
  }
};
```

In the JSX, between the chips `.map()` and the existing "Clear" button, add:

```tsx
{
  showBulkRerun ? (
    <button
      type="button"
      onClick={submitBulkRerun}
      disabled={isRerunning}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-700 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isRerunning ? "Re-queuing..." : `Re-verify all (${extractionFailedCount})`}
    </button>
  ) : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/claims/verification-filter-chips.test.tsx --runInBand`
Expected: 6 passing.

- [ ] **Step 5: Full verification sweep**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm run lint`
Expected: exit 0 (no new warnings in touched files).

Run: `npm run test:unit`
Expected: only the pre-existing `actions.test.ts` baseline failures; everything new passes.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/claims/ui/verification-filter-chips.tsx tests/unit/claims/verification-filter-chips.test.tsx
git commit -m "feat: one-click bulk re-verify button on extraction-failed chip"
```
