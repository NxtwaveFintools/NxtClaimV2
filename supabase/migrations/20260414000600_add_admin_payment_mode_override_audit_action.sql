-- Add admin payment mode override audit action.
--
-- Why:
-- Admin hotfix flow requires a dedicated audit action type so payment mode
-- corrections are distinguishable from status overrides and soft deletes.

alter table public.claim_audit_logs
  drop constraint if exists claim_audit_logs_action_type_check;

alter table public.claim_audit_logs
  add constraint claim_audit_logs_action_type_check check (
    action_type in (
      'SUBMITTED',
      'L1_APPROVED',
      'L1_REJECTED',
      'L2_APPROVED',
      'L2_REJECTED',
      'L2_MARK_PAID',
      'ADMIN_SOFT_DELETED',
      'ADMIN_PAYMENT_MODE_OVERRIDDEN'
    )
  );

notify pgrst, 'reload schema';

-- Rollback guidance (manual):
-- 1) Re-apply prior claim_audit_logs_action_type_check definition without
--    ADMIN_PAYMENT_MODE_OVERRIDDEN.
