-- Track soft-delete actor metadata on claims.
-- Columns are nullable to preserve legacy soft-deleted rows.

alter table if exists public.claims
  add column if not exists deleted_by uuid references public.users(id) on delete restrict;

alter table if exists public.claims
  add column if not exists deleted_at timestamptz;

-- Rollback guidance (execute manually when safe):
-- alter table if exists public.claims drop column if exists deleted_at;
-- alter table if exists public.claims drop column if exists deleted_by;
