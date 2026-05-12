-- Rollback for: 20260511101000_seed_program_product_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

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
UPDATE public.master_program_product_mappings
SET is_active = false
FROM resolved_mappings
WHERE public.master_program_product_mappings.program_code = resolved_mappings.program_code
  AND public.master_program_product_mappings.product_id = resolved_mappings.product_id;

COMMIT;