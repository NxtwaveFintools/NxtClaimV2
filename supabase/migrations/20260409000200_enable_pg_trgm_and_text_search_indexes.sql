-- Performance: Enable trigram search acceleration for wildcard ILIKE filters used in
-- claims, admin, and department dashboards.

create extension if not exists pg_trgm;

-- Claim ID and employee identity searches
create index if not exists idx_claims_id_trgm
  on public.claims using gin (id gin_trgm_ops)
  where is_active = true;

create index if not exists idx_claims_employee_id_trgm
  on public.claims using gin (employee_id gin_trgm_ops)
  where is_active = true
    and employee_id <> '';

create index if not exists idx_claims_on_behalf_employee_code_trgm
  on public.claims using gin (on_behalf_employee_code gin_trgm_ops)
  where is_active = true
    and on_behalf_employee_code is not null
    and on_behalf_employee_code <> '';

create index if not exists idx_claims_on_behalf_email_trgm
  on public.claims using gin (on_behalf_email gin_trgm_ops)
  where is_active = true
    and on_behalf_email is not null
    and on_behalf_email <> '';

-- Submitter name/email searches
create index if not exists idx_users_email_trgm
  on public.users using gin (email gin_trgm_ops);

create index if not exists idx_users_full_name_trgm
  on public.users using gin (full_name gin_trgm_ops)
  where full_name is not null
    and full_name <> '';

-- Rollback (manual)
-- drop index if exists public.idx_users_full_name_trgm;
-- drop index if exists public.idx_users_email_trgm;
-- drop index if exists public.idx_claims_on_behalf_email_trgm;
-- drop index if exists public.idx_claims_on_behalf_employee_code_trgm;
-- drop index if exists public.idx_claims_employee_id_trgm;
-- drop index if exists public.idx_claims_id_trgm;
-- drop extension if exists pg_trgm;
