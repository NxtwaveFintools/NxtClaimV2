-- ============================================================
-- Fix bulk claim audit action constraint + action normalization
--
-- Root cause:
-- 1) 20260328000100_admin_control_center.sql replaced
--    claim_audit_logs_action_type_check and accidentally removed
--    'L2_MARK_PAID'.
-- 2) bulk_process_claims inserts one audit row per claim and uses
--    action_type 'L2_MARK_PAID' for MARK_PAID.
--
-- This migration:
-- - Restores 'L2_MARK_PAID' in the CHECK constraint.
-- - Recreates bulk_process_claims with normalized action handling
--   so bulk approve/reject/mark-paid all emit canonical action types.
-- ============================================================

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
      'ADMIN_SOFT_DELETED'
    )
  );

create or replace function public.bulk_process_claims(
  p_action text,
  p_actor_id uuid,
  p_claim_ids text[],
  p_reason text default null,
  p_allow_resubmission boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id text;
  v_audit_action text;
  v_normalized_action text;
begin
  v_normalized_action := upper(trim(coalesce(p_action, '')));

  -- Map supported input actions to canonical audit action types.
  case v_normalized_action
    when 'L2_APPROVE' then v_audit_action := 'L2_APPROVED';
    when 'L2_APPROVED' then v_audit_action := 'L2_APPROVED';
    when 'L2_REJECT' then v_audit_action := 'L2_REJECTED';
    when 'L2_REJECTED' then v_audit_action := 'L2_REJECTED';
    when 'MARK_PAID' then v_audit_action := 'L2_MARK_PAID';
    when 'L2_MARK_PAID' then v_audit_action := 'L2_MARK_PAID';
    else raise exception 'Unknown bulk action: %', p_action;
  end case;

  if v_audit_action = 'L2_APPROVED' then
    update public.claims
    set status = 'Finance Approved - Payment under process'::claim_status,
        finance_action_at = now(),
        updated_at = now()
    where id = any(p_claim_ids);

  elsif v_audit_action = 'L2_REJECTED' then
    update public.claims
    set status = 'Rejected'::claim_status,
        rejection_reason = p_reason,
        is_resubmission_allowed = p_allow_resubmission,
        finance_action_at = now(),
        updated_at = now()
    where id = any(p_claim_ids);

  elsif v_audit_action = 'L2_MARK_PAID' then
    update public.claims
    set status = 'Payment Done - Closed'::claim_status,
        updated_at = now()
    where id = any(p_claim_ids);
  end if;

  -- Write one audit-log row per processed claim.
  foreach v_claim_id in array p_claim_ids loop
    insert into public.claim_audit_logs (
      claim_id,
      actor_id,
      action_type,
      remarks,
      created_at
    ) values (
      v_claim_id,
      p_actor_id,
      v_audit_action,
      p_reason,
      now()
    );
  end loop;
end;
$$;

grant execute on function public.bulk_process_claims(text, uuid, text[], text, boolean) to authenticated;

notify pgrst, 'reload schema';

-- Rollback guidance (manual):
-- 1) Re-apply previous claim_audit_logs_action_type_check if required.
-- 2) Recreate prior bulk_process_claims definition from
--    20260331000100_fix_bulk_logs_and_names.sql.
