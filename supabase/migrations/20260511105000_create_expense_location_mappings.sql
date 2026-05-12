BEGIN;

CREATE TABLE IF NOT EXISTS public.master_expense_location_mappings (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID        NOT NULL
                REFERENCES public.master_locations (id)
                ON DELETE RESTRICT,
  region_code TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_master_expense_location_mapping UNIQUE (location_id, region_code)
);

ALTER TABLE public.master_expense_location_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_expense_location_mappings_select_authenticated"
  ON public.master_expense_location_mappings
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "master_expense_location_mappings_insert_admin"
  ON public.master_expense_location_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "master_expense_location_mappings_update_admin"
  ON public.master_expense_location_mappings
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

GRANT ALL ON TABLE public.master_expense_location_mappings TO anon;
GRANT ALL ON TABLE public.master_expense_location_mappings TO authenticated;
GRANT ALL ON TABLE public.master_expense_location_mappings TO service_role;

COMMIT;