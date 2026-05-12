-- Rollback for: 20260511105000_create_expense_location_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

DROP TABLE IF EXISTS public.master_expense_location_mappings;

COMMIT;