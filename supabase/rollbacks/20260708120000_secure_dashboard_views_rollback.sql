-- Rollback for 20260708120000_secure_dashboard_views.sql
-- Reverts both dashboard views to SECURITY DEFINER (security_invoker = off).
-- Do NOT run this unless the security_invoker migration causes a verified
-- regression in the dashboards — it re-opens the RLS bypass on both views.

ALTER VIEW public.vw_enterprise_claims_dashboard SET (security_invoker = off);
ALTER VIEW public.vw_admin_claims_dashboard      SET (security_invoker = off);
