-- Roll back self-claim on-behalf NULL backfill.
-- Safety scope: only rows where BOTH on-behalf fields are NULL.

UPDATE public.claims
SET
  on_behalf_email = 'N/A',
  on_behalf_employee_code = 'N/A'
WHERE submission_type = 'Self'
  AND on_behalf_email IS NULL
  AND on_behalf_employee_code IS NULL;
