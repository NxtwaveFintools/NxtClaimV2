# Runbook: BC Payment Audit Log — Stuck PENDING Rows

`bc_payment_audit_log.status = 'PENDING'` rows older than 5 minutes indicate
the Edge Function called BC successfully but the local DB transition
(`complete_bc_payment`) failed before marking the row `SUCCESS`. The BC
side has data; the NxtClaim side does not.

**Hard rule: never re-call BC for a stuck row.**

## Monitoring query

```sql
SELECT id, claim_id, idempotency_key, created_at, bc_response_json
FROM public.bc_payment_audit_log
WHERE status = 'PENDING'
  AND created_at < now() - interval '5 minutes'
ORDER BY created_at;
```

## Diagnostic steps

1. Inspect `bc_response_json`. If null, BC was never called — safe to leave
   the row alone or delete after investigation; user may retry the claim.
2. If `bc_response_json` is populated, BC has the line(s). Confirm in BC
   Sandbox/Prod UI that the documentNo(s) exist.
3. Check `claims.bc_payments_flag` for the audit row's `claim_id`:
   - If `false`: the standard transition never happened; resolve via Step 4
     of the resolution flow.
   - If `true`: state already converged; just mark the audit row resolved.

## Resolution

Open a transaction in psql / Supabase SQL editor. Replace the placeholders.

```sql
BEGIN;

-- If the standard transition was missed, call the same function the
-- Edge Function would have called.
SELECT public.complete_bc_payment(
  p_claim_id       => '<claim_id>',
  p_actor_user_id  => '<actor uuid>',
  p_is_vendor      => <true|false>,
  p_vendor_id      => '<vendor No or NULL>',
  p_vendor_name    => '<vendor Name or NULL>',
  p_audit_log_id   => '<bc_payment_audit_log.id>',
  p_bc_response    => '<the bc_response_json from the row>'
);

COMMIT;
```

If the claim is already in `Finance Approved - Payment under process` (i.e.
`bc_payments_flag` already true), just update the audit row:

```sql
UPDATE public.bc_payment_audit_log
   SET status = 'SUCCESS', resolved_at = now()
 WHERE id = '<bc_payment_audit_log.id>';
```

## Re-emphasis

Do not re-call BC. The line items are already on their side. Re-calling
would duplicate them.
