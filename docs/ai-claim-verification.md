# AI Claim Verification (Finance-Stage Verification Ledger)

## What it does

After a claim is HOD-approved (L1) and lands in the finance queue, the finance team used
to manually open each claim, read the uploaded receipt, and check that the submitted
fields (amount, date, bill no, GST, vendor) actually match the document. This feature
automates the **comparing**; finance keeps the **deciding**.

For every HOD-approved **expense** claim, an AI worker:

1. Re-extracts the stored receipt server-side (re-using the same Gemini pipeline that
   powers submission-time autofill).
2. Compares each extracted field against what the user submitted, using deterministic
   rules with tolerances (no ML scoring — every verdict traces to a named rule).
3. Writes a per-field evidence record and an overall verdict.
4. Surfaces an **AI Check badge** in the finance queue and a **verification panel** on the
   claim detail page (field-by-field table, evidence line, re-run / mark-verified actions).

The AI never changes claim status. It produces badges and evidence only. Auto-approval is
a deliberately deferred phase 2.

**v1 scope:** Lane 1 only — receipt vs submitted fields. Bank-statement-vs-invoice matching
(Lane 2) is deferred to v1.1; the data model and worker already accommodate it.

Authoritative design doc (problem framing, alternatives, decisions, review trail):
`~/.gstack/projects/NxtWaveTools-NxtClaimV2/Nxtwave-development-design-20260612-180032.md`.

---

## How it works (data flow)

The system has **two halves that run independently**:

- **Part 1 — "Add work to the list":** something happens to a claim (HOD approves it,
  finance edits it, someone clicks Re-run), and we write a row saying "this claim needs
  checking." That's all this half does. It never calls the AI. It's fast and never blocks
  the user.
- **Part 2 — "Do the work":** a clock ticks every minute, picks up the rows waiting on the
  list, and actually downloads the receipt, runs the AI, compares the fields, and saves the
  result.

Think of it like a restaurant: Part 1 is the waiter writing tickets and pinning them to the
rail. Part 2 is the kitchen pulling tickets off the rail and cooking. They don't wait on
each other — the waiter keeps taking orders even if the kitchen is busy.

The "list" is one database table: **`claim_verification_runs`**. Every row is one check for
one claim, and it moves through these states:

```
queued ──▶ running ──▶ completed   (verdict saved: verified / mismatch / needs_review / ...)
                  └──▶ failed       (download or AI failed; retried with backoff, then given up)
```

---

### Part 1 — How a claim gets onto the list

Three different events can add a claim to the list. All of them call the **same** database
function, `enqueue_verification_run(...)`, so there's only one way work ever gets created:

```
EVENT                                          WHAT IT MEANS
─────────────────────────────────────────────────────────────────────────────
(a) HOD approves a claim (L1)         the claim just entered the finance queue
        │                             → it needs a first check
        │
(b) Finance edits a claim's fields    the numbers changed
        │                             → the old check is stale, check again
        │
(c) Finance clicks "Re-run"           a human asked for a fresh check
        │
        ▼
   enqueue_verification_run(claim_id, trigger)
        │
        ├─ takes a SNAPSHOT of the fields it will compare (amount, date, bill no, GST, ...)
        │  so the check is always judged against the exact values at enqueue time
        │
        ├─ marks any older still-in-progress run for this claim as "superseded"
        │  (so a slow old check can't overwrite a newer one — see "superseded" below)
        │
        └─ INSERTs a new row into claim_verification_runs with status = 'queued'
```

Events (a) and (b) are **best-effort**: if writing the row fails, we log it and move on —
approving or editing a claim must never break just because the AI queue hiccupped. Because
"best-effort" could in theory drop a row, there's a safety net:

```
SAFETY NET (runs every 5 minutes):  reconcile_verification_runs()
   "Find every HOD-approved expense claim that has NO check on the list yet, and add it."
   → guarantees every claim eventually gets checked, even if its trigger was dropped.
```

At the end of Part 1, the only thing that happened is: **rows exist in the table with
status `queued`.** Nothing has called the AI yet.

---

