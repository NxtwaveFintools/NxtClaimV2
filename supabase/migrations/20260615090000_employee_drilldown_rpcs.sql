-- Employee Drill-Down RPCs
-- Aggregates claims by beneficiary (on_behalf_of_id) with strict department
-- scoping applied in the WHERE clause before any GROUP BY. These functions
-- back the Analytics Command Center employee leaderboard and detail panel.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC 1: get_employee_claim_master
-- Returns a ranked leaderboard of beneficiaries within the permitted scope.
-- When p_hod_department_ids is non-empty, ONLY claims in those departments
-- are counted — this is the strict cross-department isolation guarantee.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_employee_claim_master(
  p_hod_department_ids  UUID[]  DEFAULT '{}',
  p_date_from           DATE    DEFAULT NULL,
  p_date_to             DATE    DEFAULT NULL,
  p_status              TEXT    DEFAULT NULL,
  p_department_id       UUID    DEFAULT NULL,
  p_expense_category_id UUID    DEFAULT NULL,
  p_employee_search     TEXT    DEFAULT NULL
)
RETURNS TABLE (
  employee_id    TEXT,
  employee_name  TEXT,
  total_amount   NUMERIC,
  claim_count    BIGINT,
  expense_amount NUMERIC,
  advance_amount NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      c.on_behalf_of_id::TEXT                                                   AS employee_id,
      COALESCE(
        NULLIF(TRIM(b.full_name),                ''),
        NULLIF(TRIM(split_part(b.email, '@', 1)), ''),
        NULLIF(TRIM(c.on_behalf_email),           ''),
        'Unknown'
      )                                                                          AS employee_name,
      COALESCE(ed.total_amount, ad.total_amount, 0)::NUMERIC                    AS amount,
      CASE WHEN c.detail_type = 'expense'
           THEN COALESCE(ed.total_amount, 0)::NUMERIC ELSE 0 END                AS expense_amount,
      CASE WHEN c.detail_type = 'advance'
           THEN COALESCE(ad.total_amount, 0)::NUMERIC ELSE 0 END                AS advance_amount
    FROM public.claims c
    LEFT JOIN public.users              b   ON b.id  = c.on_behalf_of_id
    LEFT JOIN public.expense_details    ed  ON ed.claim_id = c.id AND ed.is_active = true
    LEFT JOIN public.advance_details    ad  ON ad.claim_id = c.id AND ad.is_active = true
    WHERE
      c.is_active = true
      -- Date scoping
      AND (p_date_from IS NULL OR COALESCE(c.submitted_at, c.created_at)::DATE >= p_date_from)
      AND (p_date_to   IS NULL OR COALESCE(c.submitted_at, c.created_at)::DATE <= p_date_to)
      -- STRICT DEPARTMENT SCOPING: applied before any aggregation
      AND (
        array_length(p_hod_department_ids, 1) IS NULL
        OR c.department_id = ANY(p_hod_department_ids)
      )
      -- Optional narrowing filters
      AND (p_status          IS NULL OR c.status::TEXT        = p_status)
      AND (p_department_id   IS NULL OR c.department_id       = p_department_id)
      AND (
        p_expense_category_id IS NULL
        OR (c.detail_type = 'expense' AND ed.expense_category_id = p_expense_category_id)
      )
  ),
  grouped AS (
    SELECT
      employee_id,
      MAX(employee_name)      AS employee_name,
      SUM(amount)             AS total_amount,
      COUNT(*)::BIGINT        AS claim_count,
      SUM(expense_amount)     AS expense_amount,
      SUM(advance_amount)     AS advance_amount
    FROM base
    GROUP BY employee_id
  )
  SELECT
    employee_id,
    employee_name,
    total_amount::NUMERIC,
    claim_count,
    expense_amount::NUMERIC,
    advance_amount::NUMERIC
  FROM grouped
  WHERE
    p_employee_search IS NULL
    OR TRIM(p_employee_search) = ''
    OR employee_name ILIKE '%' || TRIM(p_employee_search) || '%'
  ORDER BY total_amount DESC;
