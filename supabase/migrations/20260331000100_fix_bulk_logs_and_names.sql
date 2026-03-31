-- Fix 1: bulk_process_claims — add audit log inserts for every processed claim.
-- Fix 2: handle_new_user — fall back to raw_user_meta_data->>'name', then email prefix.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Recreate bulk_process_claims WITH audit-log writes
-- ──────────────────────────────────────────────────────────────────────────────
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
declare
  v_claim_id text;
  v_audit_action text;
begin
  -- Map RPC action to audit-log action_type
  case p_action
    when 'L2_APPROVE' then v_audit_action := 'L2_APPROVED';
    when 'L2_REJECT'  then v_audit_action := 'L2_REJECTED';
    when 'MARK_PAID'  then v_audit_action := 'L2_MARK_PAID';
    else raise exception 'Unknown bulk action: %', p_action;
  end case;

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

  -- Write one audit-log row per processed claim
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

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Recreate handle_new_user WITH name-capture fallbacks
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
begin
  -- Keep auth signup resilient if email is unexpectedly missing.
  if new.email is null then
    return new;
  end if;

  -- Resolve full_name: full_name → name → email prefix (before @)
  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(split_part(new.email, '@', 1)), '')
  );

  insert into public.users (
    id,
    email,
    full_name
  )
  values (
    new.id,
    new.email,
    v_full_name
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(nullif(trim(excluded.full_name), ''), public.users.full_name),
        updated_at = now();

  insert into public.wallets (
    user_id
  )
  values (
    new.id
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Also back-fill any existing users whose full_name is still NULL
update public.users pu
set full_name = coalesce(
      nullif(trim(au.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(au.raw_user_meta_data->>'name'), ''),
      nullif(trim(split_part(au.email, '@', 1)), '')
    ),
    updated_at = now()
from auth.users au
where pu.id = au.id
  and (pu.full_name is null or trim(pu.full_name) = '');

notify pgrst, 'reload schema';
