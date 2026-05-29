# Runbook — `RPC_FAILED_AFTER_BC_SUCCESS`

This is the only catastrophic failure mode in the BC claim flow:
**Business Central accepted the claim, but our `complete_bc_claim` RPC
then failed.** The `bc_claim_details` row is stuck in `bc_status='submitting'`
even though BC considers the claim posted.

**The frontend MUST NOT retry** — that would risk double-posting in BC.

## How to detect

### From the user

A finance approver reports a stuck "Submitting to BC…" state or an error
banner mentioning "BC accepted this submission but the local sync failed".
The modal surfaces `bc_claim_details_id: <uuid>`.

### From Supabase logs

Filter by event in the Supabase logs explorer:

```
event = catastrophic_rpc_failed_after_bc_success
```

Or via SQL on the logs schema:

```sql
select * from supabase_functions.logs
 where event_message ilike '%catastrophic_rpc_failed_after_bc_success%'
 order by timestamp desc
 limit 50;
```

### From the DB (proactive sweep)

Stuck `submitting` rows older than 5 minutes:

```sql
select id, claim_id, created_at, updated_at
  from public.bc_claim_details
 where bc_status = 'submitting'
   and updated_at < now() - interval '5 minutes'
 order by created_at desc;
```

## How to recover

1. Identify the affected `bc_claim_details_id` (from the modal banner or the
   stuck-row query above).

2. Pull the BC response that was already saved when BC returned 2xx:

   ```sql
   select bc_response_json
     from public.bc_claim_details
    where id = '<bc_claim_details_id>';
   ```

3. Pull an actor user id (any admin works; ideally the original submitter):

   ```sql
   select id from public.admins limit 1;
   ```

4. Invoke `complete_bc_claim` manually via psql or the Supabase SQL Editor:

   ```sql
   select public.complete_bc_claim(
     p_bc_details_id := '<bc_claim_details_id>'::uuid,
     p_actor_user_id := '<actor_user_id>'::uuid,
     p_response_json := '<bc_response_json from step 2>'::jsonb
   );
   ```

5. Verify the claim now shows as Finance Approved in the UI.

## Prevention

The catastrophic path is rare — it only triggers when the Postgres
connection flaps mid-RPC after BC has already returned 2xx. Mitigations
already in place:

- Partial UNIQUE index on
  `bc_claim_details(claim_id) WHERE bc_status IN ('submitting','success')`
  prevents concurrent retries.
- `bc-claim` edge function returns a distinct `RPC_FAILED_AFTER_BC_SUCCESS`
  code so the frontend can refuse to retry.
- Structured log line `catastrophic_rpc_failed_after_bc_success` lets
  monitoring trigger an alert (alerting not yet wired — future work).

## Links

- Spec: `docs/superpowers/specs/2026-05-18-bc-integration-hardening-design.md`
  (Fix 10)
- Schema: `supabase/migrations/20260517090000_bc_claim_details_schema.sql`
- RPC: `supabase/migrations/20260517090100_bc_claim_functions.sql`
  (`complete_bc_claim`)
