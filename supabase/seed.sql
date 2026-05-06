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
			('11111111-1111-1111-1111-111111111111'::uuid, 'user@nxtwave.co.in', 'Standard Employee'),
			('22222222-2222-2222-2222-222222222222'::uuid, 'hod@nxtwave.co.in', 'Department Head'),
			('33333333-3333-3333-3333-333333333333'::uuid, 'founder@nxtwave.co.in', 'Founder'),
			('44444444-4444-4444-4444-444444444444'::uuid, 'finance@nxtwave.co.in', 'Finance Team')
	) as t(id, email, full_name)
),
resolved_users as (
	select
		coalesce(u.id, su.id) as id,
		su.email,
		su.full_name
	from seeded_users su
	left join public.users u on lower(u.email) = lower(su.email)
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

insert into public.master_departments (name, approver1_id, approver2_id, is_active)
values (
	'Tech',
	(select id from public.users where lower(email) = 'hod@nxtwave.co.in' limit 1),
	(select id from public.users where lower(email) = 'founder@nxtwave.co.in' limit 1),
	true
)
on conflict (name) do update
set
	approver1_id = excluded.approver1_id,
	approver2_id = excluded.approver2_id,
	is_active = excluded.is_active,
	updated_at = now();

insert into public.master_finance_approvers (user_id, is_active, is_primary)
values ((select id from public.users where lower(email) = 'finance@nxtwave.co.in' limit 1), true, true)
on conflict (user_id) do update
set
	is_active = excluded.is_active,
	is_primary = excluded.is_primary,
	provisional_email = null,
	updated_at = now();

insert into public.admins (user_id)
values ((select id from public.users where lower(email) = 'founder@nxtwave.co.in' limit 1))
on conflict (user_id) do nothing;

insert into public.master_expense_categories (name, is_active)
values
	('Food', true),
	('Accommodation Domestic', true),
	('Accommodation Overseas', true),
	('Fuel Expense', true),
	('Car Lease', true),
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