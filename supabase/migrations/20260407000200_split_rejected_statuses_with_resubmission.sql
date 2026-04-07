-- Split rejected status into explicit outcomes without mutating historical rows.
--
-- Production-safe approach:
-- 1) Rename existing enum value so all historical rows transition in-place.
-- 2) Add the new enum value for resubmission-allowed rejections.
-- 3) Update live DB logic to emit/select both explicit statuses.

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'claim_status'
      and e.enumlabel = 'Rejected'
  ) then
    alter type public.claim_status
      rename value 'Rejected' to 'Rejected - Resubmission Not Allowed';
  end if;
end;
$$;

alter type public.claim_status
  add value if not exists 'Rejected - Resubmission Allowed';

-- NOTE:
-- Keep this migration intentionally limited to enum label changes.
-- Runtime objects that depend on these enum labels are updated in
-- 20260407000300_split_rejected_statuses_runtime_objects.sql.
