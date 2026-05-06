BEGIN;

-- Rename 'Car Lease' to 'Employee Car Lease' to match the official BC chart of accounts name.
-- Wrapped in a no-op guard so re-applying this migration is safe.
UPDATE public.master_expense_categories
SET name = 'Employee Car Lease'
WHERE name = 'Car Lease';

-- Create the new mapping table that links each expense category to its
-- BC (Business Central) accounting code.  bc_code is nullable so future
-- categories can be added before their code is confirmed.
CREATE TABLE IF NOT EXISTS public.expense_category_bc_mappings (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_category_id  UUID        NOT NULL
                         REFERENCES public.master_expense_categories (id)
                         ON DELETE CASCADE,
  bc_code              VARCHAR(20),
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_expense_category_bc UNIQUE (expense_category_id)
);

COMMIT;
