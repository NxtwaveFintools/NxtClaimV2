-- Rollback for: 20260511102000_create_sub_product_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

DROP TABLE IF EXISTS public.master_sub_product_mappings;

COMMIT;