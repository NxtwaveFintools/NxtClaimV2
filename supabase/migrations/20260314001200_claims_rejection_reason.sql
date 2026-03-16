alter table public.claims
  add column if not exists rejection_reason text;

comment on column public.claims.rejection_reason is
  'Mandatory reason captured when a claim is rejected by L1 or Finance approver.';

-- Rollback guidance (execute manually when safe):
-- 1) alter table public.claims drop column if exists rejection_reason;
