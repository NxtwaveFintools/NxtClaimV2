-- Rename "Car Lease Policy" department to "Employee Car Lease"
-- Safe: all references use the UUID (a64cfeb5-a5d4-4f20-9c43-e58fac09244e), not the name.

UPDATE master_departments
SET name = 'Employee Car Lease',
    updated_at = now()
WHERE id = 'a64cfeb5-a5d4-4f20-9c43-e58fac09244e'
  AND name = 'Car Lease Policy';
