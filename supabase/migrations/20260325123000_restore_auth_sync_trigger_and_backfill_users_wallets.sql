create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Keep auth signup resilient if email is unexpectedly missing.
  if new.email is null then
    return new;
  end if;

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
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.users.full_name),
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
left join public.users pu
  on pu.id = au.id
where pu.id is null
  and au.email is not null
on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.users.full_name),
      updated_at = now();

insert into public.wallets (
  user_id
)
select
  pu.id as user_id
from public.users pu
left join public.wallets w
  on w.user_id = pu.id
where w.user_id is null
on conflict (user_id) do nothing;
