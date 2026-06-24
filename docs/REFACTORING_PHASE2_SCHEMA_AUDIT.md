# Refactoring — Phase 2: The Purge (Supabase Schema)

> **READ-ONLY AUDIT. No migrations applied. No `DROP`/`ALTER`/`REVOKE` executed.**
> All SQL below is **candidate-only, for your review**. Project explored via Supabase MCP
> (`execute_sql`, `get_advisors`) — all read-only.
> Generated: 2026-06-24

## Headline

- **No tables to drop.** All 28 public tables are referenced in application code.
- **No 0-row tables.** Smallest tables hold 1 row (`department_viewers`, `master_policies`,
  `verification_worker_config`, `verification_worker_lease`).
- **No views to drop.** All 4 views are referenced in code.
- The genuine cleanup surface is: **4 dead columns**, **~32 unused indexes**, **RLS
  consolidation**, and **security hardening** (SECURITY DEFINER views, mutable `search_path`,
  trigger functions exposed as RPC). None of these are destructive table drops.

---

## 1. Table inventory (28 tables)

`app refs` = files under `src/`+`scripts/` referencing the table name (cross-referenced via
`scratchpad/db-xref.cjs`). Every table is used.

| Table                                  | Live rows | Size   | RLS | Policies | App refs |
| -------------------------------------- | --------: | ------ | :-: | :------: | :------: |
| claim_audit_logs                       |    13,945 | 4.9 MB |  ✓  |    3     |    3     |
| claims                                 |     4,578 | 7.2 MB |  ✓  |    5     |    71    |
| expense_details                        |     4,392 | 4.0 MB |  ✓  |    2     |    5     |
| claims_analytics_snapshot              |     4,021 | 2.5 MB |  ✓  |  **0**   |    1     |
| claims_analytics_daily_stats           |     1,639 | 5.0 MB |  ✓  |  **0**   |    2     |
| users                                  |       390 | 496 kB |  ✓  |    4     |    14    |
| wallets                                |       390 | 280 kB |  ✓  |    4     |    4     |
| claim_verification_checks              |       355 | 152 kB |  ✓  |    1     |    2     |
| claim_verification_runs                |       333 | 4.4 MB |  ✓  |    1     |    2     |
| user_policy_acceptances                |       330 | 208 kB |  ✓  |    2     |    2     |
| advance_details                        |       143 | 176 kB |  ✓  |    2     |    4     |
| master_expense_location_mappings       |        77 | 48 kB  |  ✓  |    3     |    1     |
| master_locations                       |        77 | 64 kB  |  ✓  |    3     |    7     |
| master_departments                     |        57 | 128 kB |  ✓  |    3     |    9     |
| bc_claim_details                       |        51 | 280 kB |  ✓  |    2     |    2     |
| master_department_responsible_mappings |        46 | 80 kB  |  ✓  |    3     |    1     |
| expense_category_bc_mappings           |        24 | 40 kB  |  ✓  |    3     |    1     |
| master_expense_categories              |        24 | 64 kB  |  ✓  |    3     |    8     |
| master_products                        |        16 | 64 kB  |  ✓  |    3     |    8     |
| master_program_product_mappings        |        16 | 48 kB  |  ✓  |    3     |    1     |
| master_sub_product_mappings            |        16 | 48 kB  |  ✓  |    3     |    1     |
| master_finance_approvers               |         9 | 96 kB  |  ✓  |    4     |    6     |
| master_payment_modes                   |         7 | 64 kB  |  ✓  |    3     |    9     |
| admins                                 |         3 | 64 kB  |  ✓  |    3     |    7     |
| allowed_auth_domains                   |         3 | 48 kB  |  ✓  |    1     |    2     |
| department_viewers                     |         1 | 88 kB  |  ✓  |    1     |    5     |
| master_policies                        |         1 | 96 kB  |  ✓  |    3     |    2     |
| verification_worker_config             |         1 | 32 kB  |  ✓  |  **0**   |    1     |
| verification_worker_lease              |         1 | 56 kB  |  ✓  |  **0**   |    1     |

---

## 2. Redundant columns (4 fully-NULL) — **candidates, confirm before dropping**

Found via planner stats (`pg_stats.null_frac >= 0.999`). Each is **100% NULL** across all rows,
and — corroborating — each has a **matching unused index** (see §3).

| Table                | Column                        | Null frac | Matching unused index                                |
| -------------------- | ----------------------------- | :-------: | ---------------------------------------------------- |
| `advance_details`    | `location_id`                 |  1.0000   | `idx_advance_details_location_id`                    |
| `advance_details`    | `product_id`                  |  1.0000   | `idx_advance_details_product_id`                     |
| `master_departments` | `approver1_provisional_email` |  1.0000   | `idx_master_departments_approver1_provisional_email` |
| `master_departments` | `approver2_provisional_email` |  1.0000   | `idx_master_departments_approver2_provisional_email` |

