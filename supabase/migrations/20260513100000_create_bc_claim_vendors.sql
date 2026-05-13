BEGIN;

CREATE TABLE IF NOT EXISTS public.bc_claim_vendors (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id       TEXT        NOT NULL,
  bc_vendor_id   TEXT        NOT NULL,
  bc_vendor_name TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bc_claim_vendors_claim_id_fkey
    FOREIGN KEY (claim_id)
    REFERENCES public.claims (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bc_claim_vendors_claim_id
  ON public.bc_claim_vendors(claim_id);

CREATE OR REPLACE FUNCTION public.bc_claim_vendors_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bc_claim_vendors_set_updated_at
  ON public.bc_claim_vendors;

CREATE TRIGGER trg_bc_claim_vendors_set_updated_at
BEFORE UPDATE ON public.bc_claim_vendors
FOR EACH ROW
EXECUTE FUNCTION public.bc_claim_vendors_set_updated_at();

ALTER TABLE public.bc_claim_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bc_claim_vendors_authenticated_all"
  ON public.bc_claim_vendors
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.bc_claim_vendors TO anon;
GRANT ALL ON TABLE public.bc_claim_vendors TO authenticated;
GRANT ALL ON TABLE public.bc_claim_vendors TO service_role;

COMMIT;