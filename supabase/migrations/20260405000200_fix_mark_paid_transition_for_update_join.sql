-- Fix mark-paid RPC row lock query.
--
-- Why:
-- PostgreSQL disallows FOR UPDATE when the query targets the nullable side
-- of an outer join. The previous implementation joined master_payment_modes
-- while locking claims, which caused runtime failures in mark-paid actions.

create or replace function public.process_l2_mark_paid_transition(
  p_claim_id text,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_finance_approver_id uuid;
  v_claim_status public.claim_status;
  v_beneficiary_id uuid;
  v_payment_mode_id uuid;
  v_payment_mode_name text := '';
  v_expense_total numeric := 0;
  v_advance_total numeric := 0;
  v_increment_reimbursements numeric := 0;
  v_increment_petty_cash_received numeric := 0;
  v_increment_petty_cash_spent numeric := 0;
begin
  if p_claim_id is null or btrim(p_claim_id) = '' then
    raise exception 'p_claim_id is required';
  end if;

  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  select mfa.id
  into v_actor_finance_approver_id
  from public.master_finance_approvers mfa
  where mfa.user_id = p_actor_id
    and mfa.is_active = true
  order by mfa.created_at asc
  limit 1;

  if v_actor_finance_approver_id is null then
    raise exception 'p_actor_id is not an active finance approver';
  end if;

  select
    c.status,
    coalesce(c.on_behalf_of_id, c.submitted_by),
    c.payment_mode_id,
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
    v_claim_status,
    v_beneficiary_id,
    v_payment_mode_id,
    v_expense_total,
    v_advance_total
  from public.claims c
  where c.id = p_claim_id
    and c.is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive: %', p_claim_id;
  end if;

  if v_payment_mode_id is not null then
    select lower(coalesce(pm.name, ''))
    into v_payment_mode_name
    from public.master_payment_modes pm
    where pm.id = v_payment_mode_id
      and pm.is_active = true
    limit 1;
  end if;

  if v_claim_status <> 'Finance Approved - Payment under process'::public.claim_status then
    raise exception 'Claim is not in payment-under-process stage.';
  end if;

  if v_payment_mode_name = 'reimbursement' then
    v_increment_reimbursements := greatest(coalesce(v_expense_total, 0), 0);
  elsif v_payment_mode_name in ('petty cash request', 'bulk petty cash request') then
    v_increment_petty_cash_received := greatest(coalesce(v_advance_total, 0), 0);
  elsif v_payment_mode_name = 'petty cash' then
    v_increment_petty_cash_spent := greatest(coalesce(v_expense_total, 0), 0);
  end if;

  update public.claims
  set
    status = 'Payment Done - Closed'::public.claim_status,
    assigned_l2_approver_id = v_actor_finance_approver_id,
    rejection_reason = null,
    is_resubmission_allowed = false,
    finance_action_at = now(),
    updated_at = now()
  where id = p_claim_id
    and is_active = true
    and status = 'Finance Approved - Payment under process'::public.claim_status;

  if not found then
    raise exception 'Claim state changed during mark-paid transition: %', p_claim_id;
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

  insert into public.claim_audit_logs (
    claim_id,
    actor_id,
    action_type,
    assigned_to_id,
    remarks
  )
  values (
    p_claim_id,
    p_actor_id,
    'L2_MARK_PAID',
    null,
    null
  );
end;
$$;

grant execute on function public.process_l2_mark_paid_transition(text, uuid) to authenticated;
grant execute on function public.process_l2_mark_paid_transition(text, uuid) to service_role;

notify pgrst, 'reload schema';

-- Rollback guidance (manual):
-- 1) restore prior function definition from 20260405000100 migration.