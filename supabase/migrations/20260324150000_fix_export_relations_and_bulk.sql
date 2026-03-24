alter table public.claims
  drop constraint if exists claims_submitted_by_fkey,
  drop constraint if exists claims_on_behalf_of_id_fkey,
  drop constraint if exists claims_assigned_l1_approver_id_fkey,
  drop constraint if exists claims_assigned_l2_approver_id_fkey;

alter table public.claims
  add constraint claims_submitted_by_fkey
    foreign key (submitted_by) references public.users(id) on delete restrict,
  add constraint claims_on_behalf_of_id_fkey
    foreign key (on_behalf_of_id) references public.users(id) on delete restrict,
  add constraint claims_assigned_l1_approver_id_fkey
    foreign key (assigned_l1_approver_id) references public.users(id) on delete restrict,
  add constraint claims_assigned_l2_approver_id_fkey
    foreign key (assigned_l2_approver_id) references public.master_finance_approvers(id) on delete restrict;

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
      'L2_MARK_PAID'
    )
  );

create or replace function public.bulk_process_claims(
  p_claim_ids text[],
  p_action text,
  p_actor_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id text;
  v_processed_count integer := 0;
  v_expected_status public.claim_status;
  v_next_status public.claim_status;
  v_action_type text;
  v_effective_reason text;
  v_payment_mode_name text;
  v_detail_type text;
  v_beneficiary_id uuid;
  v_expense_total numeric := 0;
  v_advance_total numeric := 0;
  v_increment_reimbursements numeric := 0;
  v_increment_petty_cash_received numeric := 0;
  v_increment_petty_cash_spent numeric := 0;
begin
  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    return 0;
  end if;

  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  if p_action = 'L2_APPROVE' then
    v_expected_status := 'HOD approved - Awaiting finance approval';
    v_next_status := 'Finance Approved - Payment under process';
    v_action_type := 'L2_APPROVED';
    v_effective_reason := null;
  elsif p_action = 'L2_REJECT' then
    v_expected_status := 'HOD approved - Awaiting finance approval';
    v_next_status := 'Rejected';
    v_action_type := 'L2_REJECTED';
    v_effective_reason := nullif(trim(coalesce(p_reason, '')), '');

    if v_effective_reason is null then
      raise exception 'p_reason is required for L2_REJECT';
    end if;
  elsif p_action = 'MARK_PAID' then
    v_expected_status := 'Finance Approved - Payment under process';
    v_next_status := 'Payment Done - Closed';
    v_action_type := 'L2_MARK_PAID';
    v_effective_reason := null;
  else
    raise exception 'Unsupported action: %', p_action;
  end if;

  foreach v_claim_id in array p_claim_ids loop
    update public.claims
    set
      status = v_next_status,
      rejection_reason = case when p_action = 'L2_REJECT' then v_effective_reason else null end,
      is_resubmission_allowed = false,
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
      v_action_type,
      null,
      case when p_action = 'L2_REJECT' then v_effective_reason else null end
    );

    if p_action = 'MARK_PAID' then
      select
        c.on_behalf_of_id,
        c.detail_type,
        lower(coalesce(pm.name, '')),
        coalesce(ed.total_amount, 0),
        coalesce(ad.requested_amount, 0)
      into
        v_beneficiary_id,
        v_detail_type,
        v_payment_mode_name,
        v_expense_total,
        v_advance_total
      from public.claims c
      left join public.master_payment_modes pm
        on pm.id = c.payment_mode_id
      left join public.expense_details ed
        on ed.claim_id = c.id
        and ed.is_active = true
      left join public.advance_details ad
        on ad.claim_id = c.id
        and ad.is_active = true
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
          total_reimbursements_received = public.wallets.total_reimbursements_received + excluded.total_reimbursements_received,
          total_petty_cash_received = public.wallets.total_petty_cash_received + excluded.total_petty_cash_received,
          total_petty_cash_spent = public.wallets.total_petty_cash_spent + excluded.total_petty_cash_spent,
          updated_at = now();
      end if;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

  return v_processed_count;
end;
$$;

grant execute on function public.bulk_process_claims(text[], text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
