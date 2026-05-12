-- Rollback for: 20260511100000_create_program_product_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

DROP TABLE IF EXISTS public.master_program_product_mappings;

COMMIT;