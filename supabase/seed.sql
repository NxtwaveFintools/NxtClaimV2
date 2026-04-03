-- Seed data for local development.
-- Keep this file additive and idempotent where possible.

insert into public.departments (name, is_active)
values
	('Tech', true),
	('Finance', true),
	('Leadership', true)
on conflict (name) do update
set
	is_active = excluded.is_active,
	updated_at = now();

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
			('11111111-1111-1111-1111-111111111111'::uuid, 'user@nxtwave.co.in', 'Standard Employee', 'employee', 'Tech', '22222222-2222-2222-2222-222222222222'::uuid),
			('22222222-2222-2222-2222-222222222222'::uuid, 'hod@nxtwave.co.in', 'Department Head', 'hod', 'Tech', '33333333-3333-3333-3333-333333333333'::uuid),
			('33333333-3333-3333-3333-333333333333'::uuid, 'founder@nxtwave.co.in', 'Founder', 'founder', 'Leadership', null::uuid),
			('44444444-4444-4444-4444-444444444444'::uuid, 'finance@nxtwave.co.in', 'Finance Team', 'finance', 'Finance', null::uuid)
	) as t(id, email, full_name, role, department_name, l1_approver_id)
),
upsert_auth_users as (
	insert into auth.users (
		id,
		aud,
		role,
		email,
		encrypted_password,
		email_confirmed_at,
		raw_app_meta_data,
		raw_user_meta_data,
		created_at,
		updated_at
	)
	select
		su.id,
		'authenticated',
		'authenticated',
		su.email,
		crypt('password123', gen_salt('bf')),
		now(),
		jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
		jsonb_build_object('full_name', su.full_name),
		now(),
		now()
	from seeded_users su
	on conflict (id) do update
	set
		email = excluded.email,
		encrypted_password = excluded.encrypted_password,
		email_confirmed_at = excluded.email_confirmed_at,
		raw_app_meta_data = excluded.raw_app_meta_data,
		raw_user_meta_data = excluded.raw_user_meta_data,
		updated_at = now()
	returning id, email
),
upsert_identities as (
	insert into auth.identities (
		id,
		user_id,
		identity_data,
		provider,
		provider_id,
		created_at,
		updated_at
	)
	select
		gen_random_uuid(),
		su.id,
		jsonb_build_object('sub', su.id::text, 'email', su.email),
		'email',
		su.email,
		now(),
		now()
	from seeded_users su
	on conflict (provider, provider_id) do update
	set
		user_id = excluded.user_id,
		identity_data = excluded.identity_data,
		updated_at = now()
)
insert into public.users (id, email, full_name, role, department_id, l1_approver_id, is_active)
select
	su.id,
	su.email,
	su.full_name,
	su.role,
	d.id,
	su.l1_approver_id,
	true
from seeded_users su
join public.departments d on d.name = su.department_name
on conflict (id) do update
set
	email = excluded.email,
	full_name = excluded.full_name,
	role = excluded.role,
	department_id = excluded.department_id,
	l1_approver_id = excluded.l1_approver_id,
	is_active = true,
	updated_at = now();

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
