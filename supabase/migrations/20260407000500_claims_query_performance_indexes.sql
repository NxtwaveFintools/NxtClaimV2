-- Migration: Claims query performance indexes for dashboard and approval queues.
-- Scope: Freshness-first optimization via index tuning only (no caching changes).
--
-- Live database inspection confirms these already exist:
--   idx_claims_assigned_l1_approver_id
--   idx_claims_status
--   idx_claims_department_id
--   idx_claims_created_at
--
-- This migration therefore adds only the missing L2 approver index.

create index if not exists idx_claims_assigned_l2_approver_id
  on public.claims (assigned_l2_approver_id);

-- Rollback (manual)
-- drop index if exists public.idx_claims_assigned_l2_approver_id;
