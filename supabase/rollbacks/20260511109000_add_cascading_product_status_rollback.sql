-- Rollback for: 20260511109000_add_cascading_product_status.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

DROP TRIGGER IF EXISTS trg_sync_product_mapping_status
  ON public.master_products;

DROP FUNCTION IF EXISTS public.sync_product_mapping_status();

UPDATE public.master_products
SET is_active = true
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