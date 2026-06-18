# TODOS

## AI Claim Verification — deferred items (from /plan-eng-review 2026-06-15)

### Retention / archival policy for verification tables

- **What:** Define archive + index + UI-pagination strategy for `claim_verification_runs`
  and `claim_verification_checks`.
- **Why:** Both tables are append-only and re-runs create new rows; at ~4,000 claims/mo
  with per-field checks plus re-runs, row count grows steadily. The history is the phase-2
  auto-approval trust dataset (must be kept), but list/panel queries must stay bounded.
- **Pros:** Keeps finance-queue and panel queries fast as data accumulates; avoids an
  emergency partition migration later.
- **Cons:** Premature at launch (zero rows day one); over-built if added to the first migration.
- **Context:** Tables defined in the initial verification migration. Revisit when runs table
  passes ~100k rows. Options: time-based partitioning, archive-to-cold-table, or UI query
  limits + an index on `(claim_id, created_at DESC)` (already planned for the badge view).
- **Depends on:** initial verification ledger migration shipped.

### Overseas FX: eval fixtures + per-currency band data

- **What:** Extend `tests/integration/receipt-parser-eval.test.ts` with foreign-currency
  (USD/EUR/GBP) invoice fixtures and confirm `foreign_total_amount` + `foreign_currency_code`
  extract correctly. Separately, pull last quarter's overseas claims and compute the
  `total_amount / foreign_total_amount` distribution per currency to set EUR/GBP/SGD bands
  in `FX_BANDS` (USD is set to 92–98).
- **Why:** FX reconciliation is only as trustworthy as (a) foreign-amount extraction and
  (b) the per-currency bands — both unproven for non-USD today.
- **Pros:** Non-USD overseas claims verify correctly instead of all landing in needs_review.
- **Cons:** Needs real overseas claim samples finance may have to pull.
- **Context:** From /plan-eng-review 2026-06-17 on design `Nxtwave-development-design-20260617-144208.md`.
  USD path ships without this; other currencies stay needs_review until bands are set.
- **Depends on:** the FX reconciliation implementation (comparison-engine FX_BANDS).

### Queue-health SLO + monitoring

- **What:** A queue-age alert and a finance-visible "verification lagging" signal, plus a
  query/dashboard listing L1-approved claims that have no completed verification run.
- **Why:** HOD bulk-approval bursts, Gemini outages, and requeues can create silent lag.
  Finance must be able to trust that a Verified/blank badge reflects current state, not a
  stuck queue.
- **Pros:** Makes lag observable before finance loses trust; pairs with the reconciliation
  sweep (which guarantees eventual processing but not timeliness).
- **Cons:** Adds monitoring scope; safe to defer because the sweep already guarantees
  at-least-once processing.
- **Context:** Suggested target: 95% of runs complete < 10 min after trigger. Alert on
  oldest-queued-run age. Needed before team-wide enable; fine to defer through the pilot.
- **Depends on:** worker + reconciliation sweep shipped.
