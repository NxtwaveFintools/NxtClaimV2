BEGIN;

-- claims currently reference departments by UUID (`department_id`), so renaming the
-- master row preserves existing claim relationships without a claims-table backfill.
UPDATE public.master_departments
SET name = 'Travel & Stay (Sales)'
WHERE name = 'Travel & Stay(Sales)';

COMMIT;