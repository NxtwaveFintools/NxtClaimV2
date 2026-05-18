-- Rollback: expense_details_foreign_currency
-- Reverses migration 20260518123552_expense_details_foreign_currency.sql.
-- Drops foreign_* columns, retypes currency_code back to TEXT, drops enums.

-- Reverse order: generated column first, then CHECK, then the three plain columns.
ALTER TABLE public.expense_details
  DROP COLUMN IF EXISTS foreign_total_amount;

ALTER TABLE public.expense_details
  DROP CONSTRAINT IF EXISTS expense_details_foreign_gst_nonneg_check;

ALTER TABLE public.expense_details
  DROP COLUMN IF EXISTS foreign_basic_amount,
  DROP COLUMN IF EXISTS foreign_gst_amount,
  DROP COLUMN IF EXISTS foreign_currency_code;

-- Retype currency_code back to TEXT.
ALTER TABLE public.expense_details
  ALTER COLUMN currency_code DROP DEFAULT;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code TYPE text
  USING currency_code::text;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code SET DEFAULT 'INR'::text;

DROP TYPE IF EXISTS public.foreign_currency_code;
DROP TYPE IF EXISTS public.local_currency_code;
