-- Rollback for: 20260511108000_seed_department_responsible_mappings.sql
-- This file must NEVER be committed (see .gitignore: *_rollback.sql).

BEGIN;

WITH requested_mappings(department_name, responsible_department_code) AS (
  VALUES
    ('Pre-Sales', 'PRE-SALES'),
    ('Sales', 'SALES'),
    ('Branding', 'BRANDING'),
    ('GenAI Social Media', 'GENAI SOCIAL MEDIA'),
    ('Placement - Corporate Relations', 'PLAC-CORP-OPS'),
    ('10xIIT', '10XIIT'),
    ('AI&Beyond', 'AI&BEYOND'),
    ('Student Success - Academy', 'STUDENT SUCCESS-ACD'),
    ('PLG - Academy & PLG - NIAT', 'PLG - ACADEMY & PLG'),
    ('Gig Works', 'GIG WORKS'),
    ('Talent Acquisition', 'TALENT ACQUISITION'),
    ('Student Success - Intensive', 'STUDENT SUCCESS-INT'),
    ('Placement - Content', 'CNT-CUR-PLACEMENT'),
    ('University Partnership', 'UNI PARTNERSHIPS'),
    ('PRE', 'PRE'),
    ('Abroad', 'NXTWAVE ABROAD'),
    ('NIAT - Academics', 'NIAT - TUTORS'),
    ('Technology', 'TECHNOLOGY'),
    ('NxtGen LP', 'NXTGEN LP'),
    ('Student Success - NIAT', 'STUDENT SUCCESS-NIAT'),
    ('NIAT - Program Ops', 'NIAT - OPERATIONS'),
    ('Content - MERN', 'CNT-CUR-MERN-JAVA-QA'),
    ('Content - DS&Algo', 'CNT-CUR-DSA'),
    ('Content - DS&ML', 'CNT-CUR-DA-DS-ML'),
    ('Human Resource', 'HR-ADMIN FACILITIES'),
    ('HR - Admin/Facilities', 'HR-ADMIN FACILITIES'),
    ('HR - Learning & Development', 'HR - LEARNING & DEVE'),
    ('Video House', 'VIDEO HOUSE'),
    ('Query Resolution', 'QUERY RESOLUTION'),
    ('Placement Success Manager', 'PLAC SUCCESS MANAGER'),
    ('Business Ops', 'CENTRAL OPERATIONS'),
    ('Product Design', 'PRODUCT - DESIGN'),
    ('Founders Office', 'FOUNDERS OFFICE-CEO'),
    ('NIFA', 'NIFA'),
    ('Finance', 'FIN-OPR ANALYSIS'),
    ('NIAT Offline Lead Generation Team', 'PRE-SALES'),
    ('Travel & Stay (Sales)', 'HR-OPR & PAYROLL'),
    ('NIAT Hostels & Transportation', 'NIAT HOS AND TRANS'),
    ('NIAT Masterclass', 'MASTER CLASS - NIAT'),
    ('NIAT Robotics', 'NIAT-ROBOTICS'),
    ('Product Management', 'PRODUCT MANAGEMENT'),
    ('Intensive Sales', 'INTENSIVE SALES'),
    ('NXTWAVE EDGE – COLLEGE', 'NXTWAVE EDGE – COL.'),
    ('Employee Car Lease', 'HR-OPR & PAYROLL'),
    ('TA - BULK HIRING', 'TA - BULK HIRING'),
    ('Talent Evaluation Ops', 'TALENT EVALUATION OP')
),
resolved_mappings AS (
  SELECT
    public.master_departments.id AS department_id,
    requested_mappings.responsible_department_code
  FROM requested_mappings
  INNER JOIN public.master_departments
    ON public.master_departments.name = requested_mappings.department_name
)
UPDATE public.master_department_responsible_mappings
SET is_active = false
FROM resolved_mappings
WHERE public.master_department_responsible_mappings.department_id = resolved_mappings.department_id
  AND public.master_department_responsible_mappings.responsible_department_code = resolved_mappings.responsible_department_code;

COMMIT;