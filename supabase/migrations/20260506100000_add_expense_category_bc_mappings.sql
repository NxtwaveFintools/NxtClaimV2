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

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- Mirrors the policy pattern on master_expense_categories:
--   SELECT  → any authenticated user, but only active rows
--   INSERT  → admin only
--   UPDATE  → admin only
--   DELETE  → no policy (soft delete via is_active only)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.expense_category_bc_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_category_bc_mappings_select_authenticated"
  ON public.expense_category_bc_mappings
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "expense_category_bc_mappings_insert_admin"
  ON public.expense_category_bc_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "expense_category_bc_mappings_update_admin"
  ON public.expense_category_bc_mappings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

-- Grants: align with the pattern used on all other master_* tables.
GRANT ALL ON TABLE public.expense_category_bc_mappings TO anon;
GRANT ALL ON TABLE public.expense_category_bc_mappings TO authenticated;
GRANT ALL ON TABLE public.expense_category_bc_mappings TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bi-directional is_active sync triggers
--
-- Rule: deactivating a row in either table must deactivate the paired row in
-- the other table.  Both triggers are AFTER UPDATE and only fire when
-- is_active actually changes to FALSE, avoiding infinite loops.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Category deactivated → deactivate its BC mapping row.
CREATE OR REPLACE FUNCTION public.sync_bc_mapping_active_from_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_active = false AND OLD.is_active = true THEN
    UPDATE public.expense_category_bc_mappings
    SET    is_active = false
    WHERE  expense_category_id = NEW.id
      AND  is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bc_mapping_on_category_deactivate
  ON public.master_expense_categories;

CREATE TRIGGER trg_sync_bc_mapping_on_category_deactivate
AFTER UPDATE OF is_active ON public.master_expense_categories
FOR EACH ROW
EXECUTE FUNCTION public.sync_bc_mapping_active_from_category();

-- 2. BC mapping deactivated → deactivate the parent category row.
CREATE OR REPLACE FUNCTION public.sync_category_active_from_bc_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_active = false AND OLD.is_active = true THEN
    UPDATE public.master_expense_categories
    SET    is_active = false
    WHERE  id = NEW.expense_category_id
      AND  is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_category_on_bc_mapping_deactivate
  ON public.expense_category_bc_mappings;

CREATE TRIGGER trg_sync_category_on_bc_mapping_deactivate
AFTER UPDATE OF is_active ON public.expense_category_bc_mappings
FOR EACH ROW
EXECUTE FUNCTION public.sync_category_active_from_bc_mapping();

COMMIT;
