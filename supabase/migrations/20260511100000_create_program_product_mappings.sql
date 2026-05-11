BEGIN;

-- Create the master mapping table that links external program codes to
-- existing NxtClaim products. A single program code may map to multiple
-- products, but duplicate pairs are forbidden.
CREATE TABLE IF NOT EXISTS public.master_program_product_mappings (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  program_code TEXT        NOT NULL,
  product_id   UUID        NOT NULL
                 REFERENCES public.master_products (id)
                 ON DELETE RESTRICT,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_program_product_mapping UNIQUE (program_code, product_id)
);

ALTER TABLE public.master_program_product_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_program_product_mappings_select_authenticated"
  ON public.master_program_product_mappings
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "master_program_product_mappings_insert_admin"
  ON public.master_program_product_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "master_program_product_mappings_update_admin"
  ON public.master_program_product_mappings
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

GRANT ALL ON TABLE public.master_program_product_mappings TO anon;
GRANT ALL ON TABLE public.master_program_product_mappings TO authenticated;
GRANT ALL ON TABLE public.master_program_product_mappings TO service_role;

COMMIT;