### Part 2 — How the worker processes the list

A scheduled clock inside the database (`pg_cron`) fires **every minute** and pokes the app
to do a batch of work:

```
STEP 1  pg_cron fires every minute
        └─▶ tick_verification_worker()         a DB function
                └─▶ sends an HTTP POST (via pg_net) to the app:
                        POST /api/internal/verify-worker
                        header: x-cron-secret: <shared secret>      ← so only the cron can call it

STEP 2  The app route checks the secret matches CRON_SECRET, then runs:
        VerificationWorker.processBatch()

STEP 3  Grab a lock so two ticks can't work at once
        acquire_verification_worker_lease()
        └─ if another tick is already running, this one just exits (does nothing)

STEP 4  Atomically claim up to 5 queued rows
        dequeue_verification_runs(5)
        └─ flips them queued → running. Uses "FOR UPDATE SKIP LOCKED" so even if two
           workers ran, they'd grab DIFFERENT rows, never the same one.

STEP 5  For EACH of those 5 claims, do the real work:

        ┌─ no receipt on file?  ─────────────▶ verdict = "no_document", done
        │
        ├─ download the receipt file from Storage (bucket "claims")
        │     └─ download fails? ────────────▶ verdict = "extraction_failed"
        │
        ├─ extractReceiptFromBuffer()         send the file to Gemini, get back the
        │     │                               fields it reads (raw + cleaned-up values)
        │     └─ Gemini quota/temporary error?▶ requeue with a backoff delay, try later
        │
        ├─ compareClaim()                     compare each extracted field to the
        │                                     snapshot, field by field → a list of results
        │
        └─ rollUpVerdict()                    turn that list into ONE overall verdict
                                              (mismatch / needs_review / verified)

STEP 6  Save the result
        complete_verification_run(run, verdict, per-field results)
        ├─ writes the per-field evidence rows (claim_verification_checks)
        ├─ writes the overall verdict on the run row, flips it → 'completed'
        ├─ double-checks the snapshot still matches the claim; if finance changed the
        │  claim while this was running, marks this run 'superseded' so it won't show
        └─ writes an "AI_VERIFICATION_COMPLETED" entry to the claim's audit history

STEP 7  Release the lock so the next minute's tick can run.
```

### What finance actually sees

The result reaches the screen through one database **view**, `claim_latest_verification`,
which always points at _the latest non-superseded run per claim_:

```
claim_latest_verification (view)
        │
        ├──▶ Finance queue: the "AI Check" badge column
        │       (finance-approvals-bulk-table.tsx)
        │
        └──▶ Claim detail page: the verification panel
                (verification-panel.tsx) — summary sentence, the field-by-field
                comparison table, the evidence line (file hash, run id, timestamp),
                and the "Re-run" / "Mark verified anyway" buttons
```

### "Superseded" — why a run sometimes gets ignored

Because Part 1 and Part 2 run independently, a slow check can finish _after_ the claim has
already changed. Example:

```
10:00  HOD approves → run #1 queued (snapshot: amount = ₹1,000)
10:01  worker starts run #1 (slow, still talking to Gemini...)
10:02  finance edits the amount to ₹1,200 → run #2 queued, run #1 marked "superseded"
10:03  run #1 finishes with a verdict about ₹1,000 — but it's superseded, so it is
       recorded for history but NEVER shown. The badge waits for run #2 (the ₹1,200 one).
```

This is why the badge always reads from "latest **non-superseded** run," not just "latest run."

---

### Retry & failure handling

Failures are handled in **three layers**, from fastest/most-local to slowest/most-global.

**Layer 1 — in-process retry (inside a single extraction).**
`generateGeminiContentWithRetry()` in `parse-receipt.ts` retries **3 times, 1s apart**, but
**only for Gemini 503 / "service unavailable"** (a brief outage). A 429 (quota / rate limit)
is deliberately _not_ retried here — it throws immediately so the slower Layer 2 backoff can
handle it instead of hammering a quota wall every second.

