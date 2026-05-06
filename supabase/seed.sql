-- Seed data for local development.
-- Keep this file additive and idempotent where possible.

insert into public.allowed_auth_domains (domain, is_active)
values
	('nxtwave.co.in', true),
	('nxtwave.in', true),
	('nxtwave.tech', true)
on conflict (domain) do update
set
	is_active = excluded.is_active,
	updated_at = now();

-- Fixed UUIDs keep seed deterministic and relationship-safe.
with seeded_users as (
	select *
	from (
		values
			('user@nxtwave.co.in', 'Standard Employee'),
			('hod@nxtwave.co.in', 'Department Head'),
			('founder@nxtwave.co.in', 'Founder'),
			('finance@nxtwave.co.in', 'Finance Team')
	) as t(email, full_name)
),
resolved_users as (
	select
		coalesce(pu.id, au.id) as id,
		su.email,
		su.full_name
	from seeded_users su
	left join public.users pu on lower(pu.email) = lower(su.email)
	left join auth.users au on lower(au.email) = lower(su.email)
	where coalesce(pu.id, au.id) is not null
)
insert into public.users (id, email, full_name, is_active)
select
	ru.id,
	ru.email,
	ru.full_name,
	true
from resolved_users ru
on conflict (email) do update
set
	full_name = excluded.full_name,
	is_active = true,
	updated_at = now();

do $$
declare
	v_hod_id uuid;
	v_founder_id uuid;
	v_finance_id uuid;
begin
	select id into v_hod_id
	from public.users
	where lower(email) = 'hod@nxtwave.co.in'
	limit 1;

	select id into v_founder_id
	from public.users
	where lower(email) = 'founder@nxtwave.co.in'
	limit 1;

	select id into v_finance_id
	from public.users
	where lower(email) = 'finance@nxtwave.co.in'
	limit 1;

	if v_hod_id is not null and v_founder_id is not null then
		insert into public.master_departments (name, approver1_id, approver2_id, is_active)
		values ('Tech', v_hod_id, v_founder_id, true)
		on conflict (name) do update
		set
			approver1_id = excluded.approver1_id,
			approver2_id = excluded.approver2_id,
			is_active = excluded.is_active,
			updated_at = now();
	end if;

	if v_finance_id is not null then
		insert into public.master_finance_approvers (user_id, is_active, is_primary)
		values (v_finance_id, true, true)
		on conflict (user_id) do update
		set
			is_active = excluded.is_active,
			is_primary = excluded.is_primary,
			provisional_email = null,
			updated_at = now();
	end if;

	if v_founder_id is not null then
		insert into public.admins (user_id)
		values (v_founder_id)
		on conflict (user_id) do nothing;
	end if;
end
$$;

insert into public.master_expense_categories (name, is_active)
values
	('Food', true),
	('Accommodation Domestic', true),
	('Accommodation Overseas', true),
	('Fuel Expense', true),
	('Employee Car Lease', true),
	('Travel Domestic', true),
	('Travel Overseas', true),
	('Local Subscription', true),
	('Overseas Subscription', true),
	('Repairs & Maintenance - Office', true),
	('Repairs & Maintenance - Electronic Equipment', true),
	('Postal Charges', true),
	('Printing & Stationery', true),
	('Team outing', true),
	('Miscellaneous expenses', true),
	('Offline Marketing', true),
	('Other Staff Welfare', true),
	('Rates & Taxes', true),
	('Internet Expense', true),
	('Brand Promotion', true),
	('Other Professional charges', true),
	('Training & Conference', true)
on conflict (name) do update
set
	is_active = excluded.is_active,
	updated_at = now();

insert into public.master_products (name, is_active)
values
	('Academy Online', true),
	('Academy College Plus', true),
	('Intensive Online', true),
	('Intensive Offline', true),
	('Intensive College Plus', true),
	('NIAT Batch 2023', true),
	('NIAT Batch 2024', true),
	('NIAT Batch 2025', true),
	('NIAT Batch 2026', true),
	('NIAT Application', true),
	('NIAT DS Transport', true),
	('NxtWave Abroad Service', true),
	('NxtWave Abroad Commission', true),
	('Topin.tech', true),
	('Common', true),
	('NIFA', true)
on conflict (name) do update
set
	is_active = excluded.is_active,
	updated_at = now();

