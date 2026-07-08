-- Supabase security linter flagged both dashboard views as SECURITY DEFINER
-- (security_definer_view, ERROR). This is the third time these views have
-- lost security_invoker: 20260519110000 and 20260520010000 fixed it before,
-- but 20260618070536 recreated both views with CREATE OR REPLACE VIEW and
-- no WITH (security_invoker = on) option, silently reintroducing the bypass.

ALTER VIEW public.vw_enterprise_claims_dashboard SET (security_invoker = on);
ALTER VIEW public.vw_admin_claims_dashboard      SET (security_invoker = on);
