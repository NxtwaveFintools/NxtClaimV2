alter table if exists public.master_departments
  drop constraint if exists master_departments_hod_founder_not_same;

comment on table public.master_departments is
  'Department master mapping for dynamic L1 routing. HOD and founder may be same for specific departments based on source master data.';