**Layer 2 — run-level retry with exponential backoff.**
When extraction throws, the worker classifies the error (`isRetryableGeminiError()`):
429 / 503 / "quota exceeded" / "rate limit" → **retryable**. The worker calls
`fail_verification_run(..., retryable = true)`, which does **not** fail the run — it puts it
back to `queued` with a delay:

```
attempt 1 fails → next_attempt_at = now() + 2 min   (2^1)
attempt 2 fails → next_attempt_at = now() + 4 min   (2^2)
attempt 3 fails → give up → status 'failed', verdict 'extraction_failed'
```

`dequeue_verification_runs()` only picks rows where `next_attempt_at <= now()`, so a
backed-off run simply waits its turn. **Non-retryable** failures (receipt not found in
storage, Gemini returned empty/garbage JSON) go straight to `failed` with no retry —
retrying wouldn't help. Finance can always trigger a fresh attempt with **Re-run**.

**Layer 3 — the reaper (crash recovery).**
If a worker dies mid-run (e.g. the serverless function is killed at its `maxDuration`),
its rows are stuck in `running`. `reap_stuck_verification_runs()` (every 5 min) resets any
run `running` for > 15 min back to `queued` (or to `failed` after 3 attempts).

| Failure                             | Layer     | Outcome                                          |
| ----------------------------------- | --------- | ------------------------------------------------ |
| Gemini 503 (brief outage)           | 1, then 2 | 3 quick in-process retries, then 2/4-min backoff |
| Gemini 429 (quota)                  | 2         | 2/4-min backoff, up to 3 attempts                |
| Receipt missing from storage        | —         | immediate `failed` (`extraction_failed`)         |
| Gemini returns empty/invalid output | —         | immediate `failed`                               |
| Worker process killed mid-batch     | 3         | reaper requeues after 15 min                     |
| Claim has no receipt                | —         | `no_document` (not a failure)                    |

Relevant constants: `GEMINI_MAX_ATTEMPTS = 3`, `GEMINI_RETRY_DELAY_MS = 1000`
(`parse-receipt.ts`); `v_max_attempts = 3`, backoff `2^attempts` minutes
(`fail_verification_run`); stuck threshold 15 min (`reap_stuck_verification_runs`).

---

### Concurrency & locking (what happens when ticks overlap)

There are **two independent guards**:

- **The lease** (`verification_worker_lease`) — a _soft_ "only one worker at a time"
  optimization, so we don't waste Gemini calls. It is a **TTL lease** (`LEASE_TTL_SECONDS = 90`),
  not a permanent lock.
- **Row status + `FOR UPDATE SKIP LOCKED`** in `dequeue_verification_runs()` — the _hard_
  guarantee that no single row is ever processed by two workers, even if the lease fails.

**Case A — a batch is slow but the lease hasn't expired (e.g. Gemini takes ~75s):**

```
10:00:00  Tick A acquires the lease → locked_until = 10:01:30. Claims 5 rows (→ running). Working...
10:01:00  Tick B fires. acquire_verification_worker_lease() runs:
             UPDATE ... WHERE locked_until < now()   →  10:01:30 < 10:01:00 is FALSE
          → 0 rows updated → lease NOT acquired → Tick B returns immediately and does nothing.
10:01:15  Tick A finishes; its `finally` calls releaseWorkerLease() → lease is free.
10:02:00  Tick C acquires the free lease and claims the next 5 queued rows.
```

While one worker holds the lease, every overlapping tick is a clean no-op. No double work.
(`tick_verification_worker()` also skips POSTing entirely when there's no backoff-ready
queued work, so idle minutes cost nothing.)

**Case B — a batch runs longer than the 90s TTL, or the worker is killed:**

```
10:00:00  Tick A: lease → locked_until = 10:01:30. Claims rows #1–5 (→ running). Hangs on Gemini.
10:01:30  Lease EXPIRES (nobody released it).
10:02:00  Tick D: acquire_verification_worker_lease():
             UPDATE ... WHERE locked_until < now()   →  10:01:30 < 10:02:00 is TRUE
          → acquires the (expired) lease. Then dequeue_verification_runs(5) runs:
          it only selects status = 'queued' rows. Rows #1–5 are still 'running',
          so Tick D cannot touch them — it claims rows #6–10 instead.
```

