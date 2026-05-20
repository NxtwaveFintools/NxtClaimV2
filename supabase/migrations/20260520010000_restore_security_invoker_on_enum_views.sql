-- Migration 20260520000000_claim_submission_type_enum.sql dropped + recreated
-- vw_admin_claims_dashboard and vw_enterprise_claims_dashboard using CREATE VIEW
-- without the WITH (security_invoker = 'on') option, silently undoing the fix
-- from 20260519110000_restore_view_security_invoker.sql.
--
-- This migration restores security_invoker on the live views in NxtClaimTest.
-- Future fresh DB restores already have the option baked into 20260520000000
-- (amended in the same commit as this migration).

ALTER VIEW public.vw_admin_claims_dashboard SET (security_invoker = on);
ALTER VIEW public.vw_enterprise_claims_dashboard SET (security_invoker = on);
