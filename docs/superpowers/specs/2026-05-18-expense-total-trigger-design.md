# Design: Enforce `expense_details.total_amount` via DB Trigger

**Date:** 2026-05-18  
**Status:** Approved  
**Scope:** Database only — no UI or schema changes required

---

## Problem

`total_amount` in `expense_details` must always equal `basic_amount + cgst_amount + sgst_amount + igst_amount`. This math is enforced in application-layer RPCs, but nothing prevents a direct SQL write (or the legacy 2-param `update_claim_by_finance` overload) from storing an incorrect value.

---

## Goal

Make `total_amount` on `expense_details` DB-enforced: correct on every insert or update, regardless of how the row is written. The DB is the final source of truth.

`advance_details` is out of scope — its `total_amount` is user-provided with no component breakdown.

---

## Approach: BEFORE Trigger (Option A)

A `BEFORE INSERT OR UPDATE` trigger silently overwrites `NEW.total_amount` with the correct computed value before the row lands. The application layer continues to send `totalAmount` in payloads; the trigger corrects it transparently.

This was chosen over:

- **Generated column** — requires dropping/recreating the column across all RPCs and views; too invasive
- **Trigger + payload cleanup** — higher surface area; the trigger alone closes all gaps

---

## What Already Exists (No Changes Needed)

| Layer                                              | Status                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `create_claim_with_detail` RPC                     | Already computes `total_amount` from components                    |
| `update_claim_by_finance` (4-param)                | Already ignores incoming `totalAmount`; recomputes from components |
| `new-claim-form-client.tsx` Total Amount field     | Already `readOnly` + `disabled`                                    |
| `finance-edit-claim-form.tsx` Total Amount display | Already `disabled`; hidden input sends computed value              |
| `finance-edit-schema.ts` `totalAmount` field       | Already sends computed value — no breakage from trigger            |

---

## What This Design Adds

### Migration (up)

**File:** `supabase/migrations/20260518200000_enforce_expense_total_trigger.sql`

```sql
CREATE OR REPLACE FUNCTION public.set_expense_total_amount()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total_amount := ROUND(
    COALESCE(NEW.basic_amount, 0)
    + COALESCE(NEW.cgst_amount, 0)
    + COALESCE(NEW.sgst_amount, 0)
    + COALESCE(NEW.igst_amount, 0),
    2
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expense_total_amount
BEFORE INSERT OR UPDATE ON public.expense_details
FOR EACH ROW EXECUTE FUNCTION public.set_expense_total_amount();
```

### Migration (down / rollback)

**File:** `supabase/migrations/20260518200000_enforce_expense_total_trigger_down.sql`

```sql
DROP TRIGGER IF EXISTS trg_expense_total_amount ON public.expense_details;
DROP FUNCTION IF EXISTS public.set_expense_total_amount();
```

---

## Gap Closed by the Trigger

The **2-param legacy overload** of `update_claim_by_finance` (introduced in `20260518063735`) writes:

```sql
total_amount = (p_payload ->> 'totalAmount')::numeric
```

This trusts the client-supplied value. The trigger silently corrects this on every row touched by that overload, without requiring changes to the RPC.

---

## Success Criteria

- After migration: `SELECT basic_amount + cgst_amount + sgst_amount + igst_amount - total_amount FROM expense_details WHERE is_active = true` returns zero rows with a non-zero delta.
- A direct `UPDATE expense_details SET total_amount = 99999 WHERE id = '<any>'` is silently overwritten with the correct sum.
- All existing tests continue to pass (no UI or payload changes means no test breakage).

---

## Files Touched

| File                                                                        | Change                                     |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| `supabase/migrations/20260518200000_enforce_expense_total_trigger.sql`      | New — creates trigger function and trigger |
| `supabase/migrations/20260518200000_enforce_expense_total_trigger_down.sql` | New — rollback                             |
