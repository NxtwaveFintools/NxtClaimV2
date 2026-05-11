-- Rollback for: 20260511104000_sync_master_locations_for_expense_location_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

UPDATE public.master_locations
SET
  is_active = false,
  updated_at = now()
WHERE name IN (
  'Presales-Hyderabad',
  'Presales-Indore',
  'Presales-Kochi',
  'NIAT - Alard University',
  'NIAT - Best Innovation University',
  'NIAT - Chaitanya University',
  'NIAT - Chalapathi',
  'NIAT - Geeta University',
  'NIAT - Joy University',
  'NIAT - Sandip University',
  'NIAT - Sansikriti University',
  'NIAT - Scope Global Skill University',
  'NIAT - St Peter''s Bengaluru',
  'NIAT - St Peter''s Chennai',
  'NIAT - Sushant University',
  'NIAT - Yenepoya University - Bengaluru'
);

COMMIT;