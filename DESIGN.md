# NxtClaim — Design System

Source of truth for the NxtClaim UI redesign. Direction **"Ledger"**: a clean,
trustworthy fintech aesthetic — airy, money-forward, scannable, with one
consistent status language. Chosen via `/design-shotgun` (June 2026); mockups
in `~/.gstack/projects/NxtWaveTools-NxtClaimV2/designs/my-claims-20260625/`.

## Principles

1. **Scan, don't read.** Tables are billboards. Strongest emphasis on the two
   things a user needs: the **amount** and the **status**. Everything else is
   secondary (muted) or on the detail page.
2. **One status, one colour, everywhere.** A status never changes colour between
   screens. Colour is always paired with a dot + short text label so meaning
   survives for colour-blind users. No colour-only signalling.
3. **Density with hierarchy.** Fewer columns, more breathing room. Collapse
   redundant data (for "My Submissions" the submitter is always you) into the
   row or the detail page.
4. **Tabular numerals for money.** Amounts are right-aligned with `tabular-nums`
   so columns of figures line up.

## Typography

Already loaded (`src/lib/fonts.ts`) and applied on dashboard pages via the
`dashboard-font-body` / `dashboard-font-display` classes:

- **Body / UI:** Inter (`--font-dashboard-inter`)
- **Display / headings:** Plus Jakarta Sans (`--font-dashboard-display`)

## Colour & tokens

Base tokens live in `src/app/globals.css` (`@theme inline`, Tailwind v4):
`--color-background`, `--color-foreground`, `--color-muted`. Brand primary is
indigo (`indigo-600`). Surfaces: white / `zinc-50` on light, `zinc-900` /
`#0B0F1A` on dark.

### Status colour system (canonical)

The single source of truth is `ClaimStatusBadge`
(`src/modules/claims/ui/claim-status-badge.tsx`). Do **not** hardcode status
colours anywhere else — render `<ClaimStatusBadge status={...} />`.

| Claim status (DB / canonical)                        | Label               | Tone   |
| ---------------------------------------------------- | ------------------- | ------ |
| Submitted - Awaiting HOD approval / `Submitted`      | Awaiting HOD        | slate  |
| HOD approved - Awaiting finance approval / `Pending` | HOD Approved        | blue   |
| Finance Approved - Payment under process             | Finance Approved    | indigo |
| Payment Done - Closed / `Approved`                   | Payment Done        | green  |
| Rejected - Resubmission Allowed                      | Rejected · Resubmit | amber  |
| Rejected - Resubmission Not Allowed                  | Rejected            | red    |

Amber vs red is meaningful: amber = recoverable (resubmit allowed), red =
terminal. The full status string is preserved in `title` + `aria-label`.

## Component conventions

- **Status:** `ClaimStatusBadge` — pill with a coloured dot + short label.
  `fullWidth` stretches it to fill a fixed status column (legacy tables).
- **Amounts:** right-aligned, `font-semibold tabular-nums`.
- **Tables:** `<table className="w-full">`, header is
  `border-b bg-zinc-50/60`, rows separated by `divide-y divide-zinc-100`,
  hover `bg-zinc-50/80`. Hide secondary columns on small screens
  (`hidden sm:table-cell` / `hidden md:table-cell`) rather than horizontal scroll.
- **Empty states:** icon in a circle + headline + one helper line + a primary CTA.
- **Primary action:** `bg-indigo-600 ... hover:bg-indigo-500`, rounded-xl, h-9.

## Status of the redesign

- [x] **My Claims → My Submissions table** (`src/app/(dashboard)/dashboard/my-claims/page.tsx`)
      — 13 columns → 6 (Claim, Department, Submitted, Status, Amount, actions),
      tabular amounts, real empty state, responsive column hiding, no forced
      horizontal scroll.
- [x] **`ClaimStatusBadge`** — canonical status colours + short labels (propagates
      to every table that uses it).
- [x] **Approvals / Admin / Department tables** (`finance-approvals-bulk-table`,
      `admin-claims-table`, `department-claims-table`) — same column model:
      Claim (ID + type + on-behalf) · Submitter (name + email) · Department ·
      Status · Amount, plus view-specific columns (Admin: Active/Deleted By/Actions;
      Finance: bulk checkbox/AI Check/View). Submitter-ID / On-Behalf-ID /
      On-Behalf-Email columns folded into the Claim + Submitter cells. Redundant
      action-date columns dropped from the list (kept on the claim detail page).
- [x] **New Claim form** (`new-claim-form-client.tsx`) — submit is now a sticky
      footer (always reachable on the long form), mobile-safe. Form logic, field
      names, validation, and AI-parsing untouched. (Multi-step wizard + file-upload
      previews deferred as a larger follow-up.)
- [x] **Claim detail / review** (`claims/[id]/page.tsx`, `copyable-data-card.tsx`)
      — hero amount uses `tabular-nums`; cramped 10px labels bumped to 11px;
      accordions default to 2 open (Expense + Local Financials) instead of 5;
      sticky action bar is mobile-safe (`env(safe-area-inset-bottom)`) and wraps.
- [x] **Analytics dashboard** (`analytics-kpi-cards.tsx`) — KPI colours aligned to
      the status system (Total=indigo, Approved=green, Pending=blue,
      Pending-at-HOD=slate, Rejected=rose — fixes the amber/orange confusion);
      amounts use `tabular-nums`. Charts left functionally intact.
- [ ] Follow-ups: New Claim multi-step wizard + file-upload previews; analytics
      chart palette alignment; app-shell nav / active-page indicator.