$$;

REVOKE ALL   ON FUNCTION public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- RPC 2: get_employee_claim_detail
-- Returns a JSONB breakdown for a single beneficiary within the permitted scope.
-- Applies the same strict department guard before any aggregation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_employee_claim_detail(
  p_employee_id         TEXT,
  p_hod_department_ids  UUID[]  DEFAULT '{}',
  p_date_from           DATE    DEFAULT NULL,
  p_date_to             DATE    DEFAULT NULL,
  p_status              TEXT    DEFAULT NULL,
  p_department_id       UUID    DEFAULT NULL,
  p_expense_category_id UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH scoped AS (
    SELECT
      c.detail_type,
      COALESCE(ed.total_amount, ad.total_amount, 0)::NUMERIC AS amount,
      CASE
        WHEN c.detail_type = 'expense'
          THEN COALESCE(NULLIF(TRIM(mec.name), ''), 'Uncategorized')
        ELSE 'Advance'
      END AS category_name
    FROM public.claims c
    LEFT JOIN public.expense_details          ed  ON ed.claim_id = c.id AND ed.is_active = true
    LEFT JOIN public.advance_details          ad  ON ad.claim_id = c.id AND ad.is_active = true
    LEFT JOIN public.master_expense_categories mec ON mec.id    = ed.expense_category_id
    WHERE
      c.is_active = true
      AND c.on_behalf_of_id::TEXT = p_employee_id
      -- Date scoping
      AND (p_date_from IS NULL OR COALESCE(c.submitted_at, c.created_at)::DATE >= p_date_from)
      AND (p_date_to   IS NULL OR COALESCE(c.submitted_at, c.created_at)::DATE <= p_date_to)
      -- STRICT DEPARTMENT SCOPING: applied before any aggregation
      AND (
        array_length(p_hod_department_ids, 1) IS NULL
        OR c.department_id = ANY(p_hod_department_ids)
      )
      -- Optional narrowing filters
      AND (p_status          IS NULL OR c.status::TEXT        = p_status)
      AND (p_department_id   IS NULL OR c.department_id       = p_department_id)
      AND (
        p_expense_category_id IS NULL
        OR (c.detail_type = 'expense' AND ed.expense_category_id = p_expense_category_id)
      )
  ),
  totals AS (
    SELECT
      COALESCE(SUM(amount), 0)                                                    AS total_amount,
      COALESCE(SUM(CASE WHEN detail_type = 'expense' THEN amount ELSE 0 END), 0)  AS expense_amount,
      COALESCE(SUM(CASE WHEN detail_type = 'advance' THEN amount ELSE 0 END), 0)  AS advance_amount,
      COALESCE(MAX(amount), 0)                                                     AS largest_claim_amount
    FROM scoped
  ),
  cats AS (
    SELECT
      category_name,
      SUM(amount)::NUMERIC   AS cat_amount,
      COUNT(*)::BIGINT       AS cat_count
    FROM scoped
    GROUP BY category_name
  )
  SELECT jsonb_build_object(
    'totalAmount',          t.total_amount,
    'expenseAmount',        t.expense_amount,
    'advanceAmount',        t.advance_amount,
    'largestClaimAmount',   t.largest_claim_amount,
    'mostFrequentCategory', (
      SELECT category_name FROM cats
      ORDER BY cat_count DESC, cat_amount DESC
      LIMIT 1
    ),
    'categoryBreakdown', COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object(
           'categoryName', c2.category_name,
           'amount',       c2.cat_amount,
           'count',        c2.cat_count
         ) ORDER BY c2.cat_amount DESC
       )
       FROM cats c2),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM totals t;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL    ON FUNCTION public.get_employee_claim_detail(TEXT, UUID[], DATE, DATE, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.get_employee_claim_detail(TEXT, UUID[], DATE, DATE, TEXT, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_employee_claim_detail(TEXT, UUID[], DATE, DATE, TEXT, UUID, UUID) TO service_role;

COMMIT;
