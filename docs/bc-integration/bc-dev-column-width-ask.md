# Column width asks for BC developer

Reference: BC integration audit 2026-05-18, spec
`docs/superpowers/specs/2026-05-18-bc-integration-hardening-design.md`.

Three BC columns are currently narrower than our application generates and
need to be widened on the BC side. Once widened, we remove client-side
truncation in `supabase/functions/bc-claim/payloadBuilder.ts`.

## Asks

| BC column          | Current width | Our generated max          | Ask          |
| ------------------ | ------------- | -------------------------- | ------------ |
| `remarks`          | 50            | up to ~300 chars           | widen to 250 |
| `claimNo` (No.)    | 20            | up to 29 chars             | widen to 40  |
| `employeeId` (No.) | 20            | up to ~25 chars            | widen to 40  |
| `vendorInvoiceNo`  | unknown       | up to ~50 user-typed chars | confirm ≥ 50 |

## Rationale

- **remarks (50 → 250)**: today we send `"{claim_id} - {purpose}"` clipped to
  50 chars. We're forced to drop bill/bank-statement URL hints and chop
  purpose mid-word. 250 covers claim_id (29) + " - " (3) + a reasonably
  detailed purpose (~200) + slack, and matches BC's standard nvarchar(250).

- **claimNo / employeeId (20 → 40)**: our claim ID format is
  `CLAIM-{empId}-{YYYYMMDD}-{4char}` ≈ 29 chars. Audit / test employee IDs
  can run to 25+. 40 gives 1.5× headroom for future format extensions.

- **vendorInvoiceNo**: please confirm the current BC column width. Users
  paste GST invoice numbers up to ~30 chars normally, sometimes longer.
  We send as-is today; if BC silently truncates this we have a
  data-loss bug.

## After BC widens the columns

Remove the following from `supabase/functions/bc-claim/payloadBuilder.ts`:

- `truncBcNo()` helper and its two call sites (`claimNo`, `employeeId`).
- The 50-char cap inside `buildRemarks()`; reintroduce file-path hints.

Update `supabase/functions/bc-claim/payloadBuilder.test.ts` so the
truncation tests expect un-truncated values.
