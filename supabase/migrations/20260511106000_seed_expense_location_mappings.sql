BEGIN;

DO $$
DECLARE
  missing_locations TEXT[];
  resolved_mapping_count INTEGER;
  expected_mapping_count CONSTANT INTEGER := 77;
BEGIN
  WITH requested_mappings(location_name, region_code) AS (
    VALUES
      ('Presales-Bangalore', 'KANNADA'),
      ('Presales-Bhubaneswar', 'HINDI'),
      ('Presales-Bikaner', 'HINDI'),
      ('Presales-Chennai', 'TAMIL'),
      ('Presales-Coimbatore', 'TAMIL'),
      ('Presales-Delhi', 'HINDI'),
      ('Presales-Durgapur', 'HINDI'),
      ('Presales-Ernakulam', 'MALAYALAM'),
      ('Presales-Hubli', 'KANNADA'),
      ('Presales-Hyderabad', 'TELUGU'),
      ('Presales-Indore', 'HINDI'),
      ('Presales-Jaipur', 'HINDI'),
      ('Presales-Kochi', 'MALAYALAM'),
      ('Presales-Kolkata', 'HINDI'),
      ('Presales-Kurnool', 'TELUGU'),
      ('Presales-Lucknow', 'HINDI'),
      ('Presales-Madurai', 'TAMIL'),
      ('Presales-Maharastra', 'MARATHI'),
      ('Presales-Mangalore', 'KANNADA'),
      ('Presales-Mysore', 'KANNADA'),
      ('Presales-Nagpur', 'MARATHI'),
      ('Presales-Nashik', 'MARATHI'),
      ('Presales-New Delhi', 'HINDI'),
      ('Presales-Noida', 'HINDI'),
      ('Presales-Odisha', 'HINDI'),
      ('Presales-Pune', 'MARATHI'),
      ('Presales-Rajahmundry', 'TELUGU'),
      ('Presales-Rajasthan', 'HINDI'),
      ('Presales-Rourkella', 'HINDI'),
      ('Presales-Sangareddy', 'TELUGU'),
      ('Presales-Sikar', 'HINDI'),
      ('Presales-Siliguri', 'HINDI'),
      ('Presales-Tamilnadu', 'TAMIL'),
      ('Presales-Tirupathi', 'TELUGU'),
      ('Presales-Vijayawada', 'TELUGU'),
      ('Presales-Vizag', 'TELUGU'),
      ('Presales-Warangal', 'TELUGU'),
      ('Presales-West Bengal', 'HINDI'),
      ('Office - Hyd Brigade', 'COMMON'),
      ('Office - Hyd KKH', 'COMMON'),
      ('Office - Hyd Other', 'COMMON'),
      ('NIAT - Aurora', 'NIAT - AURORA'),
      ('NIAT - Yenepoya Managlore', 'NIAT - YENEPOYA - MA'),
      ('NIAT - CDU', 'NIAT - CDU'),
      ('NIAT - Takshasila', 'NIAT - TAKSHASILA'),
      ('NIAT - S-Vyasa', 'NIAT - S-VYASA'),
      ('NIAT - BITS - Farah', 'NIAT - BITS (FARAH)'),
      ('NIAT - AMET', 'NIAT - AMET'),
      ('NIAT - CIET - LAM', 'NIAT - CIET'),
      ('NIAT - NIU', 'NIAT - NIU'),
      ('NIAT - ADYPU', 'NIAT - ADYPU'),
      ('NIAT - VGU', 'NIAT - VGU'),
      ('NIAT - CITY - Mothadaka', 'NIAT - CITY'),
      ('NIAT - NSRIT', 'NIAT - NSRIT'),
      ('NIAT - NRI', 'NIAT - NRI'),
      ('NIAT - Mallareddy', 'NIAT - MALLAREDDY'),
      ('NIAT - Annamacharya', 'NIAT - ANNAMACHARYA'),
      ('NIAT - SGU', 'NIAT - SGU'),
      ('NIAT - Sharda', 'NIAT - SHARDA'),
      ('NIAT - Crescent', 'NIAT - CRESCENT'),
      ('Other', 'COMMON'),
      ('Presales-KERALA', 'MALAYALAM'),
      ('Presales-Kota', 'HINDI'),
      ('Presales-Karnataka', 'KANNADA'),
      ('NIAT - Alard University', 'NIAT - Alard University'),
      ('NIAT - Best Innovation University', 'NIAT - Best Innovation University'),
      ('NIAT - Chaitanya University', 'NIAT - Chaitanya University'),
      ('NIAT - Chalapathi', 'NIAT - Chalapathi'),
      ('NIAT - Geeta University', 'NIAT - Geeta University'),
      ('NIAT - Joy University', 'NIAT - Joy University'),
      ('NIAT - Sandip University', 'NIAT - Sandip University'),
      ('NIAT - Sansikriti University', 'NIAT - Sansikriti University'),
      ('NIAT - Scope Global Skill University', 'NIAT - Scope Global Skill University'),
      ('NIAT - St Peter''s Bengaluru', 'NIAT - St Peter''s Bengaluru'),
      ('NIAT - St Peter''s Chennai', 'NIAT - St Peter''s Chennai'),
      ('NIAT - Sushant University', 'NIAT - Sushant University'),
      ('NIAT - Yenepoya University - Bengaluru', 'NIAT - Yenepoya University - Bengaluru')
  )
  SELECT array_agg(requested_mappings.location_name ORDER BY requested_mappings.location_name)
  INTO missing_locations
  FROM requested_mappings
  LEFT JOIN public.master_locations
    ON public.master_locations.name = requested_mappings.location_name
  WHERE public.master_locations.id IS NULL;

  IF missing_locations IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot seed master_expense_location_mappings. Missing master_locations rows: %',
      array_to_string(missing_locations, ', ');
  END IF;

  WITH requested_mappings(location_name, region_code) AS (
    VALUES
      ('Presales-Bangalore', 'KANNADA'),
      ('Presales-Bhubaneswar', 'HINDI'),
      ('Presales-Bikaner', 'HINDI'),
      ('Presales-Chennai', 'TAMIL'),
      ('Presales-Coimbatore', 'TAMIL'),
      ('Presales-Delhi', 'HINDI'),
      ('Presales-Durgapur', 'HINDI'),
      ('Presales-Ernakulam', 'MALAYALAM'),
      ('Presales-Hubli', 'KANNADA'),
      ('Presales-Hyderabad', 'TELUGU'),
      ('Presales-Indore', 'HINDI'),
      ('Presales-Jaipur', 'HINDI'),
      ('Presales-Kochi', 'MALAYALAM'),
      ('Presales-Kolkata', 'HINDI'),
      ('Presales-Kurnool', 'TELUGU'),
      ('Presales-Lucknow', 'HINDI'),
      ('Presales-Madurai', 'TAMIL'),
      ('Presales-Maharastra', 'MARATHI'),
      ('Presales-Mangalore', 'KANNADA'),
      ('Presales-Mysore', 'KANNADA'),
      ('Presales-Nagpur', 'MARATHI'),
      ('Presales-Nashik', 'MARATHI'),
      ('Presales-New Delhi', 'HINDI'),
      ('Presales-Noida', 'HINDI'),
      ('Presales-Odisha', 'HINDI'),
      ('Presales-Pune', 'MARATHI'),
      ('Presales-Rajahmundry', 'TELUGU'),
      ('Presales-Rajasthan', 'HINDI'),
      ('Presales-Rourkella', 'HINDI'),
      ('Presales-Sangareddy', 'TELUGU'),
      ('Presales-Sikar', 'HINDI'),
      ('Presales-Siliguri', 'HINDI'),
      ('Presales-Tamilnadu', 'TAMIL'),
      ('Presales-Tirupathi', 'TELUGU'),
      ('Presales-Vijayawada', 'TELUGU'),
      ('Presales-Vizag', 'TELUGU'),
      ('Presales-Warangal', 'TELUGU'),
      ('Presales-West Bengal', 'HINDI'),
      ('Office - Hyd Brigade', 'COMMON'),
      ('Office - Hyd KKH', 'COMMON'),
      ('Office - Hyd Other', 'COMMON'),
      ('NIAT - Aurora', 'NIAT - AURORA'),
      ('NIAT - Yenepoya Managlore', 'NIAT - YENEPOYA - MA'),
      ('NIAT - CDU', 'NIAT - CDU'),
      ('NIAT - Takshasila', 'NIAT - TAKSHASILA'),
      ('NIAT - S-Vyasa', 'NIAT - S-VYASA'),
      ('NIAT - BITS - Farah', 'NIAT - BITS (FARAH)'),
      ('NIAT - AMET', 'NIAT - AMET'),
      ('NIAT - CIET - LAM', 'NIAT - CIET'),
      ('NIAT - NIU', 'NIAT - NIU'),
      ('NIAT - ADYPU', 'NIAT - ADYPU'),
      ('NIAT - VGU', 'NIAT - VGU'),
      ('NIAT - CITY - Mothadaka', 'NIAT - CITY'),
      ('NIAT - NSRIT', 'NIAT - NSRIT'),
      ('NIAT - NRI', 'NIAT - NRI'),
      ('NIAT - Mallareddy', 'NIAT - MALLAREDDY'),
      ('NIAT - Annamacharya', 'NIAT - ANNAMACHARYA'),
      ('NIAT - SGU', 'NIAT - SGU'),
      ('NIAT - Sharda', 'NIAT - SHARDA'),
      ('NIAT - Crescent', 'NIAT - CRESCENT'),
      ('Other', 'COMMON'),
      ('Presales-KERALA', 'MALAYALAM'),
      ('Presales-Kota', 'HINDI'),
      ('Presales-Karnataka', 'KANNADA'),
      ('NIAT - Alard University', 'NIAT - Alard University'),
      ('NIAT - Best Innovation University', 'NIAT - Best Innovation University'),
      ('NIAT - Chaitanya University', 'NIAT - Chaitanya University'),
      ('NIAT - Chalapathi', 'NIAT - Chalapathi'),
      ('NIAT - Geeta University', 'NIAT - Geeta University'),
      ('NIAT - Joy University', 'NIAT - Joy University'),
      ('NIAT - Sandip University', 'NIAT - Sandip University'),
      ('NIAT - Sansikriti University', 'NIAT - Sansikriti University'),
      ('NIAT - Scope Global Skill University', 'NIAT - Scope Global Skill University'),
      ('NIAT - St Peter''s Bengaluru', 'NIAT - St Peter''s Bengaluru'),
      ('NIAT - St Peter''s Chennai', 'NIAT - St Peter''s Chennai'),
      ('NIAT - Sushant University', 'NIAT - Sushant University'),
      ('NIAT - Yenepoya University - Bengaluru', 'NIAT - Yenepoya University - Bengaluru')
  ),
  resolved_mappings AS (
    SELECT
      public.master_locations.id AS location_id,
      requested_mappings.region_code
    FROM requested_mappings
    INNER JOIN public.master_locations
      ON public.master_locations.name = requested_mappings.location_name
  )
  SELECT COUNT(*)
  INTO resolved_mapping_count
  FROM resolved_mappings;

  IF resolved_mapping_count <> expected_mapping_count THEN
    RAISE EXCEPTION
      'Cannot seed master_expense_location_mappings. Expected % resolved mappings but found %.',
      expected_mapping_count,
      resolved_mapping_count;
  END IF;
