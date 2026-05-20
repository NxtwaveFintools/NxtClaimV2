-- Pin search_path on the four BC SECURITY DEFINER functions. Without an
-- explicit search_path a SECURITY DEFINER function runs with the caller's
-- search_path, which lets a caller shadow unqualified references via a
-- malicious schema. We set "public, pg_temp": public is required because
-- get_bc_claim_payload casts to the unqualified type claim_submission_type
-- (resolved via public), and pg_temp is pinned LAST so temp objects can't
-- shadow real ones. The function bodies are unchanged (ALTER, not recreate).

ALTER FUNCTION public.get_bc_claim_payload(text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.start_bc_claim_attempt(text, boolean, jsonb)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.complete_bc_claim(uuid, uuid, jsonb)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.record_bc_claim_failure(uuid, uuid, jsonb)
  SET search_path = public, pg_temp;
