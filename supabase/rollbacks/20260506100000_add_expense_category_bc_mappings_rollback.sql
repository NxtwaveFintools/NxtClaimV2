-- Rollback for: 20260506100000_add_expense_category_bc_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

-- Drop triggers before dropping the table they reference.
DROP TRIGGER IF EXISTS trg_sync_bc_mapping_on_category_deactivate
  ON public.master_expense_categories;

DROP TRIGGER IF EXISTS trg_sync_category_on_bc_mapping_deactivate
  ON public.expense_category_bc_mappings;

DROP FUNCTION IF EXISTS public.sync_bc_mapping_active_from_category();
DROP FUNCTION IF EXISTS public.sync_category_active_from_bc_mapping();

DROP TABLE IF EXISTS public.expense_category_bc_mappings;

-- Restore original category name.
UPDATE public.master_expense_categories
SET name = 'Car Lease'
WHERE name = 'Employee Car Lease';

COMMIT;
