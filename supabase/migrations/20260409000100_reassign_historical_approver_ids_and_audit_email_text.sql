begin;

do $$
declare
  v_resolution_issues text;
  v_claims_assigned_l1_updated bigint := 0;
  v_audit_assigned_to_updated bigint := 0;
  v_audit_remarks_updated bigint := 0;
begin
  with email_mapping(old_email, new_email) as (
    values
      ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
      ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
      ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
  ),
  resolution as (
    select
      m.old_email,
      m.new_email,
      (
        select count(*)
        from public.users u
        where lower(u.email) = lower(m.old_email)
      ) as old_count,
      (
        select count(*)
        from public.users u
        where lower(u.email) = lower(m.new_email)
      ) as new_count
    from email_mapping m
  )
  select string_agg(
    format(
      '%s -> %s (old_count=%s, new_count=%s)',
      old_email,
      new_email,
      old_count,
      new_count
    ),
    '; '
  )
  into v_resolution_issues
  from resolution
  where old_count <> 1
     or new_count <> 1;

  if v_resolution_issues is not null then
    raise exception 'Approver email mapping resolution failed: %', v_resolution_issues;
  end if;

  with email_mapping(old_email, new_email) as (
    values
      ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
      ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
      ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
  ),
  resolved as (
    select
      old_u.id as old_user_id,
      new_u.id as new_user_id
    from email_mapping m
    join public.users old_u
      on lower(old_u.email) = lower(m.old_email)
    join public.users new_u
      on lower(new_u.email) = lower(m.new_email)
  )
  update public.claims c
  set assigned_l1_approver_id = r.new_user_id
  from resolved r
  where c.assigned_l1_approver_id = r.old_user_id;

  get diagnostics v_claims_assigned_l1_updated = row_count;

  with email_mapping(old_email, new_email) as (
    values
      ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
      ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
      ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
  ),
  resolved as (
    select
      old_u.id as old_user_id,
      new_u.id as new_user_id
    from email_mapping m
    join public.users old_u
      on lower(old_u.email) = lower(m.old_email)
    join public.users new_u
      on lower(new_u.email) = lower(m.new_email)
  )
  update public.claim_audit_logs cal
  set assigned_to_id = r.new_user_id
  from resolved r
  where cal.assigned_to_id = r.old_user_id;

  get diagnostics v_audit_assigned_to_updated = row_count;

  update public.claim_audit_logs cal
  set remarks = replace(
    replace(
      replace(
        cal.remarks,
        'akhilesh.jhawar@nxtwave.in',
        'akhilesh.jhawar@nxtwave.co.in'
      ),
      'vamsitallam@nxtwave.tech',
      'vamsitallam@nxtwave.co.in'
    ),
    'alekhya.k@nxtwave.tech',
    'alekhya.k@nxtwave.co.in'
  )
  where cal.remarks is not null
    and (
      cal.remarks like '%akhilesh.jhawar@nxtwave.in%'
      or cal.remarks like '%vamsitallam@nxtwave.tech%'
      or cal.remarks like '%alekhya.k@nxtwave.tech%'
    );

  get diagnostics v_audit_remarks_updated = row_count;

  raise notice 'claims.assigned_l1_approver_id rows updated: %', v_claims_assigned_l1_updated;
  raise notice 'claim_audit_logs.assigned_to_id rows updated: %', v_audit_assigned_to_updated;
  raise notice 'claim_audit_logs.remarks rows updated: %', v_audit_remarks_updated;
end $$;

commit;

-- Rollback guidance (manual):
-- 1) Resolve old/new IDs via the same email mapping in reverse.
-- 2) Update public.claims.assigned_l1_approver_id from new IDs back to old IDs.
-- 3) Update public.claim_audit_logs.assigned_to_id from new IDs back to old IDs.
-- 4) Reverse REPLACE in public.claim_audit_logs.remarks if required.