⚠️ **Caveat:** "100% NULL today" ≠ "safe to drop." Confirm these aren't part of an unreleased
feature or written-but-not-yet-populated path before dropping. `advance_details.location_id/
product_id` _do_ appear in app code (4 refs) — verify they aren't write targets first.

```sql
-- CANDIDATE — DO NOT RUN. Review first.
-- ALTER TABLE public.advance_details   DROP COLUMN location_id;
-- ALTER TABLE public.advance_details   DROP COLUMN product_id;
-- ALTER TABLE public.master_departments DROP COLUMN approver1_provisional_email;
-- ALTER TABLE public.master_departments DROP COLUMN approver2_provisional_email;
```

---

## 3. Unused indexes (32) — safest cleanup, but caveated

Reported by `get_advisors(performance)` as never used since stats were last reset. Dropping an
unused index is **low-risk and easily reversible** (just re-create). **Caveat:** "unused" is
relative to the stats window — on a recently reset / low-traffic DB an index may be needed but
simply not yet exercised. **Treat the `*_trgm` search indexes with extra caution** — they back
fuzzy-search features that may not have been hit during the stats window.

**Likely-safe (boolean `is_active` / timestamp filters, low-cardinality):**
`idx_master_departments_is_active`, `idx_master_expense_categories_is_active`,
`idx_master_finance_approvers_is_active`, `idx_master_locations_is_active`,
`idx_master_payment_modes_is_active`, `idx_master_products_is_active`,
`idx_master_policies_is_active`, `idx_master_policies_created_at`,
`idx_claim_audit_logs_created_at`, `idx_claims_hod_action_at`, `idx_claims_finance_action_at`,
`idx_user_policy_acceptances_accepted_at`, `idx_user_policy_acceptances_policy_id`,
`idx_department_viewers_active`, `idx_department_viewers_department_id`,
`idx_department_viewers_user_id`, `idx_admins_provisional_email`,
`idx_master_finance_approvers_provisional_email`.

**Tied to the dead columns in §2 (drop with the columns):**
`idx_advance_details_location_id`, `idx_advance_details_product_id`,
`idx_master_departments_approver1_provisional_email`,
`idx_master_departments_approver2_provisional_email`.

