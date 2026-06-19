-- HOD Pending Claims Summary RPC, security grants, and performance index
-- Created: 2026-06-19

-- ============================================================
-- UP MIGRATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_hod_pending_summary(
  p_hod_user_id   UUID,
  p_target_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH

-- 1. All active claims assigned to the HOD, optionally filtered by status
base_claims AS (
  SELECT
    c.id                                             AS claim_id,
    COALESCE(c.on_behalf_of_id, c.submitted_by)      AS beneficiary_id,
    c.detail_type
  FROM public.claims c
  WHERE c.assigned_l1_approver_id = p_hod_user_id
    AND c.is_active = true
    AND (p_target_status IS NULL OR c.status::text = p_target_status)
),

-- 2. Expense amounts grouped by beneficiary
expense_base AS (
  SELECT
    bc.beneficiary_id,
    SUM(ed.total_amount)        AS total,
    COUNT(DISTINCT bc.claim_id) AS claim_count
  FROM base_claims bc
  JOIN public.expense_details ed ON ed.claim_id = bc.claim_id AND ed.is_active = true
  WHERE bc.detail_type = 'expense'
  GROUP BY bc.beneficiary_id
),

-- 3. Advance amounts grouped by beneficiary
advance_base AS (
  SELECT
    bc.beneficiary_id,
    SUM(ad.total_amount)        AS total,
    COUNT(DISTINCT bc.claim_id) AS claim_count
  FROM base_claims bc
  JOIN public.advance_details ad ON ad.claim_id = bc.claim_id AND ad.is_active = true
  WHERE bc.detail_type = 'advance'
  GROUP BY bc.beneficiary_id
),

-- 4. Expense amounts grouped by category
expense_cats_base AS (
  SELECT
    ed.expense_category_id,
    SUM(ed.total_amount) AS total
  FROM base_claims bc
  JOIN public.expense_details ed ON ed.claim_id = bc.claim_id AND ed.is_active = true
  WHERE bc.detail_type = 'expense'
  GROUP BY ed.expense_category_id
),

-- 5. Rank expense employees with resolved display names
expense_employees_ranked AS (
  SELECT
    eb.beneficiary_id,
    COALESCE(
      NULLIF(TRIM(u.full_name), ''),
      NULLIF(TRIM(split_part(u.email, '@', 1)), ''),
      'Unknown'
    )                                              AS employee_name,
    eb.total                                       AS amount,
    eb.claim_count,
    ROW_NUMBER() OVER (ORDER BY eb.total DESC)     AS rn
  FROM expense_base eb
  LEFT JOIN public.users u ON u.id = eb.beneficiary_id
),

-- 6. Rank advance employees with resolved display names
advance_employees_ranked AS (
  SELECT
    ab.beneficiary_id,
    COALESCE(
      NULLIF(TRIM(u.full_name), ''),
      NULLIF(TRIM(split_part(u.email, '@', 1)), ''),
      'Unknown'
    )                                              AS employee_name,
    ab.total                                       AS amount,
    ab.claim_count,
    ROW_NUMBER() OVER (ORDER BY ab.total DESC)     AS rn
  FROM advance_base ab
  LEFT JOIN public.users u ON u.id = ab.beneficiary_id
),

-- 7. Rank expense categories with resolved names
expense_cats_ranked AS (
  SELECT
    ecb.expense_category_id,
    COALESCE(mec.name, 'Unknown')                  AS category_name,
    ecb.total                                      AS amount,
    ROW_NUMBER() OVER (ORDER BY ecb.total DESC)    AS rn
  FROM expense_cats_base ecb
  LEFT JOIN public.master_expense_categories mec ON mec.id = ecb.expense_category_id
),

-- 8. Top-10 + Others aggregation for expense employees
-- Grand total is computed across ALL rows (not derived from top-10 + others)
-- so that top_rows_sum + others_total = grand_total holds exactly.
expense_emp_agg AS (
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'employee_id',   beneficiary_id,
          'employee_name', employee_name,
          'amount',        amount,
          'claim_count',   claim_count
        ) ORDER BY amount DESC
      ) FILTER (WHERE rn <= 10),
      '[]'::jsonb
    )                                                       AS top_rows,
    COALESCE(SUM(amount) FILTER (WHERE rn > 10), 0)        AS others_total,
    COUNT(*)            FILTER (WHERE rn > 10)              AS others_count,
    COALESCE(SUM(amount), 0)                                AS grand_total
  FROM expense_employees_ranked
),

-- 9. Top-10 + Others aggregation for advance employees
advance_emp_agg AS (
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'employee_id',   beneficiary_id,
          'employee_name', employee_name,
          'amount',        amount,
          'claim_count',   claim_count
        ) ORDER BY amount DESC
      ) FILTER (WHERE rn <= 10),
      '[]'::jsonb
    )                                                       AS top_rows,
    COALESCE(SUM(amount) FILTER (WHERE rn > 10), 0)        AS others_total,
    COUNT(*)            FILTER (WHERE rn > 10)              AS others_count,
    COALESCE(SUM(amount), 0)                                AS grand_total
  FROM advance_employees_ranked
),

-- 10. Top-10 + Others aggregation for expense categories
expense_cats_agg AS (
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'category_id',   expense_category_id,
          'category_name', category_name,
          'amount',        amount
        ) ORDER BY amount DESC
      ) FILTER (WHERE rn <= 10),
      '[]'::jsonb
    )                                                       AS top_rows,
    COALESCE(SUM(amount) FILTER (WHERE rn > 10), 0)        AS others_total,
    COUNT(*)            FILTER (WHERE rn > 10)              AS others_count,
    COALESCE(SUM(amount), 0)                                AS grand_total
  FROM expense_cats_ranked
)

SELECT jsonb_build_object(
  'top_expense_employees', jsonb_build_object(
    'rows',         eea.top_rows,
    'others_total', eea.others_total,
    'others_count', eea.others_count,
    'grand_total',  eea.grand_total
  ),
  'top_advance_employees', jsonb_build_object(
    'rows',         aea.top_rows,
    'others_total', aea.others_total,
    'others_count', aea.others_count,
    'grand_total',  aea.grand_total
  ),
  'top_expense_categories', jsonb_build_object(
    'rows',         eca.top_rows,
    'others_total', eca.others_total,
    'others_count', eca.others_count,
    'grand_total',  eca.grand_total
  )
)
FROM expense_emp_agg eea, advance_emp_agg aea, expense_cats_agg eca;
$$;

REVOKE ALL     ON FUNCTION public.get_hod_pending_summary(UUID, TEXT) FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.get_hod_pending_summary(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_hod_pending_summary(UUID, TEXT) TO   service_role;

-- Partial composite index: supports the RPC's primary WHERE clause on active claims only.
-- Partial predicate (is_active = true) keeps the index lean by excluding soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_claims_l1_approver_status
  ON public.claims (assigned_l1_approver_id, status)
  WHERE is_active = true;

-- ============================================================
-- DOWN MIGRATION (run manually if rollback is required)
-- ============================================================
-- DROP FUNCTION IF EXISTS public.get_hod_pending_summary(UUID, TEXT);
-- DROP INDEX    IF EXISTS public.idx_claims_l1_approver_status;
