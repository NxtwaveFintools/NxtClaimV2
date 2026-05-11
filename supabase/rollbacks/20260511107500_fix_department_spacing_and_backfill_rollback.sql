-- Rollback for: 20260511107500_fix_department_spacing_and_backfill.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

UPDATE public.master_departments
SET name = 'Travel & Stay(Sales)'
WHERE name = 'Travel & Stay (Sales)';

COMMIT;