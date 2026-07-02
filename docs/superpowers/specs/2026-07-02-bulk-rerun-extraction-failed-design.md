# Bulk Re-verify Extraction-Failed Claims — Design

**Date:** 2026-07-02
**Status:** Approved

## Problem

In the finance approvals queue, the AI data comparison feature tags each claim with an
AI check state (verified, mismatch, needs review, pending, extraction failed, etc.).
Claims that end up in **extraction failed** — typically transient AI/parse errors —
currently require opening each claim and clicking "Re-run verification" one by one.
With backlogs of dozens or hundreds of claims, this is tedious.

## Goal

A one-click **"Re-verify all (N)"** button that re-queues every extraction-failed
claim in the finance queue for AI verification in a single action.

**Success criteria:**

- When the "Extraction failed" filter chip is active and its count > 0, a
  "Re-verify all (N)" button is visible in the chips row.
- Clicking it (after confirmation) re-queues every claim whose badge state is
  `extraction_failed` and reports the actual count re-queued.
- Each re-queued claim gets an `AI_VERIFICATION_RERUN` audit log entry, same as the
  single-claim path.
- Only finance approvers can invoke the action.

## Scope decisions (from brainstorming)

- **UI placement:** one-click button tied to the "Extraction failed" chip filter —
  no row selection. (Rejected: checkbox bulk-selection reuse; more clicks/plumbing.)
- **State scope:** `extraction_failed` only. (Rejected: needs_review / any state —
  bulk re-running mismatches rarely changes outcomes and wastes AI tokens.)
- **Mechanism:** new set-based Postgres RPC. (Rejected: server-action loop over the
  existing per-claim `rerun_verification` RPC — N round-trips risks serverless
  timeouts on large backlogs and messy partial-failure reporting.)

## Architecture

The AI work stays asynchronous: "bulk re-verify" is **bulk enqueueing**. The existing
pg_cron worker drains the queue (~5 claims/minute-tick). The RPC selects its targets
from `finance_verification_queue_badge` — the same view that drives the chip counts
and the server-side filter — so the set of claims re-queued always matches the count
the user is looking at.

### 1. Database (new migration)

New function:

```sql
public.bulk_rerun_extraction_failed(p_actor_id uuid) RETURNS integer
```

- `SECURITY DEFINER`, `SET search_path TO ''`, owner `postgres`, EXECUTE revoked from
  `PUBLIC, anon, authenticated` and granted to `service_role` only — identical
  conventions to `rerun_verification` (migration `20260615130000`).
- Body: loop over
  `SELECT claim_id FROM public.finance_verification_queue_badge WHERE badge_state = 'extraction_failed'`;
  for each, call `public.enqueue_verification_run(claim_id, 'manual_rerun')`.
- For each **non-NULL** returned run id, insert an audit row into
  `public.claim_audit_logs (claim_id, actor_id, action_type, remarks)` with
  `action_type = 'AI_VERIFICATION_RERUN'` and remarks
  `'Manual re-run requested (bulk)'` — the "(bulk)" suffix distinguishes it in the
  audit timeline.
- Returns the count of claims actually re-queued (non-NULL enqueues).

Idempotency comes free: `enqueue_verification_run` supersedes any queued/running run
for the claim before inserting a fresh queued row, so double-clicks or overlapping
invocations cannot duplicate work.

### 2. Repository

`SupabaseVerificationRepository.bulkRerunExtractionFailed(input: { actorId: string })`
→ calls the RPC via `getServiceRoleSupabaseClient()`, returns
`{ data: number | null; errorMessage: string | null }`. Mirrors `rerunVerification`.

### 3. Server action

`bulkRerunExtractionFailedAction()` in `src/modules/claims/actions.ts`:

1. `authRepository.getCurrentUser()` — reject unauthenticated.
2. `repository.getFinanceApproverIdsForUser(userId)` — reject non-approvers with
   "Only finance approvers can re-run AI verification." (identical gate to
   `rerunClaimVerificationAction`).
3. Call `verificationRepository.bulkRerunExtractionFailed({ actorId })`.
4. `revalidatePath` on the finance approvals queue route.
5. Return `{ ok: boolean; count?: number; message?: string }`.

### 4. UI

In `src/modules/claims/ui/verification-filter-chips.tsx`:

- When `active === 'extraction_failed'` and `counts.extraction_failed > 0`, render a
  **"Re-verify all (N)"** button at the end of the chips row.
- Click → `window.confirm("Re-queue N extraction-failed claims for AI verification?")`
  → call `bulkRerunExtractionFailedAction()` → toast
  "Re-queued N claims for verification" → `router.refresh()`. The confirm guards
  against accidental AI-token spend; a heavier dialog is not warranted for a
  non-destructive, idempotent action.
- After refresh the re-queued claims derive as `pending` in the badge view, so the
  extraction-failed count visibly drains.

## Error handling & edge cases

| Case                                      | Behavior                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Non-approver invokes action               | `{ ok: false }` with the standard finance-approver message.                            |
| Count changed between page load and click | Harmless — the RPC targets live view state; toast reports the actual number re-queued. |
| Claim has no active expense detail        | `enqueue_verification_run` returns NULL; claim skipped, not counted, no audit row.     |
| Zero matches at execution time            | Returns 0; toast "Re-queued 0 claims for verification".                                |
| Double-click / concurrent invocation      | Prior queued runs superseded; fresh runs queued once; no duplicate worker effort.      |

Out of scope: claims that already moved past finance approval (the badge view only
covers HOD-approved-awaiting-finance claims, matching the chip counts).

## Testing

- **Server action unit tests:** unauthenticated rejected; non-approver rejected;
  approver path calls the repository and returns the count.
- **UI render test:** button hidden when filter inactive or count is 0; visible with
  correct count when the extraction-failed filter is active (following the existing
  verification UI test conventions).

## Files touched

| File                                                                                                           | Change                                          |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `supabase/migrations/20260702<HHMMSS>_bulk_rerun_extraction_failed.sql` (timestamp assigned at implementation) | New RPC + grants                                |
| `src/modules/claims/repositories/SupabaseVerificationRepository.ts`                                            | `bulkRerunExtractionFailed` method              |
| `src/modules/claims/actions.ts`                                                                                | `bulkRerunExtractionFailedAction` server action |
| `src/modules/claims/ui/verification-filter-chips.tsx`                                                          | "Re-verify all (N)" button                      |
| Tests alongside the above                                                                                      | Action gate + chip render tests                 |
