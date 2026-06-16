-- Adds server-side pagination (p_limit, p_offset) and total_count to
-- get_employee_claim_master. The existing function must be dropped first
-- because adding a return column constitutes a signature change in Postgres.

BEGIN;

DROP FUNCTION IF EXISTS public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT);

CREATE FUNCTION public.get_employee_claim_master(
  p_hod_department_ids  UUID[]  DEFAULT '{}',
  p_date_from           DATE    DEFAULT NULL,
  p_date_to             DATE    DEFAULT NULL,
  p_status              TEXT    DEFAULT NULL,
  p_department_id       UUID    DEFAULT NULL,
  p_expense_category_id UUID    DEFAULT NULL,
  p_employee_search     TEXT    DEFAULT NULL,
  p_limit               INT     DEFAULT 10,
  p_offset              INT     DEFAULT 0
)
RETURNS TABLE (
  employee_id    TEXT,
  employee_name  TEXT,
  total_amount   NUMERIC,
  claim_count    BIGINT,
  expense_amount NUMERIC,
  advance_amount NUMERIC,
  total_count    BIGINT
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
      AND (p_date_from IS NULL OR COALESCE(c.submitted_at, c.created_at)::DATE >= p_date_from)
      AND (p_date_to   IS NULL OR COALESCE(c.submitted_at, c.created_at)::DATE <= p_date_to)
      AND (
        array_length(p_hod_department_ids, 1) IS NULL
        OR c.department_id = ANY(p_hod_department_ids)
      )
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
      MAX(employee_name)   AS employee_name,
      SUM(amount)          AS total_amount,
      COUNT(*)::BIGINT     AS claim_count,
      SUM(expense_amount)  AS expense_amount,
      SUM(advance_amount)  AS advance_amount
    FROM base
    GROUP BY employee_id
  ),
  filtered AS (
    SELECT *
    FROM grouped
    WHERE
      p_employee_search IS NULL
      OR TRIM(p_employee_search) = ''
      OR employee_name ILIKE '%' || TRIM(p_employee_search) || '%'
    ORDER BY total_amount DESC
  )
  SELECT
    employee_id,
    employee_name,
    total_amount::NUMERIC,
    claim_count,
    expense_amount::NUMERIC,
    advance_amount::NUMERIC,
    COUNT(*) OVER()::BIGINT AS total_count
  FROM filtered
  LIMIT  p_limit
  OFFSET p_offset;
$$;

REVOKE ALL    ON FUNCTION public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_employee_claim_master(UUID[], DATE, DATE, TEXT, UUID, UUID, TEXT, INT, INT) TO service_role;

COMMIT;
