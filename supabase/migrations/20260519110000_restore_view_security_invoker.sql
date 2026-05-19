-- Restore SECURITY INVOKER on dashboard views.
-- Migration 20260518063735_simplify_amount_columns recreated these views without
-- the `WITH (security_invoker = on)` option, defaulting them to SECURITY DEFINER.
-- That made the views run with owner (postgres) privileges and bypass RLS on the
-- underlying tables, flagged by Supabase advisors as publicly-accessible data.

ALTER VIEW public.vw_admin_claims_dashboard      SET (security_invoker = on);
ALTER VIEW public.vw_enterprise_claims_dashboard SET (security_invoker = on);
