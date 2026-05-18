-- Backfill legacy self-claim placeholder values to NULL.
-- Safety scope: only rows where BOTH on-behalf fields are exactly 'N/A'.

UPDATE public.claims
SET
  on_behalf_email = NULL,
  on_behalf_employee_code = NULL
WHERE submission_type = 'Self'
  AND on_behalf_email = 'N/A'
  AND on_behalf_employee_code = 'N/A';
