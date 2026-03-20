create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (
    id,
    email,
    full_name
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;

  insert into public.wallets (
    user_id,
    total_reimbursements_received,
    total_petty_cash_received,
    total_petty_cash_spent,
    petty_cash_balance
  )
  values (
    new.id,
    0.00,
    0.00,
    0.00,
    0.00
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

insert into public.users (
  id,
  email,
  full_name
)
select
  au.id,
  au.email,
  au.raw_user_meta_data->>'full_name' as full_name
from auth.users au
where au.id not in (
  select pu.id
  from public.users pu
)
on conflict (id) do nothing;

insert into public.wallets (
  user_id,
  total_reimbursements_received,
  total_petty_cash_received,
  total_petty_cash_spent,
  petty_cash_balance
)
select
  pu.id as user_id,
  0.00,
  0.00,
  0.00,
  0.00
from public.users pu
where pu.id not in (
  select w.user_id
  from public.wallets w
)
on conflict (user_id) do nothing;
