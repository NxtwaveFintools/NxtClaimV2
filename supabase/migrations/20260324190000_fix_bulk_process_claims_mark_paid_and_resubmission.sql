-- Canonicalize bulk_process_claims signature and ensure MARK_PAID + resubmission handling.
drop function if exists public.bulk_process_claims(text[], text, uuid, text);
drop function if exists public.bulk_process_claims(text, uuid, text[], text);
drop function if exists public.bulk_process_claims(text, uuid, text[], text, boolean);

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
begin
  if p_action = 'L2_APPROVE' then
    update public.claims
    set status = 'Finance Approved - Payment under process'::claim_status,
        finance_action_at = now(),
        updated_at = now()
    where id = any(p_claim_ids);

  elsif p_action = 'L2_REJECT' then
    update public.claims
    set status = 'Rejected'::claim_status,
        rejection_reason = p_reason,
        is_resubmission_allowed = p_allow_resubmission,
        finance_action_at = now(),
        updated_at = now()
    where id = any(p_claim_ids);

  elsif p_action = 'MARK_PAID' then
    update public.claims
    set status = 'Payment Done - Closed'::claim_status,
        updated_at = now()
    where id = any(p_claim_ids);
  end if;
end;
$$;

grant execute on function public.bulk_process_claims(text, uuid, text[], text, boolean) to authenticated;

notify pgrst, 'reload schema';