So even if the lease expires and two workers run at once, `dequeue` only ever claims
`queued` rows, and `SKIP LOCKED` makes concurrent dequeues lock **disjoint** sets — no row
is processed twice. Correctness rests on the row guard; the lease is only an optimization.

**Why a TTL lease (and not a permanent lock)?** So a **killed worker self-heals**. The route
declares `maxDuration = 60`; if the platform kills the function mid-batch, the `finally` that
releases the lease never runs. A permanent lock would deadlock the whole system forever. The
90s TTL frees the lease automatically, and the reaper requeues the abandoned `running` rows —
the system recovers on its own with no manual intervention.

> Tuning note: `BATCH_LIMIT = 5` and `maxDuration = 60` are sized so a normal batch finishes
> within the function timeout. If Gemini is persistently slow, lower `BATCH_LIMIT` or raise
> `maxDuration` so batches reliably complete before the platform kills them (which would
> otherwise lean on the reaper and add ~15 min latency to those runs).

### Verdict logic (tiered roll-up)

| Outcome               | When                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mismatch**          | any HARD field mismatches: `total_amount`, `transaction_date`, `bill_no`, or GST amounts (only when `is_gst_applicable`)                     |
| **Needs review**      | no hard mismatch, but a soft signal: overall extraction confidence `< CONFIDENCE_FLOOR` (60), currency disagreement, or `gst_number` differs |
| **Verified**          | everything matches / fuzzy-matches / is unavailable                                                                                          |
| **No document**       | claim has no `receipt_file_path`                                                                                                             |
| **Extraction failed** | receipt download or Gemini extraction failed                                                                                                 |
| **Pending**           | run is queued or running                                                                                                                     |

Per-field rules (deterministic, in the comparison engine):

