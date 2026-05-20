-- Lock down the BC SECURITY DEFINER functions so only service_role (used by
-- the edge functions) may execute them. They were executable by anon and
-- authenticated via Supabase defaults; because they are SECURITY DEFINER they
-- bypass RLS, so anon/authenticated execute access could expose claim data.
-- No app-side code calls these as anon/authenticated (only the edge functions
-- via the service-role key), so revoking is safe.

REVOKE EXECUTE ON FUNCTION public.get_bc_claim_payload(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_bc_claim_payload(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.start_bc_claim_attempt(text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.start_bc_claim_attempt(text, boolean, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_bc_claim(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_bc_claim(uuid, uuid, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_bc_claim_failure(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_bc_claim_failure(uuid, uuid, jsonb) TO service_role;
