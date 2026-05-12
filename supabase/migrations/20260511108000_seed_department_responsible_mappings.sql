BEGIN;

DO $$
DECLARE
  missing_departments TEXT[];
  resolved_mapping_count INTEGER;
  expected_mapping_count CONSTANT INTEGER := 46;
BEGIN
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
  )
  SELECT array_agg(requested_mappings.department_name ORDER BY requested_mappings.department_name)
  INTO missing_departments
  FROM requested_mappings
  LEFT JOIN public.master_departments
    ON public.master_departments.name = requested_mappings.department_name
  WHERE public.master_departments.id IS NULL;

  IF missing_departments IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot seed master_department_responsible_mappings. Missing master_departments rows: %',
      array_to_string(missing_departments, ', ');
  END IF;

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
  SELECT COUNT(*)
  INTO resolved_mapping_count
  FROM resolved_mappings;

  IF resolved_mapping_count <> expected_mapping_count THEN
    RAISE EXCEPTION
      'Cannot seed master_department_responsible_mappings. Expected % resolved mappings but found %.',
      expected_mapping_count,
      resolved_mapping_count;
  END IF;
END;
$$;

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
INSERT INTO public.master_department_responsible_mappings (
  department_id,
  responsible_department_code,
  is_active
)
SELECT
  resolved_mappings.department_id,
  resolved_mappings.responsible_department_code,
  true
FROM resolved_mappings
ON CONFLICT (department_id, responsible_department_code)
DO UPDATE
SET is_active = true;

COMMIT;