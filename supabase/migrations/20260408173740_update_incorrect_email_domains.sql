-- Migration: Update incorrect email domains for specific users/departments.
-- Scope: Exact replacements for three known addresses only.

with replacements (old_email, new_email) as (
  values
    ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
    ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
    ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
)
update public.users as u
set email = r.new_email
from replacements as r
where u.email = r.old_email;

with replacements (old_email, new_email) as (
  values
    ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
    ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
    ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
)
update public.master_departments as md
set hod_provisional_email = r.new_email
from replacements as r
where md.hod_provisional_email = r.old_email;

with replacements (old_email, new_email) as (
  values
    ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
    ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
    ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
)
update public.master_departments as md
set founder_provisional_email = r.new_email
from replacements as r
where md.founder_provisional_email = r.old_email;

-- Rollback (manual, run separately only if needed):
-- with replacements (old_email, new_email) as (
--   values
--     ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
--     ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
--     ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
-- )
-- update public.users as u
-- set email = r.old_email
-- from replacements as r
-- where u.email = r.new_email;
--
-- with replacements (old_email, new_email) as (
--   values
--     ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
--     ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
--     ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
-- )
-- update public.master_departments as md
-- set hod_provisional_email = r.old_email
-- from replacements as r
-- where md.hod_provisional_email = r.new_email;
--
-- with replacements (old_email, new_email) as (
--   values
--     ('vamsitallam@nxtwave.tech', 'vamsitallam@nxtwave.co.in'),
--     ('akhilesh.jhawar@nxtwave.in', 'akhilesh.jhawar@nxtwave.co.in'),
--     ('alekhya.k@nxtwave.tech', 'alekhya.k@nxtwave.co.in')
-- )
-- update public.master_departments as md
-- set founder_provisional_email = r.old_email
-- from replacements as r
-- where md.founder_provisional_email = r.new_email;