**Analytics cache indexes (verify the analytics RPCs don't rely on them under load):**
`idx_claims_analytics_daily_stats_payment_mode_date`,
`idx_claims_analytics_daily_stats_product_date`,
`idx_claims_analytics_daily_stats_status`,
`idx_claims_analytics_snapshot_assigned_l2_approver_id`,
`idx_claims_analytics_snapshot_expense_category_id`,
`idx_claims_analytics_snapshot_product_id`.

**⚠️ Search (`pg_trgm`) indexes — KEEP unless search is confirmed unused:**
`idx_claims_on_behalf_employee_code_trgm`, `idx_claims_on_behalf_email_trgm`,
`idx_users_email_trgm`, `idx_users_full_name_trgm`.

---

## 4. Unindexed foreign keys (4) — these are ADDs, defer to Phase 3 perf

Not a purge item (adding, not removing), but logged here from the advisor:

- `claims.claims_bc_claim_details_id_fkey`
- `claims.claims_deleted_by_fkey`
- `master_program_product_mappings.master_program_product_mappings_product_id_fkey`
- `master_sub_product_mappings.master_sub_product_mappings_product_id_fkey`

---

## 5. RLS review

### 5a. RLS enabled but **no policy** (4 tables) — confirm intent

`claims_analytics_snapshot`, `claims_analytics_daily_stats`, `verification_worker_config`,
`verification_worker_lease`.

With RLS on and 0 policies, **all non-service-role access is denied**. This is **fine if** these
are only touched server-side via the service-role key or via `SECURITY DEFINER` RPCs (which the
analytics + verification-worker design suggests). **Action:** confirm no authenticated _client_
reads these directly (it would silently get 0 rows). If intentional, document it; no change needed.

### 5b. Multiple permissive policies for the same role+action (8) — consolidation opportunity

Each adds a per-query policy evaluation. Consolidating into one policy per action improves
performance and readability:

| Table              | Role/Action            | Overlapping policies                                                                                               |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `advance_details`  | authenticated / SELECT | `advance_details_select_admin`, `submitters and approvers can read advance details`                                |
| `bc_claim_details` | authenticated / SELECT | `bc_claim_details_admin_finance_read`, `bc_claim_details_submitter_read`                                           |
| `claim_audit_logs` | authenticated / SELECT | `claim_audit_logs_select_admin`, `claim_audit_logs_select_involved_users`                                          |
| `claims`           | authenticated / SELECT | `claims_select_admin`, `department_viewers_can_read_department_claims`, `submitters and approvers can read claims` |
| `expense_details`  | authenticated / SELECT | `expense_details_select_admin`, `submitters and approvers can read expense details`                                |
| `users`            | authenticated / SELECT | `users can read own profile`, `users_select_admin`                                                                 |
| `users`            | authenticated / UPDATE | `users can update own profile`, `users_update_admin`                                                               |
| `wallets`          | authenticated / SELECT | `users can read own wallet`, `wallets_select_admin`                                                                |

### 5c. RLS init-plan re-evaluation (perf) — `bc_claim_details`

Policies `bc_claim_details_admin_finance_read` and `bc_claim_details_submitter_read` call
`auth.<fn>()` per row. Wrap as `(select auth.<fn>())` so it evaluates once.

---

## 6. Security findings (from `get_advisors(security)`) — fixes deferred, logged here

### 6a. SECURITY DEFINER views (ERROR ×2)

`vw_admin_claims_dashboard`, `vw_enterprise_claims_dashboard` run with the **creator's**
permissions, bypassing the querying user's RLS. Both are referenced in app code. Review whether
they should be `security_invoker = true`.
(Note: migrations `…restore_security_invoker…` exist — verify these two weren't missed.)

### 6b. Trigger functions exposed as callable RPC (high-priority)

These are **trigger functions** that should never be invoked directly, yet are `EXECUTE`-able by
`anon`/`authenticated` via `/rest/v1/rpc/...`:
`handle_new_user`, `block_null_auth_token_insert`, `fn_cascade_user_deactivation`,
`trg_transfer_claims_on_hod_change`.

```sql
-- CANDIDATE — DO NOT RUN. Defense-in-depth: stop direct RPC invocation of trigger fns.
-- REVOKE EXECUTE ON FUNCTION public.handle_new_user()                 FROM anon, authenticated;
-- REVOKE EXECUTE ON FUNCTION public.block_null_auth_token_insert()    FROM anon, authenticated;
-- REVOKE EXECUTE ON FUNCTION public.fn_cascade_user_deactivation()    FROM anon, authenticated;
-- REVOKE EXECUTE ON FUNCTION public.trg_transfer_claims_on_hod_change() FROM anon, authenticated;
```

### 6c. SECURITY DEFINER RPCs callable by `anon` (review)

These enforce auth internally but should not be reachable by the **anon** role; revoke anon
EXECUTE as defense-in-depth (keep `authenticated` where the app calls them):
`get_dashboard_analytics_payload`, `update_claim_by_finance`, `update_claim_by_submitter`,
`transfer_pending_hod_claims`.

### 6d. Functions with mutable `search_path` (WARN ×8)

`bc_claim_details_set_updated_at`, `bulk_process_claims`, `create_claim_with_detail`,
`process_l2_mark_paid_transition`, `refresh_claim_analytics_snapshot`,
`set_expense_total_amount`, `validate_claim_detail_consistency`, `wallets_set_derived_fields`.

```sql
-- CANDIDATE — DO NOT RUN. Pin search_path on each (signatures must match exactly):
-- ALTER FUNCTION public.bulk_process_claims(...) SET search_path = public, pg_temp;
```

### 6e. Other

- **`pg_trgm` installed in `public` schema** (WARN) — recommend moving to `extensions` schema.
- **Storage bucket `policies`** has a broad SELECT policy allowing file listing (WARN).
- **Leaked-password protection disabled** in Auth (WARN) — enable HaveIBeenPwned check.
- **Auth DB connections** use absolute (10) not percentage strategy (INFO).

---

## 7. Functions & triggers — note for deeper review (not done here)

The DB has ~48 user-defined (`plpgsql`/`sql`) functions plus pg_trgm extension functions.
Determining which app functions are truly unused requires parsing trigger wiring and RPC call
sites — **out of scope for this read-only pass**. Trigger functions correctly show "0 app refs"
(they're wired via triggers, not called from code) and must **not** be mistaken for dead code.

---

## 8. Summary of candidate actions (NONE executed)

| Priority | Action                                          | Risk                |  Reversible   |
| -------- | ----------------------------------------------- | ------------------- | :-----------: |
| Security | Revoke anon/auth EXECUTE on 4 trigger fns (§6b) | Low                 |       ✓       |
| Security | Review 2 SECURITY DEFINER views (§6a)           | Med                 |       ✓       |
| Security | Pin `search_path` on 8 fns (§6d)                | Low                 |       ✓       |
| Security | Enable leaked-password protection (§6e)         | Low                 |       ✓       |
| Cleanup  | Drop 4 dead columns + their indexes (§2)        | Med (confirm first) |  ✓ (re-add)   |
| Cleanup  | Drop ~24 safe unused indexes (§3, excl. trgm)   | Low                 | ✓ (re-create) |
| Perf     | Consolidate multiple permissive policies (§5b)  | Med                 |       ✓       |
| Perf     | Wrap auth fns in RLS subselect (§5c)            | Low                 |       ✓       |
| Perf     | Add 4 covering FK indexes (§4)                  | Low                 |       ✓       |

**Nothing in this document has been applied. Awaiting your direction.**
