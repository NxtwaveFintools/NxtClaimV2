-- Rollback: expand_foreign_currency_codes
-- Postgres cannot drop enum values; recreate the narrow type instead.
-- SAFE ONLY when no expense_details row uses a code outside the original four —
-- the guard below aborts otherwise.

DO $$
DECLARE
  offending_count bigint;
BEGIN
  SELECT count(*)
    INTO offending_count
    FROM public.expense_details
   WHERE foreign_currency_code::text NOT IN ('INR', 'USD', 'EUR', 'CHF');

  IF offending_count > 0 THEN
    RAISE EXCEPTION
      'Cannot roll back foreign_currency_code expansion: % row(s) use expanded codes',
      offending_count;
  END IF;
END
$$;

ALTER TABLE public.expense_details
  ALTER COLUMN foreign_currency_code DROP DEFAULT;

ALTER TYPE public.foreign_currency_code RENAME TO foreign_currency_code_expanded;

CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');

ALTER TABLE public.expense_details
  ALTER COLUMN foreign_currency_code
  TYPE public.foreign_currency_code
  USING foreign_currency_code::text::public.foreign_currency_code;

ALTER TABLE public.expense_details
  ALTER COLUMN foreign_currency_code
  SET DEFAULT 'INR'::public.foreign_currency_code;

DROP TYPE public.foreign_currency_code_expanded;