insert into public.master_locations (name, is_active)
values
	('Presales-Bangalore', true),
	('Presales-Bhubaneswar', true),
	('Presales-Bikaner', true),
	('Presales-Chennai', true),
	('Presales-Coimbatore', true),
	('Presales-Delhi', true),
	('Presales-Durgapur', true),
	('Presales-Ernakulam', true),
	('Presales-Hubli', true),
	('Presales-Jaipur', true),
	('Presales-Karnataka', true),
	('Presales-KERALA', true),
	('Presales-Kolkata', true),
	('Presales-Kota', true),
	('Presales-Kurnool', true),
	('Presales-Lucknow', true),
	('Presales-Madurai', true),
	('Presales-Maharastra', true),
	('Presales-Mangalore', true),
	('Presales-Mysore', true),
	('Presales-Nagpur', true),
	('Presales-Nashik', true),
	('Presales-New Delhi', true),
	('Presales-Noida', true),
	('Presales-Odisha', true),
	('Presales-Pune', true),
	('Presales-Rajahmundry', true),
	('Presales-Rajasthan', true),
	('Presales-Rourkella', true),
	('Presales-Sangareddy', true),
	('Presales-Sikar', true),
	('Presales-Siliguri', true),
	('Presales-Tamilnadu', true),
	('Presales-Tirupathi', true),
	('Presales-Vijayawada', true),
	('Presales-Vizag', true),
	('Presales-Warangal', true),
	('Presales-West Bengal', true),
	('Office - Hyd Brigade', true),
	('Office - Hyd KKH', true),
	('Office - Hyd Other', true),
	('NIAT - Aurora', true),
	('NIAT - Yenepoya Managlore', true),
	('NIAT - CDU', true),
	('NIAT - Takshasila', true),
	('NIAT - S-Vyasa', true),
	('NIAT - BITS - Farah', true),
	('NIAT - AMET', true),
	('NIAT - CIET - LAM', true),
	('NIAT - NIU', true),
	('NIAT - ADYPU', true),
	('NIAT - VGU', true),
	('NIAT - CITY - Mothadaka', true),
	('NIAT - NSRIT', true),
	('NIAT - NRI', true),
	('NIAT - Mallareddy', true),
	('NIAT - Annamacharya', true),
	('NIAT - SGU', true),
	('NIAT - Sharda', true),
	('NIAT - Crescent', true),
	('Other', true)
on conflict (name) do update
set
	is_active = excluded.is_active,
	updated_at = now();

insert into public.master_payment_modes (name, is_active)
values
	('Reimbursement', true),
	('Petty Cash', true),
	('Petty Cash Request', true),
	('Bulk Petty Cash Request', true),
	('Corporate Card', true),
	('Happay', true),
	('Forex', true)
on conflict (name) do update
set
	is_active = excluded.is_active,
	updated_at = now();

update public.master_policies
set is_active = false
where is_active = true
  and version_name <> 'FIN-POL-002';

insert into public.master_policies (version_name, file_url, is_active)
values ('FIN-POL-002', '/policies/fin-pol-002.pdf', true)
on conflict (version_name) do update
set
	file_url = excluded.file_url,
	is_active = true;

-- Populate BC (Business Central) account code mappings for each expense category.
-- TRUNCATE first so this block is fully idempotent on re-runs.
-- UUIDs are never hardcoded — they are resolved by name at runtime so this
-- works identically across local, staging, and production environments.
truncate public.expense_category_bc_mappings cascade;

with cats as (
	select id, name
	from public.master_expense_categories
)
insert into public.expense_category_bc_mappings (expense_category_id, bc_code, is_active)
select
	cats.id,
	case cats.name
		when 'Food'                                          then '503063'
		when 'Accommodation Domestic'                        then '535004'
		when 'Accommodation Overseas'                        then '535005'
		when 'Fuel Expense'                                  then '535002'
		when 'Travel Domestic'                               then '535001'
		when 'Travel Overseas'                               then '535003'
		when 'Local Subscription'                            then '533501'
		when 'Overseas Subscription'                         then '533502'
		when 'Repairs & Maintenance - Office'                then '533401'
		when 'Repairs & Maintenance - Electronic Equipment'  then '533402'
		when 'Postal Charges'                                then '536011'
		when 'Printing & Stationery'                         then '536012'
		when 'Team outing'                                   then '503067'
		when 'Miscellaneous expenses'                        then '536007'
		when 'Offline Marketing'                             then '505118'
		when 'Other Staff Welfare'                           then '503065'
		when 'Rates & Taxes'                                 then '532504'
		when 'Internet Expense'                              then '530097'
		when 'Brand Promotion'                               then '505121'
		when 'Other Professional charges'                    then '505005'
		when 'Training & Conference'                         then '503066'
		when 'Employee Car Lease'                            then '503008'
		else null
	end,
	true
from cats;