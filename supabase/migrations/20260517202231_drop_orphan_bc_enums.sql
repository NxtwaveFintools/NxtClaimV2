BEGIN;

-- These two enums were created by migration 20260513151000_bc_payment_audit_log.sql
-- to back the bc_payment_audit_log table. That table (and 2 of its 4 enums) was
-- dropped by 20260517090000_bc_claim_details_schema.sql when we replaced the
-- audit-log architecture with bc_claim_details. The remaining two enums are
-- orphans — no column anywhere uses them, and src/types/database.ts still
-- emits stale TypeScript types for them.
--
-- This migration removes the orphans. After applying:
--   1. Regenerate src/types/database.ts via `supabase gen types typescript`.
--   2. Commit the regenerated file.

DROP TYPE IF EXISTS public.bc_account_type;
DROP TYPE IF EXISTS public.bc_employee_transaction_type;

COMMIT;
