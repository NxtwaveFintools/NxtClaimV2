-- Backfill existing Petty Cash Request claim IDs from CLAIM-... to EA-...
-- Scope: all matching rows, including inactive historical claims.
-- Safety:
-- 1) collision precheck prevents accidental overwrite if target EA IDs already exist
-- 2) child-table foreign keys are temporarily dropped and recreated because
--    ON UPDATE CASCADE is not enabled on claim_id references

begin;

create temporary table tmp_petty_cash_request_claim_id_map (
  old_claim_id text primary key,
  new_claim_id text not null unique
) on commit drop;

insert into tmp_petty_cash_request_claim_id_map (old_claim_id, new_claim_id)
select
  c.id as old_claim_id,
  regexp_replace(c.id, '^CLAIM-', 'EA-') as new_claim_id
from public.claims c
join public.master_payment_modes mpm
  on mpm.id = c.payment_mode_id
where lower(trim(mpm.name)) = 'petty cash request'
  and c.id like 'CLAIM-%';

do $$
declare
  v_conflict_count integer;
begin
  select count(*)
  into v_conflict_count
  from tmp_petty_cash_request_claim_id_map m
  join public.claims c
    on c.id = m.new_claim_id
   and c.id <> m.old_claim_id;

  if v_conflict_count > 0 then
    raise exception 'Backfill aborted: % generated EA claim IDs already exist.', v_conflict_count;
  end if;
end
$$;

do $$
declare
  v_fk record;
begin
  if not exists (select 1 from tmp_petty_cash_request_claim_id_map) then
    return;
  end if;

  for v_fk in
    select
      c.conname,
      n.nspname,
      cls.relname
    from pg_constraint c
    join pg_class cls
      on cls.oid = c.conrelid
    join pg_namespace n
      on n.oid = cls.relnamespace
    where c.contype = 'f'
      and c.confrelid = 'public.claims'::regclass
      and c.conrelid in (
        'public.expense_details'::regclass,
        'public.advance_details'::regclass,
        'public.claim_audit_logs'::regclass,
        'public.claims_analytics_snapshot'::regclass
      )
  loop
    execute format(
      'alter table %I.%I drop constraint %I',
      v_fk.nspname,
      v_fk.relname,
      v_fk.conname
    );
  end loop;
end
$$;

-- Update analytics snapshot first to avoid duplicate key contention on new IDs
-- when claims update triggers refresh logic.
update public.claims_analytics_snapshot s
set claim_id = m.new_claim_id
from tmp_petty_cash_request_claim_id_map m
where s.claim_id = m.old_claim_id;

update public.claims c
set id = m.new_claim_id
from tmp_petty_cash_request_claim_id_map m
where c.id = m.old_claim_id;

update public.expense_details e
set claim_id = m.new_claim_id
from tmp_petty_cash_request_claim_id_map m
where e.claim_id = m.old_claim_id;

update public.advance_details a
set claim_id = m.new_claim_id
from tmp_petty_cash_request_claim_id_map m
where a.claim_id = m.old_claim_id;

update public.claim_audit_logs l
set claim_id = m.new_claim_id
from tmp_petty_cash_request_claim_id_map m
where l.claim_id = m.old_claim_id;

do $$
begin
  if not exists (select 1 from tmp_petty_cash_request_claim_id_map) then
    return;
  end if;

  alter table public.expense_details
    add constraint expense_details_claim_id_fkey
    foreign key (claim_id) references public.claims(id) on delete restrict;

  alter table public.advance_details
    add constraint advance_details_claim_id_fkey
    foreign key (claim_id) references public.claims(id) on delete restrict;

  alter table public.claim_audit_logs
    add constraint claim_audit_logs_claim_id_fkey
    foreign key (claim_id) references public.claims(id);

  alter table public.claims_analytics_snapshot
    add constraint claims_analytics_snapshot_claim_id_fkey
    foreign key (claim_id) references public.claims(id) on delete cascade;
end
$$;

commit;

-- Rollback guidance (manual):
-- 1) restore IDs by reversing EA- -> CLAIM- for rows linked to payment mode 'Petty Cash Request'
-- 2) apply the same child-table mapping reversal within a transaction
-- 3) re-run integrity checks on claim_id references before re-enabling writes
