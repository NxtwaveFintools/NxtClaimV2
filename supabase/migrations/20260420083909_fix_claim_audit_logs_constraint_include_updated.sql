-- Hotfix: ensure submitter edit audit action UPDATED is allowed in claim_audit_logs.
--
-- Why:
-- User pre-HOD edits now write action_type = 'UPDATED'.
-- Environments missing this label in the check constraint fail inserts.

alter table public.claim_audit_logs
  drop constraint if exists claim_audit_logs_action_type_check;

alter table public.claim_audit_logs
  add constraint claim_audit_logs_action_type_check check (
    action_type in (
      'SUBMITTED',
      'UPDATED',
      'L1_APPROVED',
      'L1_REJECTED',
      'L2_APPROVED',
      'L2_REJECTED',
      'L2_MARK_PAID',
      'FINANCE_EDITED',
      'ADMIN_SOFT_DELETED',
      'ADMIN_PAYMENT_MODE_OVERRIDDEN'
    )
  );

notify pgrst, 'reload schema';

-- Rollback guidance (manual):
-- Recreate claim_audit_logs_action_type_check without 'UPDATED'.
