-- Rollback for: 20260512130000_add_beneficiary_department_code.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

WITH exception_departments(department_name, restored_responsible_department_code) AS (
  VALUES
    ('Human Resource', 'HR-ADMIN FACILITIES'),
    ('Travel & Stay (Sales)', 'HR-OPR & PAYROLL')
)
UPDATE public.master_department_responsible_mappings AS mappings
SET responsible_department_code = exception_departments.restored_responsible_department_code
FROM exception_departments
INNER JOIN public.master_departments
  ON public.master_departments.name = exception_departments.department_name
WHERE mappings.department_id = public.master_departments.id
  AND mappings.responsible_department_code = 'HR-OPR PAYROLL'
  AND mappings.beneficiary_department_code = 'HR-OPR & PAYROLL';

ALTER TABLE public.master_department_responsible_mappings
  DROP COLUMN beneficiary_department_code;

COMMIT;