END;
$$;

WITH requested_mappings(location_name, region_code) AS (
  VALUES
    ('Presales-Bangalore', 'KANNADA'),
    ('Presales-Bhubaneswar', 'HINDI'),
    ('Presales-Bikaner', 'HINDI'),
    ('Presales-Chennai', 'TAMIL'),
    ('Presales-Coimbatore', 'TAMIL'),
    ('Presales-Delhi', 'HINDI'),
    ('Presales-Durgapur', 'HINDI'),
    ('Presales-Ernakulam', 'MALAYALAM'),
    ('Presales-Hubli', 'KANNADA'),
    ('Presales-Hyderabad', 'TELUGU'),
    ('Presales-Indore', 'HINDI'),
    ('Presales-Jaipur', 'HINDI'),
    ('Presales-Kochi', 'MALAYALAM'),
    ('Presales-Kolkata', 'HINDI'),
    ('Presales-Kurnool', 'TELUGU'),
    ('Presales-Lucknow', 'HINDI'),
    ('Presales-Madurai', 'TAMIL'),
    ('Presales-Maharastra', 'MARATHI'),
    ('Presales-Mangalore', 'KANNADA'),
    ('Presales-Mysore', 'KANNADA'),
    ('Presales-Nagpur', 'MARATHI'),
    ('Presales-Nashik', 'MARATHI'),
    ('Presales-New Delhi', 'HINDI'),
    ('Presales-Noida', 'HINDI'),
    ('Presales-Odisha', 'HINDI'),
    ('Presales-Pune', 'MARATHI'),
    ('Presales-Rajahmundry', 'TELUGU'),
    ('Presales-Rajasthan', 'HINDI'),
    ('Presales-Rourkella', 'HINDI'),
    ('Presales-Sangareddy', 'TELUGU'),
    ('Presales-Sikar', 'HINDI'),
    ('Presales-Siliguri', 'HINDI'),
    ('Presales-Tamilnadu', 'TAMIL'),
    ('Presales-Tirupathi', 'TELUGU'),
    ('Presales-Vijayawada', 'TELUGU'),
    ('Presales-Vizag', 'TELUGU'),
    ('Presales-Warangal', 'TELUGU'),
    ('Presales-West Bengal', 'HINDI'),
    ('Office - Hyd Brigade', 'COMMON'),
    ('Office - Hyd KKH', 'COMMON'),
    ('Office - Hyd Other', 'COMMON'),
    ('NIAT - Aurora', 'NIAT - AURORA'),
    ('NIAT - Yenepoya Managlore', 'NIAT - YENEPOYA - MA'),
    ('NIAT - CDU', 'NIAT - CDU'),
    ('NIAT - Takshasila', 'NIAT - TAKSHASILA'),
    ('NIAT - S-Vyasa', 'NIAT - S-VYASA'),
    ('NIAT - BITS - Farah', 'NIAT - BITS (FARAH)'),
    ('NIAT - AMET', 'NIAT - AMET'),
    ('NIAT - CIET - LAM', 'NIAT - CIET'),
    ('NIAT - NIU', 'NIAT - NIU'),
    ('NIAT - ADYPU', 'NIAT - ADYPU'),
    ('NIAT - VGU', 'NIAT - VGU'),
    ('NIAT - CITY - Mothadaka', 'NIAT - CITY'),
    ('NIAT - NSRIT', 'NIAT - NSRIT'),
    ('NIAT - NRI', 'NIAT - NRI'),
    ('NIAT - Mallareddy', 'NIAT - MALLAREDDY'),
    ('NIAT - Annamacharya', 'NIAT - ANNAMACHARYA'),
    ('NIAT - SGU', 'NIAT - SGU'),
    ('NIAT - Sharda', 'NIAT - SHARDA'),
    ('NIAT - Crescent', 'NIAT - CRESCENT'),
    ('Other', 'COMMON'),
    ('Presales-KERALA', 'MALAYALAM'),
    ('Presales-Kota', 'HINDI'),
    ('Presales-Karnataka', 'KANNADA'),
    ('NIAT - Alard University', 'NIAT - Alard University'),
    ('NIAT - Best Innovation University', 'NIAT - Best Innovation University'),
    ('NIAT - Chaitanya University', 'NIAT - Chaitanya University'),
    ('NIAT - Chalapathi', 'NIAT - Chalapathi'),
    ('NIAT - Geeta University', 'NIAT - Geeta University'),
    ('NIAT - Joy University', 'NIAT - Joy University'),
    ('NIAT - Sandip University', 'NIAT - Sandip University'),
    ('NIAT - Sansikriti University', 'NIAT - Sansikriti University'),
    ('NIAT - Scope Global Skill University', 'NIAT - Scope Global Skill University'),
    ('NIAT - St Peter''s Bengaluru', 'NIAT - St Peter''s Bengaluru'),
    ('NIAT - St Peter''s Chennai', 'NIAT - St Peter''s Chennai'),
    ('NIAT - Sushant University', 'NIAT - Sushant University'),
    ('NIAT - Yenepoya University - Bengaluru', 'NIAT - Yenepoya University - Bengaluru')
),
resolved_mappings AS (
  SELECT
    public.master_locations.id AS location_id,
    requested_mappings.region_code
  FROM requested_mappings
  INNER JOIN public.master_locations
    ON public.master_locations.name = requested_mappings.location_name
)
INSERT INTO public.master_expense_location_mappings (
  location_id,
  region_code,
  is_active
)
SELECT
  resolved_mappings.location_id,
  resolved_mappings.region_code,
  true
FROM resolved_mappings
ON CONFLICT (location_id, region_code)
DO UPDATE
SET is_active = true;

COMMIT;