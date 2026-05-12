-- Rollback for: 20260511107000_create_department_responsible_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

DROP TABLE IF EXISTS public.master_department_responsible_mappings;

COMMIT;