BEGIN;

WITH requested_locations(name) AS (
  VALUES
    ('Presales-Hyderabad'),
    ('Presales-Indore'),
    ('Presales-Kochi'),
    ('NIAT - Alard University'),
    ('NIAT - Best Innovation University'),
    ('NIAT - Chaitanya University'),
    ('NIAT - Chalapathi'),
    ('NIAT - Geeta University'),
    ('NIAT - Joy University'),
    ('NIAT - Sandip University'),
    ('NIAT - Sansikriti University'),
    ('NIAT - Scope Global Skill University'),
    ('NIAT - St Peter''s Bengaluru'),
    ('NIAT - St Peter''s Chennai'),
    ('NIAT - Sushant University'),
    ('NIAT - Yenepoya University - Bengaluru')
)
INSERT INTO public.master_locations (
  name,
  is_active
)
SELECT
  requested_locations.name,
  true
FROM requested_locations
ON CONFLICT (name)
DO UPDATE
SET
  is_active = true,
  updated_at = now();

COMMIT;