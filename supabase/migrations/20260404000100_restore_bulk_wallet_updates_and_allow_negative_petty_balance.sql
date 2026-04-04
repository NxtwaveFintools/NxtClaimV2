-- Restore bulk wallet updates and allow negative petty cash balances.
--
-- Why:
-- 1) Recent bulk_process_claims revisions updated claim status + audit logs,
--    but stopped updating wallet totals on MARK_PAID.
-- 2) Wallet constraint currently blocks negative petty cash balance, while UI and
--    business flow support "company owed" scenarios.
--
-- This migration:
-- - Drops wallets_petty_cash_balance_non_negative.
-- - Recreates bulk_process_claims with status guards, audit logs, wallet updates,
--   and processed-count return value.
-- - Backfills wallet totals from all active closed claims.

alter table public.wallets
  drop constraint if exists wallets_petty_cash_balance_non_negative;

drop function if exists public.bulk_process_claims(text, uuid, text[], text, boolean);

create or replace function public.bulk_process_claims(
  p_action text,
  p_actor_id uuid,
  p_claim_ids text[],
  p_reason text default null,
  p_allow_resubmission boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id text;
  v_processed_count integer := 0;
  v_normalized_action text;
  v_audit_action text;
  v_expected_status public.claim_status;
  v_next_status public.claim_status;
  v_effective_reason text;
  v_beneficiary_id uuid;
  v_payment_mode_name text;
  v_expense_total numeric := 0;
  v_advance_total numeric := 0;
  v_increment_reimbursements numeric := 0;
  v_increment_petty_cash_received numeric := 0;
  v_increment_petty_cash_spent numeric := 0;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    return 0;
  end if;

  if not exists (
    select 1
    from public.master_finance_approvers mfa
    where mfa.user_id = p_actor_id
      and mfa.is_active = true
  ) then
    raise exception 'p_actor_id is not an active finance approver';
  end if;

  v_normalized_action := upper(trim(coalesce(p_action, '')));

  case v_normalized_action
    when 'L2_APPROVE', 'L2_APPROVED' then
      v_audit_action := 'L2_APPROVED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := 'Finance Approved - Payment under process';
      v_effective_reason := null;

    when 'L2_REJECT', 'L2_REJECTED' then
      v_audit_action := 'L2_REJECTED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := 'Rejected';
      v_effective_reason := nullif(trim(coalesce(p_reason, '')), '');

      if v_effective_reason is null then
        raise exception 'p_reason is required for L2_REJECT';
      end if;

    when 'MARK_PAID', 'L2_MARK_PAID' then
      v_audit_action := 'L2_MARK_PAID';
      v_expected_status := 'Finance Approved - Payment under process';
      v_next_status := 'Payment Done - Closed';
      v_effective_reason := null;

    else
      raise exception 'Unknown bulk action: %', p_action;
  end case;

  foreach v_claim_id in array p_claim_ids loop
    update public.claims
    set
      status = v_next_status,
      rejection_reason = case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end,
      is_resubmission_allowed = case
        when v_audit_action = 'L2_REJECTED' then p_allow_resubmission
        else false
      end,
      finance_action_at = now(),
      updated_at = now()
    where id = v_claim_id
      and is_active = true
      and status = v_expected_status;

    if not found then
      continue;
    end if;

    insert into public.claim_audit_logs (
      claim_id,
      actor_id,
      action_type,
      assigned_to_id,
      remarks
    )
    values (
      v_claim_id,
      p_actor_id,
      v_audit_action,
      null,
      case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end
    );

    if v_audit_action = 'L2_REJECTED' and p_allow_resubmission then
      update public.expense_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;

      update public.advance_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;
    end if;

    if v_audit_action = 'L2_MARK_PAID' then
      select
        coalesce(c.on_behalf_of_id, c.submitted_by),
        lower(coalesce(pm.name, '')),
        coalesce(
          (
            select ed.total_amount
            from public.expense_details ed
            where ed.claim_id = c.id
              and ed.is_active = true
            limit 1
          ),
          0
        ),
        coalesce(
          (
            select ad.requested_amount
            from public.advance_details ad
            where ad.claim_id = c.id
              and ad.is_active = true
            limit 1
          ),
          0
        )
      into
        v_beneficiary_id,
        v_payment_mode_name,
        v_expense_total,
        v_advance_total
      from public.claims c
      left join public.master_payment_modes pm
        on pm.id = c.payment_mode_id
      where c.id = v_claim_id
      limit 1;

      v_increment_reimbursements := 0;
      v_increment_petty_cash_received := 0;
      v_increment_petty_cash_spent := 0;

      if v_payment_mode_name = 'reimbursement' then
        v_increment_reimbursements := greatest(coalesce(v_expense_total, 0), 0);
      elsif v_payment_mode_name in ('petty cash request', 'bulk petty cash request') then
        v_increment_petty_cash_received := greatest(coalesce(v_advance_total, 0), 0);
      elsif v_payment_mode_name = 'petty cash' then
        v_increment_petty_cash_spent := greatest(coalesce(v_expense_total, 0), 0);
      end if;

      if v_beneficiary_id is not null and (
        v_increment_reimbursements > 0
        or v_increment_petty_cash_received > 0
        or v_increment_petty_cash_spent > 0
      ) then
        insert into public.wallets (
          user_id,
          total_reimbursements_received,
          total_petty_cash_received,
          total_petty_cash_spent
        )
        values (
          v_beneficiary_id,
          v_increment_reimbursements,
          v_increment_petty_cash_received,
          v_increment_petty_cash_spent
        )
        on conflict (user_id)
        do update set
          total_reimbursements_received =
            public.wallets.total_reimbursements_received + excluded.total_reimbursements_received,
          total_petty_cash_received =
            public.wallets.total_petty_cash_received + excluded.total_petty_cash_received,
          total_petty_cash_spent =
            public.wallets.total_petty_cash_spent + excluded.total_petty_cash_spent,
          updated_at = now();
      end if;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

  return v_processed_count;
end;
$$;

grant execute on function public.bulk_process_claims(text, uuid, text[], text, boolean) to authenticated;

insert into public.wallets (user_id)
select u.id
from public.users u
on conflict (user_id) do nothing;

with claim_amounts as (
  select
    coalesce(c.on_behalf_of_id, c.submitted_by) as user_id,
    lower(coalesce(pm.name, '')) as payment_mode_name,
    coalesce(
      (
        select ed.total_amount
        from public.expense_details ed
        where ed.claim_id = c.id
          and ed.is_active = true
        limit 1
      ),
      0
    ) as expense_total,
    coalesce(
      (
        select ad.requested_amount
        from public.advance_details ad
        where ad.claim_id = c.id
          and ad.is_active = true
        limit 1
      ),
      0
    ) as advance_total
  from public.claims c
  left join public.master_payment_modes pm
    on pm.id = c.payment_mode_id
  where c.is_active = true
    and c.status = 'Payment Done - Closed'::claim_status
),
wallet_rollup as (
  select
    user_id,
    sum(
      case
        when payment_mode_name = 'reimbursement' then greatest(expense_total, 0)
        else 0
      end
    )::numeric(14,2) as total_reimbursements_received,
    sum(
      case
        when payment_mode_name in ('petty cash request', 'bulk petty cash request')
          then greatest(advance_total, 0)
        else 0
      end
    )::numeric(14,2) as total_petty_cash_received,
    sum(
      case
        when payment_mode_name = 'petty cash' then greatest(expense_total, 0)
        else 0
      end
    )::numeric(14,2) as total_petty_cash_spent
  from claim_amounts
  where user_id is not null
  group by user_id
)
update public.wallets w
set
  total_reimbursements_received = coalesce(r.total_reimbursements_received, 0.00),
  total_petty_cash_received = coalesce(r.total_petty_cash_received, 0.00),
  total_petty_cash_spent = coalesce(r.total_petty_cash_spent, 0.00),
  updated_at = now()
from public.users u
left join wallet_rollup r
  on r.user_id = u.id
where w.user_id = u.id;

notify pgrst, 'reload schema';

-- Rollback guidance (manual):
-- 1) Recreate previous bulk_process_claims from 20260403000300_fix_bulk_claim_audit_action_constraint.sql.
-- 2) Re-add wallets_petty_cash_balance_non_negative if business rules require non-negative balances.
