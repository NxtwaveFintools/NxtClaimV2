BEGIN;

ALTER TABLE public.master_department_responsible_mappings
  ADD COLUMN beneficiary_department_code TEXT;

UPDATE public.master_department_responsible_mappings
SET beneficiary_department_code = responsible_department_code;

UPDATE public.master_department_responsible_mappings
SET
  responsible_department_code = 'HR-OPR PAYROLL',
  beneficiary_department_code = 'HR-OPR & PAYROLL'
WHERE department_id IN (
  SELECT public.master_departments.id
  FROM public.master_departments
  WHERE public.master_departments.name IN ('Human Resource', 'Travel & Stay (Sales)')
);

ALTER TABLE public.master_department_responsible_mappings
  ALTER COLUMN beneficiary_department_code SET NOT NULL;

COMMIT;