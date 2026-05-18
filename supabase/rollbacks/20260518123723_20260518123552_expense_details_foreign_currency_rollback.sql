-- Rollback for 20260518123723_..._expense_details_foreign_currency.
-- Reverses the schema additions in reverse order:
--   * drop generated foreign_total_amount column
--   * drop CHECK constraint on foreign_gst_amount
--   * drop foreign_basic_amount / foreign_gst_amount / foreign_currency_code
--   * revert currency_code from local_currency_code enum back to TEXT
--   * drop both enum types
-- Note: the backfill performed at Step 5 of the forward migration cannot
-- be reversed (we have no record of the prior NULLs vs 'INR' text values).

BEGIN;

ALTER TABLE public.expense_details
  DROP COLUMN IF EXISTS foreign_total_amount;

ALTER TABLE public.expense_details
  DROP CONSTRAINT IF EXISTS expense_details_foreign_gst_nonneg_check;

ALTER TABLE public.expense_details
  DROP COLUMN IF EXISTS foreign_basic_amount,
  DROP COLUMN IF EXISTS foreign_gst_amount,
  DROP COLUMN IF EXISTS foreign_currency_code;

-- Revert currency_code from enum back to text.
ALTER TABLE public.expense_details
  ALTER COLUMN currency_code DROP DEFAULT;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code TYPE text
  USING currency_code::text;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code SET DEFAULT 'INR'::text;

DROP TYPE IF EXISTS public.foreign_currency_code;
DROP TYPE IF EXISTS public.local_currency_code;

COMMIT;
