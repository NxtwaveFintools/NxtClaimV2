-- Rollback for: 20260615090000_employee_drilldown_rpcs.sql
-- Drops the two employee drill-down RPCs added for the Analytics Command Center.
-- Both functions are net-new (no prior version to restore).

BEGIN;

DROP FUNCTION IF EXISTS public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_employee_claim_detail(TEXT, UUID[], DATE, DATE, TEXT, UUID, UUID);

COMMIT;
