-- Backfill On Behalf claim IDs so the employee-code segment reflects the beneficiary.
-- Scope: submission_type = 'On Behalf' rows with semantic IDs using CLAIM, EA, or legacy PCR prefixes.
-- Safety:
-- 1) second segment is rebuilt from regex capture groups (no free-form substring replacement)
-- 2) collision precheck aborts if any generated target ID already exists on a different row
-- 3) claim ID child-table foreign keys are temporarily dropped and recreated

begin;

create temporary table tmp_on_behalf_claim_id_map (
  old_claim_id text primary key,
  new_claim_id text not null unique
) on commit drop;

do $$
declare
  v_missing_beneficiary_code_count integer;
  v_empty_sanitized_code_count integer;
begin
  select count(*)
  into v_missing_beneficiary_code_count
  from public.claims c
  cross join lateral regexp_match(
    c.id,
    '^(CLAIM|EA|PCR)-([A-Za-z0-9]+)-([0-9]{8})-([A-Za-z0-9]+)$'
  ) as claim_parts(parts)
  where c.submission_type = 'On Behalf'
    and nullif(trim(c.on_behalf_employee_code), '') is null;

  if v_missing_beneficiary_code_count > 0 then
    raise exception
      'Backfill aborted: % On Behalf claims are missing on_behalf_employee_code.',
      v_missing_beneficiary_code_count;
  end if;

  select count(*)
  into v_empty_sanitized_code_count
  from public.claims c
  cross join lateral regexp_match(
    c.id,
    '^(CLAIM|EA|PCR)-([A-Za-z0-9]+)-([0-9]{8})-([A-Za-z0-9]+)$'
  ) as claim_parts(parts)
  where c.submission_type = 'On Behalf'
    and nullif(trim(c.on_behalf_employee_code), '') is not null
    and upper(regexp_replace(trim(c.on_behalf_employee_code), '[^A-Za-z0-9]+', '', 'g')) = '';

  if v_empty_sanitized_code_count > 0 then
    raise exception
      'Backfill aborted: % On Behalf claims have non-sanitizable beneficiary employee codes.',
      v_empty_sanitized_code_count;
  end if;
end
$$;

insert into tmp_on_behalf_claim_id_map (old_claim_id, new_claim_id)
select
  c.id as old_claim_id,
  concat(
    claim_parts.parts[1],
    '-',
    upper(regexp_replace(trim(c.on_behalf_employee_code), '[^A-Za-z0-9]+', '', 'g')),
    '-',
    claim_parts.parts[3],
    '-',
    claim_parts.parts[4]
  ) as new_claim_id
from public.claims c
cross join lateral regexp_match(
  c.id,
  '^(CLAIM|EA|PCR)-([A-Za-z0-9]+)-([0-9]{8})-([A-Za-z0-9]+)$'
) as claim_parts(parts)
where c.submission_type = 'On Behalf'
  and nullif(trim(c.on_behalf_employee_code), '') is not null
  and upper(regexp_replace(trim(c.on_behalf_employee_code), '[^A-Za-z0-9]+', '', 'g')) <> ''
  and c.id <> concat(
    claim_parts.parts[1],
    '-',
    upper(regexp_replace(trim(c.on_behalf_employee_code), '[^A-Za-z0-9]+', '', 'g')),
    '-',
    claim_parts.parts[3],
    '-',
    claim_parts.parts[4]
  );

do $$
declare
  v_conflict_count integer;
begin
  select count(*)
  into v_conflict_count
  from tmp_on_behalf_claim_id_map m
  join public.claims c
    on c.id = m.new_claim_id
   and c.id <> m.old_claim_id;

  if v_conflict_count > 0 then
    raise exception
      'Backfill aborted: % generated On Behalf claim IDs already exist.',
      v_conflict_count;
  end if;
end
$$;

do $$
declare
  v_fk record;
begin
  if not exists (select 1 from tmp_on_behalf_claim_id_map) then
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

-- Update analytics snapshot first to reduce contention with claims cache refresh logic.
update public.claims_analytics_snapshot s
set claim_id = m.new_claim_id
from tmp_on_behalf_claim_id_map m
where s.claim_id = m.old_claim_id;

update public.claims c
set id = m.new_claim_id
from tmp_on_behalf_claim_id_map m
where c.id = m.old_claim_id;

update public.expense_details e
set claim_id = m.new_claim_id
from tmp_on_behalf_claim_id_map m
where e.claim_id = m.old_claim_id;

update public.advance_details a
set claim_id = m.new_claim_id
from tmp_on_behalf_claim_id_map m
where a.claim_id = m.old_claim_id;

update public.claim_audit_logs l
set claim_id = m.new_claim_id
from tmp_on_behalf_claim_id_map m
where l.claim_id = m.old_claim_id;

do $$
begin
  if not exists (select 1 from tmp_on_behalf_claim_id_map) then
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

-- Rollback guidance (manual, forward-only migration):
-- 1) Snapshot old_claim_id/new_claim_id pairs from this migration's temp-mapping logic into a durable table before reversal.
-- 2) Drop the same child-table FKs, reverse-update claim IDs using the saved mapping, then recreate FKs.
-- 3) Verify zero orphaned claim_id references in child tables before resuming writes.
