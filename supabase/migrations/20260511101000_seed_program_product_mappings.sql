BEGIN;

DO $$
DECLARE
  missing_products TEXT[];
BEGIN
  WITH requested_mappings(program_code, product_name) AS (
    VALUES
      ('CCBP 4.0 ACADEMY', 'Academy Online'),
      ('CCBP 4.0 ACADEMY', 'Academy College Plus'),
      ('INTENSIVE 3.0', 'Intensive Online'),
      ('INTENSIVE OFFLINE', 'Intensive Offline'),
      ('INTENSIVE 3.0', 'Intensive College Plus'),
      ('NIAT', 'NIAT Batch 2023'),
      ('NIAT', 'NIAT Batch 2024'),
      ('NIAT', 'NIAT Batch 2025'),
      ('NIAT', 'NIAT Batch 2026'),
      ('NIAT', 'NIAT Application'),
      ('NIAT', 'NIAT DS Transport'),
      ('NXTWAVE ABROAD', 'NxtWave Abroad Service'),
      ('NXTWAVE ABROAD', 'NxtWave Abroad Commission'),
      ('TOPIN.TECH', 'Topin.tech'),
      ('COMMON', 'Common'),
      ('NIFA', 'NIFA')
  )
  SELECT array_agg(requested_mappings.product_name ORDER BY requested_mappings.product_name)
  INTO missing_products
  FROM requested_mappings
  LEFT JOIN public.master_products
    ON public.master_products.name = requested_mappings.product_name
  WHERE public.master_products.id IS NULL;

  IF missing_products IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot seed master_program_product_mappings. Missing master_products rows: %',
      array_to_string(missing_products, ', ');
  END IF;
END;
$$;

WITH requested_mappings(program_code, product_name) AS (
  VALUES
    ('CCBP 4.0 ACADEMY', 'Academy Online'),
    ('CCBP 4.0 ACADEMY', 'Academy College Plus'),
    ('INTENSIVE 3.0', 'Intensive Online'),
    ('INTENSIVE OFFLINE', 'Intensive Offline'),
    ('INTENSIVE 3.0', 'Intensive College Plus'),
    ('NIAT', 'NIAT Batch 2023'),
    ('NIAT', 'NIAT Batch 2024'),
    ('NIAT', 'NIAT Batch 2025'),
    ('NIAT', 'NIAT Batch 2026'),
    ('NIAT', 'NIAT Application'),
    ('NIAT', 'NIAT DS Transport'),
    ('NXTWAVE ABROAD', 'NxtWave Abroad Service'),
    ('NXTWAVE ABROAD', 'NxtWave Abroad Commission'),
    ('TOPIN.TECH', 'Topin.tech'),
    ('COMMON', 'Common'),
    ('NIFA', 'NIFA')
),
resolved_mappings AS (
  SELECT
    requested_mappings.program_code,
    public.master_products.id AS product_id
  FROM requested_mappings
  INNER JOIN public.master_products
    ON public.master_products.name = requested_mappings.product_name
)
INSERT INTO public.master_program_product_mappings (
  program_code,
  product_id,
  is_active
)
SELECT
  resolved_mappings.program_code,
  resolved_mappings.product_id,
  true
FROM resolved_mappings
ON CONFLICT (program_code, product_id)
DO UPDATE
SET is_active = true;

COMMIT;