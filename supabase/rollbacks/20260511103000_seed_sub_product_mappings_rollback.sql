-- Rollback for: 20260511103000_seed_sub_product_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

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
UPDATE public.master_sub_product_mappings
SET is_active = false
FROM resolved_mappings
WHERE public.master_sub_product_mappings.sub_product_code = resolved_mappings.sub_product_code
  AND public.master_sub_product_mappings.product_id = resolved_mappings.product_id;

COMMIT;