| Field                                   | Rule                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `total_amount`, `cgst/sgst/igst_amount` | within **±1 rupee** (`AMOUNT_TOLERANCE`, matches the extractor's `MATH_TOLERANCE`) |
| `transaction_date`                      | exact match vs receipt date                                                        |
| `bill_no`                               | normalized (case/punctuation-insensitive) exact match                              |
| `gst_number`                            | normalized exact; differences are a **soft** signal, not a hard mismatch           |
| `vendor_name`                           | fuzzy/contains; **never** a hard mismatch on its own                               |
| `foreign_currency_code`                 | document-currency compare, **no FX conversion in v1**; disagreement → needs review |

---

## Where the code lives

### Database (Supabase / Postgres)

Migrations (in apply order):

| File                                                                    | What it creates                                                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260615130000_ai_claim_verification_ledger.sql`   | the two tables, all RPCs, the latest-verdict view, RLS, the **AI Verifier** system user, and the `claim_audit_logs` action-type extension |
| `supabase/migrations/20260615131000_ai_claim_verification_schedule.sql` | `pg_cron` + `pg_net`, the `verification_worker_config` row, `tick_verification_worker()`, and the three cron jobs                         |
| `supabase/migrations/20260615132000_verification_worker_lease.sql`      | the single-flight worker lease table + acquire/release functions                                                                          |
| `supabase/migrations/20260616120000_fix_reconcile_reenqueue_loop.sql`   | bugfix: stops the reconcile sweep from re-enqueuing already-failed claims                                                                 |

Tables / views:

| Object                             | Role                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `claim_verification_runs`          | append-only ledger **and** the work queue. One row per run; `superseded` flag; latest non-superseded run drives the badge |
| `claim_verification_checks`        | per-field evidence rows (submitted, extracted raw + normalized, verdict, confidence, tolerance, reason)                   |
| `claim_latest_verification` (view) | latest non-superseded run per claim — what the finance queue badge reads                                                  |
| `verification_worker_config`       | singleton: `worker_url`, `cron_secret`, `enabled` (worker stays dark until populated)                                     |
| `verification_worker_lease`        | single-flight guard so overlapping cron ticks don't double-process                                                        |

Key RPCs (all `SECURITY DEFINER`, `search_path=''`, `service_role`-only):

| Function                                          | Purpose                                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `enqueue_verification_run(claim_id, trigger)`     | single entry point; snapshots compared fields, supersedes in-flight runs, inserts a queued run. No-op for non-expense claims.    |
| `build_verification_snapshot(claim_id)`           | the **one** canonical snapshot builder (used by enqueue + the completion supersede-check, so there's no drift)                   |
| `dequeue_verification_runs(limit)`                | atomic batch claim via `FOR UPDATE SKIP LOCKED`, skips superseded + backoff-pending rows                                         |
| `complete_verification_run(...)`                  | writes checks + verdict, re-checks the snapshot (marks superseded if inputs changed), writes the audit log                       |
| `fail_verification_run(run, error, retryable)`    | retryable errors → requeue with exponential `next_attempt_at` backoff; else terminal `failed`                                    |
| `reconcile_verification_runs()`                   | 5-min backstop: enqueues HOD-approved expense claims that have no run (at-least-once guarantee for dropped best-effort triggers) |
| `reap_stuck_verification_runs()`                  | resets runs stuck `running` > 15 min                                                                                             |
| `override_verification_run(claim, actor, reason)` | "mark verified anyway" — writes `AI_VERIFICATION_OVERRIDDEN`, attributed to the finance user                                     |
| `rerun_verification(claim, actor)`                | manual re-run — enqueues + writes `AI_VERIFICATION_RERUN`                                                                        |
| `tick_verification_worker()`                      | pg_cron → pg_net POST to the worker route (no-op when unconfigured/disabled or no ready work)                                    |
| `acquire_/release_verification_worker_lease()`    | single-flight lease                                                                                                              |

Cron jobs (in `cron.job`): `verify-worker-tick` (every min), `verify-reconcile` (_/5), `verify-reaper` (_/5).

### Application (Next.js / TypeScript)

| File                                                                | Role                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/claims/actions/parse-receipt.ts`                       | `extractReceiptFromBuffer()` — the shared buffer-level extraction core (returns **raw + normalized + per-field confidence**). `parseReceiptAction()` (submission-time autofill) is now a thin wrapper over it, so autofill and verification can never silently diverge. |
| `src/modules/claims/actions/receipt-normalization.ts`               | normalization helpers, incl. new `normalizeBillNo()` / `normalizeGstNumber()`                                                                                                                                                                                           |
| `src/modules/claims/verification/comparison-engine.ts`              | **pure** comparison: `compareClaim()` (per-field) + `rollUpVerdict()` (tiered). `AMOUNT_TOLERANCE`, `CONFIDENCE_FLOOR` live here.                                                                                                                                       |
| `src/modules/claims/verification/comparison-engine.test.ts`         | 27 unit tests (tolerance boundaries, GST gating, vendor-never-hard, roll-up truth table)                                                                                                                                                                                |
| `src/modules/claims/verification/verification-worker.ts`            | `VerificationWorker.processBatch()` — lease → dequeue → download → extract → compare → complete/fail                                                                                                                                                                    |
| `src/modules/claims/repositories/SupabaseVerificationRepository.ts` | all DB/storage access for verification (RPC wrappers, storage `download`, badge/summary reads)                                                                                                                                                                          |
| `src/app/api/internal/verify-worker/route.ts`                       | the authenticated worker route (checks `x-cron-secret` against `CRON_SECRET`)                                                                                                                                                                                           |
| `src/modules/claims/ui/verification-panel.tsx`                      | claim-detail panel: verdict badge, field table, evidence line, re-run / mark-verified                                                                                                                                                                                   |
| `src/modules/claims/ui/finance-approvals-bulk-table.tsx`            | the "AI Check" badge column in the finance queue                                                                                                                                                                                                                        |
| `src/modules/claims/ui/claims-approvals-section.tsx`                | fetches bulk verdicts and feeds the table                                                                                                                                                                                                                               |
| `src/modules/claims/ui/claim-audit-timeline.tsx`                    | renders the `AI_VERIFICATION_*` audit entries                                                                                                                                                                                                                           |
| `src/app/(dashboard)/dashboard/claims/[id]/page.tsx`                | mounts `ClaimVerificationSection` for finance actors on expense claims                                                                                                                                                                                                  |
| `src/modules/claims/actions.ts`                                     | the trigger hooks (`enqueueVerificationBestEffort` on L1 approve + finance edit) and the `markClaimVerifiedAction` / `rerunClaimVerificationAction` server actions                                                                                                      |
| `src/core/config/server-env.ts`                                     | `CRON_SECRET` (optional; worker route is dark without it)                                                                                                                                                                                                               |

### Trust & attribution

- Automated events are attributed to the **AI Verifier** system user
  (`id = 11111111-1111-4111-8111-111111111111`, email `ai-verifier@nxtclaim.internal`),
  seeded in the ledger migration. It exists only to satisfy the `claim_audit_logs.actor_id`
  FK; it can never log in.
- Override / re-run events are attributed to the finance user who clicked.
- RLS: finance approvers (`master_finance_approvers`, active) can read the verification
  tables; only `service_role` writes them. Config/lease tables are service-role-only.

---

## Operations

### Configuration

| Setting                                | Where                            | Notes                                                                         |
| -------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `CRON_SECRET`                          | app env (Vercel)                 | shared secret the worker route checks; **must match** the config row          |
| `worker_url`, `cron_secret`, `enabled` | `verification_worker_config` row | worker no-ops until `worker_url` + `cron_secret` are set and `enabled = true` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`       | app env                          | shared with submission-time autofill                                          |

Point the worker at a deployment (run on the DB):

```sql
update public.verification_worker_config
set worker_url = 'https://<app-host>/api/internal/verify-worker',
    cron_secret = '<same value as CRON_SECRET>',
    enabled = true
where id = true;
```

### Monitoring

```sql
-- queue / verdict health
select status, overall_verdict, count(*)
from claim_verification_runs group by 1,2 order by 1,2;

-- recent failures and why
select error_detail, count(*) from claim_verification_runs
where status='failed' group by 1 order by 2 desc;
```

### Pause / resume (kill switch)

```sql
-- pause: stop processing (queue keeps filling harmlessly)
update verification_worker_config set enabled=false where id=true;
-- full stop: also unschedule
select cron.unschedule(jobid) from cron.job where jobname in ('verify-worker-tick','verify-reconcile');
-- resume: re-enable + re-schedule (see migration 20260615131000 for the schedule statements)
```

### Known gotchas

- **Cloned/test databases have no file binaries.** A DB clone copies `storage.objects`
  metadata rows but not the physical files, so receipts uploaded before the clone snapshot
  return `download failed: ... not found` and verdict `extraction_failed`. This is a test-env
  data artifact, not a code bug — production has all binaries. To validate on a clone, use
  claims whose receipts were uploaded on that environment, or upload fresh ones.
- **Shared Gemini quota.** The worker (5 runs/min cap) shares the `GEMINI_API_KEY` with
  live submission-time autofill. Quota/429 errors are treated as retryable (backoff requeue),
  but confirm the per-minute ceiling covers worker + peak interactive load before scaling.
- **Single worker URL.** The config is a singleton, so one deployment processes the queue
  at a time. Repoint `worker_url` at cutover from dev to prod.

---

## Status & roadmap

- **Done (v1):** ledger, worker, triggers, comparison engine, finance badge + panel, audit
  trail. Deployed to the development environment.
- **Deferred polish (Lane E):** queue count-filter chips; "apply receipt values & re-verify"
  prefill of the finance-edit form.
- **Before team-wide rollout:** extend the eval harness
  (`tests/integration/receipt-parser-eval.test.ts`) with ~100 real finance-reviewed claims
  and confirm per-field accuracy + verdict precision/recall; pilot with one finance approver
  for two weeks.
- **v1.1:** Lane 2 — bank-statement-vs-invoice amount/date matching (reuses this ledger + worker).
- **Phase 2 (not built):** one-click bulk-approve for all-green claims; later, true
  auto-approval, gated on accumulated accuracy data.
