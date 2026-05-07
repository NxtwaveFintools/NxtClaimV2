BEGIN;

-- Roll back BC account-code seeding from 20260507103000_seed_expense_category_bc_mappings.sql.
WITH target_categories(name) AS (
  VALUES
    ('Food'),
    ('Accommodation Domestic'),
    ('Accommodation Overseas'),
    ('Fuel Expense'),
    ('Travel Domestic'),
    ('Travel Overseas'),
    ('Local Subscription'),
    ('Overseas Subscription'),
    ('Repairs & Maintenance - Office'),
    ('Repairs & Maintenance - Electronic Equipment'),
    ('Postal Charges'),
    ('Printing & Stationery'),
    ('Team outing'),
    ('Miscellaneous expenses'),
    ('Offline Marketing'),
    ('Other Staff Welfare'),
    ('Rates & Taxes'),
    ('Internet Expense'),
    ('Brand Promotion'),
    ('Other Professional charges'),
    ('Training & Conference'),
    ('Employee Car Lease')
)
UPDATE public.expense_category_bc_mappings m
SET
  bc_code = NULL,
  is_active = false
FROM public.master_expense_categories c
JOIN target_categories t
  ON t.name = c.name
WHERE m.expense_category_id = c.id;

COMMIT;
