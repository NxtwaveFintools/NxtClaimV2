BEGIN;

-- Sync BC (Business Central) account code mappings for expense categories.
-- This is idempotent and avoids hard deletes to preserve master-data history.
WITH cats AS (
  SELECT id, name
  FROM public.master_expense_categories
)
INSERT INTO public.expense_category_bc_mappings (
  expense_category_id,
  bc_code,
  is_active
)
SELECT
  cats.id,
  CASE cats.name
    WHEN 'Food' THEN '503063'
    WHEN 'Accommodation Domestic' THEN '535004'
    WHEN 'Accommodation Overseas' THEN '535005'
    WHEN 'Fuel Expense' THEN '535002'
    WHEN 'Travel Domestic' THEN '535001'
    WHEN 'Travel Overseas' THEN '535003'
    WHEN 'Local Subscription' THEN '533501'
    WHEN 'Overseas Subscription' THEN '533502'
    WHEN 'Repairs & Maintenance - Office' THEN '533401'
    WHEN 'Repairs & Maintenance - Electronic Equipment' THEN '533402'
    WHEN 'Postal Charges' THEN '536011'
    WHEN 'Printing & Stationery' THEN '536012'
    WHEN 'Team outing' THEN '503067'
    WHEN 'Miscellaneous expenses' THEN '536007'
    WHEN 'Offline Marketing' THEN '505118'
    WHEN 'Other Staff Welfare' THEN '503065'
    WHEN 'Rates & Taxes' THEN '532504'
    WHEN 'Internet Expense' THEN '530097'
    WHEN 'Brand Promotion' THEN '505121'
    WHEN 'Other Professional charges' THEN '505005'
    WHEN 'Training & Conference' THEN '503066'
    WHEN 'Employee Car Lease' THEN '503008'
    ELSE NULL
  END,
  true
FROM cats
ON CONFLICT (expense_category_id)
DO UPDATE
SET
  bc_code = EXCLUDED.bc_code,
  is_active = true;

COMMIT;
