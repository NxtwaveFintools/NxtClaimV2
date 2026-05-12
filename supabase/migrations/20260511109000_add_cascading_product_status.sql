BEGIN;

ALTER TABLE public.master_products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.master_program_product_mappings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.master_sub_product_mappings
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.sync_product_mapping_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    UPDATE public.master_program_product_mappings
    SET is_active = NEW.is_active
    WHERE product_id = NEW.id
      AND is_active IS DISTINCT FROM NEW.is_active;

    UPDATE public.master_sub_product_mappings
    SET is_active = NEW.is_active
    WHERE product_id = NEW.id
      AND is_active IS DISTINCT FROM NEW.is_active;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_product_mapping_status() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_sync_product_mapping_status
  ON public.master_products;

CREATE TRIGGER trg_sync_product_mapping_status
AFTER UPDATE OF is_active ON public.master_products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_mapping_status();

DO $$
DECLARE
  missing_products TEXT[];
BEGIN
  WITH requested_products(product_name) AS (
    VALUES
      ('NIAT Application'),
      ('NIAT DS Transport'),
      ('NxtWave Abroad Service'),
      ('NxtWave Abroad Commission'),
      ('NIFA')
  )
  SELECT array_agg(requested_products.product_name ORDER BY requested_products.product_name)
  INTO missing_products
  FROM requested_products
  LEFT JOIN public.master_products
    ON public.master_products.name = requested_products.product_name
  WHERE public.master_products.id IS NULL;

  IF missing_products IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot deactivate master_products. Missing rows: %',
      array_to_string(missing_products, ', ');
  END IF;
END;
$$;

UPDATE public.master_products
SET is_active = false
WHERE name IN (
  'NIAT Application',
  'NIAT DS Transport',
  'NxtWave Abroad Service',
  'NxtWave Abroad Commission',
  'NIFA'
);

WITH target_products AS (
  SELECT id, is_active
  FROM public.master_products
  WHERE name IN (
    'NIAT Application',
    'NIAT DS Transport',
    'NxtWave Abroad Service',
    'NxtWave Abroad Commission',
    'NIFA'
  )
)
UPDATE public.master_program_product_mappings
SET is_active = target_products.is_active
FROM target_products
WHERE public.master_program_product_mappings.product_id = target_products.id
  AND public.master_program_product_mappings.is_active IS DISTINCT FROM target_products.is_active;

WITH target_products AS (
  SELECT id, is_active
  FROM public.master_products
  WHERE name IN (
    'NIAT Application',
    'NIAT DS Transport',
    'NxtWave Abroad Service',
    'NxtWave Abroad Commission',
    'NIFA'
  )
)
UPDATE public.master_sub_product_mappings
SET is_active = target_products.is_active
FROM target_products
WHERE public.master_sub_product_mappings.product_id = target_products.id
  AND public.master_sub_product_mappings.is_active IS DISTINCT FROM target_products.is_active;

COMMIT;