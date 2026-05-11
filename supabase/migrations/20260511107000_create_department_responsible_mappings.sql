BEGIN;

CREATE TABLE IF NOT EXISTS public.master_department_responsible_mappings (
  id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id               UUID        NOT NULL
                                REFERENCES public.master_departments (id)
                                ON DELETE RESTRICT,
  responsible_department_code TEXT        NOT NULL,
  is_active                   BOOLEAN     NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_master_department_responsible_mapping
    UNIQUE (department_id, responsible_department_code)
);

COMMENT ON TABLE public.master_department_responsible_mappings IS
  'Maps internal departments to responsible department codes for downstream reporting and integrations.';

ALTER TABLE public.master_department_responsible_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_department_responsible_mappings_select_authenticated"
  ON public.master_department_responsible_mappings
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "master_department_responsible_mappings_insert_admin"
  ON public.master_department_responsible_mappings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "master_department_responsible_mappings_update_admin"
  ON public.master_department_responsible_mappings
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

GRANT ALL ON TABLE public.master_department_responsible_mappings TO anon;
GRANT ALL ON TABLE public.master_department_responsible_mappings TO authenticated;
GRANT ALL ON TABLE public.master_department_responsible_mappings TO service_role;

COMMIT;