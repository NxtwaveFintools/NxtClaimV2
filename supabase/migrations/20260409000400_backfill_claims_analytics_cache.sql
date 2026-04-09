-- Performance: Backfill analytics cache from canonical claim tables.

create or replace function public.rebuild_claims_analytics_cache()
returns void
language plpgsql
as $$
declare
  v_claim_id text;
begin
  truncate table public.claims_analytics_daily_stats;
  truncate table public.claims_analytics_snapshot;

  for v_claim_id in
    select id
    from public.claims
    where is_active = true
  loop
    perform public.refresh_claim_analytics_snapshot(v_claim_id);
  end loop;
end;
$$;

select public.rebuild_claims_analytics_cache();

-- Rollback (manual)
-- drop function if exists public.rebuild_claims_analytics_cache();
