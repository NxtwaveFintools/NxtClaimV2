BEGIN;

DO $$
DECLARE
  missing_products TEXT[];
  resolved_mapping_count INTEGER;
  expected_mapping_count CONSTANT INTEGER := 16;
BEGIN
  WITH requested_mappings(sub_product_code, product_name) AS (
    VALUES
      ('AO107', 'Academy Online'),
      ('ACP202', 'Academy College Plus'),
      ('IO253', 'Intensive Online'),
      ('IO256', 'Intensive Offline'),
      ('ICP302', 'Intensive College Plus'),
      ('NIAT354', 'NIAT Batch 2023'),
      ('NIAT354', 'NIAT Batch 2024'),
      ('NIAT362', 'NIAT Batch 2025'),
      ('NIAT362', 'NIAT Batch 2026'),
      ('NIAT355', 'NIAT Application'),
      ('NIAT356', 'NIAT DS Transport'),
      ('NWA401', 'NxtWave Abroad Service'),
      ('NWA402', 'NxtWave Abroad Commission'),
      ('TOPIN452', 'Topin.tech'),
      ('COMMON', 'Common'),
      ('NFA100', 'NIFA')
  )
  SELECT array_agg(requested_mappings.product_name ORDER BY requested_mappings.product_name)
  INTO missing_products
  FROM requested_mappings
  LEFT JOIN public.master_products
    ON public.master_products.name = requested_mappings.product_name
  WHERE public.master_products.id IS NULL;

  IF missing_products IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot seed master_sub_product_mappings. Missing master_products rows: %',
      array_to_string(missing_products, ', ');
  END IF;

  WITH requested_mappings(sub_product_code, product_name) AS (
    VALUES
      ('AO107', 'Academy Online'),
      ('ACP202', 'Academy College Plus'),
      ('IO253', 'Intensive Online'),
      ('IO256', 'Intensive Offline'),
      ('ICP302', 'Intensive College Plus'),
      ('NIAT354', 'NIAT Batch 2023'),
      ('NIAT354', 'NIAT Batch 2024'),
      ('NIAT362', 'NIAT Batch 2025'),
      ('NIAT362', 'NIAT Batch 2026'),
      ('NIAT355', 'NIAT Application'),
      ('NIAT356', 'NIAT DS Transport'),
      ('NWA401', 'NxtWave Abroad Service'),
      ('NWA402', 'NxtWave Abroad Commission'),
      ('TOPIN452', 'Topin.tech'),
      ('COMMON', 'Common'),
      ('NFA100', 'NIFA')
  ),
  resolved_mappings AS (
    SELECT
      requested_mappings.sub_product_code,
      public.master_products.id AS product_id
    FROM requested_mappings
    INNER JOIN public.master_products
      ON public.master_products.name = requested_mappings.product_name
  )
  SELECT COUNT(*)
  INTO resolved_mapping_count
  FROM resolved_mappings;

  IF resolved_mapping_count <> expected_mapping_count THEN
    RAISE EXCEPTION
      'Cannot seed master_sub_product_mappings. Expected % resolved mappings but found %.',
      expected_mapping_count,
      resolved_mapping_count;
  END IF;
END;
$$;

WITH requested_mappings(sub_product_code, product_name) AS (
  VALUES
    ('AO107', 'Academy Online'),
    ('ACP202', 'Academy College Plus'),
    ('IO253', 'Intensive Online'),
    ('IO256', 'Intensive Offline'),
    ('ICP302', 'Intensive College Plus'),
    ('NIAT354', 'NIAT Batch 2023'),
    ('NIAT354', 'NIAT Batch 2024'),
    ('NIAT362', 'NIAT Batch 2025'),
    ('NIAT362', 'NIAT Batch 2026'),
    ('NIAT355', 'NIAT Application'),
    ('NIAT356', 'NIAT DS Transport'),
    ('NWA401', 'NxtWave Abroad Service'),
    ('NWA402', 'NxtWave Abroad Commission'),
    ('TOPIN452', 'Topin.tech'),
    ('COMMON', 'Common'),
    ('NFA100', 'NIFA')
),
resolved_mappings AS (
  SELECT
    requested_mappings.sub_product_code,
    public.master_products.id AS product_id
  FROM requested_mappings
  INNER JOIN public.master_products
    ON public.master_products.name = requested_mappings.product_name
)
INSERT INTO public.master_sub_product_mappings (
  sub_product_code,
  product_id,
  is_active
)
SELECT
  resolved_mappings.sub_product_code,
  resolved_mappings.product_id,
  true
FROM resolved_mappings
ON CONFLICT (sub_product_code, product_id)
DO UPDATE
SET is_active = true;

COMMIT;