-- Rename "Car Lease Policy" department to "Employee Car Lease"
-- Safe: all foreign keys reference the department by UUID, not by name.
-- Uses name-based lookup so this works across all environments (test, staging, prod).

UPDATE master_departments
SET name = 'Employee Car Lease',
    updated_at = now()
WHERE name = 'Car Lease Policy';
