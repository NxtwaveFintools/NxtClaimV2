-- Add Finance Approval TAT tracking into analytics cache and payload.
-- TAT is measured as finance_action_date - hod_action_date for terminal finance actions.

ALTER TABLE public.claims_analytics_daily_stats
  ADD COLUMN IF NOT EXISTS finance_approval_hours numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finance_approval_samples integer NOT NULL DEFAULT 0;

ALTER TABLE public.claims_analytics_snapshot
  ADD COLUMN IF NOT EXISTS finance_approval_hours numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finance_approval_samples integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'claims_analytics_daily_stats_finance_approval_hours_check'
      AND conrelid = 'public.claims_analytics_daily_stats'::regclass
  ) THEN
    ALTER TABLE public.claims_analytics_daily_stats
      ADD CONSTRAINT claims_analytics_daily_stats_finance_approval_hours_check
      CHECK (finance_approval_hours >= 0::numeric);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'claims_analytics_daily_stats_finance_approval_samples_check'
      AND conrelid = 'public.claims_analytics_daily_stats'::regclass
  ) THEN
    ALTER TABLE public.claims_analytics_daily_stats
      ADD CONSTRAINT claims_analytics_daily_stats_finance_approval_samples_check
      CHECK (finance_approval_samples >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'claims_analytics_snapshot_finance_approval_hours_check'
      AND conrelid = 'public.claims_analytics_snapshot'::regclass
  ) THEN
    ALTER TABLE public.claims_analytics_snapshot
      ADD CONSTRAINT claims_analytics_snapshot_finance_approval_hours_check
      CHECK (finance_approval_hours >= 0::numeric);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'claims_analytics_snapshot_finance_approval_samples_check'
      AND conrelid = 'public.claims_analytics_snapshot'::regclass
  ) THEN
    ALTER TABLE public.claims_analytics_snapshot
      ADD CONSTRAINT claims_analytics_snapshot_finance_approval_samples_check
      CHECK (finance_approval_samples >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_claims_analytics_delta(
  p_date_key date,
  p_status public.claim_status,
  p_department_id uuid,
  p_payment_mode_id uuid,
  p_expense_category_id uuid,
  p_product_id uuid,
  p_assigned_l2_approver_id uuid,
  p_claim_count_delta integer,
  p_total_amount_delta numeric,
  p_hod_approval_hours_delta numeric,
  p_hod_approval_sample_delta integer,
  p_finance_approval_hours_delta numeric,
  p_finance_approval_sample_delta integer
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_bucket_key text;
BEGIN
  IF p_date_key IS NULL OR p_status IS NULL THEN
    RETURN;
  END IF;

  IF coalesce(p_claim_count_delta, 0) = 0
     AND coalesce(p_total_amount_delta, 0) = 0
     AND coalesce(p_hod_approval_hours_delta, 0) = 0
     AND coalesce(p_hod_approval_sample_delta, 0) = 0
     AND coalesce(p_finance_approval_hours_delta, 0) = 0
     AND coalesce(p_finance_approval_sample_delta, 0) = 0 THEN
    RETURN;
  END IF;

  v_bucket_key := public.make_claims_analytics_bucket_key(
    p_date_key,
    p_status,
    p_department_id,
    p_payment_mode_id,
    p_expense_category_id,
    p_product_id,
    p_assigned_l2_approver_id
  );

  UPDATE public.claims_analytics_daily_stats
  SET
    claim_count = greatest(0, claim_count + coalesce(p_claim_count_delta, 0)),
    total_amount = greatest(
      0::numeric,
      round(total_amount + coalesce(p_total_amount_delta, 0), 2)
    ),
    hod_approval_hours_sum = greatest(
      0::numeric,
      round(hod_approval_hours_sum + coalesce(p_hod_approval_hours_delta, 0), 4)
    ),
    hod_approval_sample_count = greatest(
      0,
      hod_approval_sample_count + coalesce(p_hod_approval_sample_delta, 0)
    ),
    finance_approval_hours = greatest(
      0::numeric,
      round(finance_approval_hours + coalesce(p_finance_approval_hours_delta, 0), 4)
    ),
    finance_approval_samples = greatest(
      0,
      finance_approval_samples + coalesce(p_finance_approval_sample_delta, 0)
    ),
    updated_at = now()
  WHERE bucket_key = v_bucket_key;

  IF NOT FOUND THEN
    IF coalesce(p_claim_count_delta, 0) > 0
       OR coalesce(p_total_amount_delta, 0) > 0
       OR coalesce(p_hod_approval_hours_delta, 0) > 0
       OR coalesce(p_hod_approval_sample_delta, 0) > 0
       OR coalesce(p_finance_approval_hours_delta, 0) > 0
       OR coalesce(p_finance_approval_sample_delta, 0) > 0 THEN
      INSERT INTO public.claims_analytics_daily_stats (
        bucket_key,
        date_key,
        status,
        department_id,
        payment_mode_id,
        expense_category_id,
        product_id,
        assigned_l2_approver_id,
        claim_count,
        total_amount,
        hod_approval_hours_sum,
        hod_approval_sample_count,
        finance_approval_hours,
        finance_approval_samples,
        created_at,
        updated_at
      )
      VALUES (
        v_bucket_key,
        p_date_key,
        p_status,
        p_department_id,
        p_payment_mode_id,
        p_expense_category_id,
        p_product_id,
        p_assigned_l2_approver_id,
        greatest(0, coalesce(p_claim_count_delta, 0)),
        greatest(0::numeric, round(coalesce(p_total_amount_delta, 0), 2)),
        greatest(0::numeric, round(coalesce(p_hod_approval_hours_delta, 0), 4)),
        greatest(0, coalesce(p_hod_approval_sample_delta, 0)),
        greatest(0::numeric, round(coalesce(p_finance_approval_hours_delta, 0), 4)),
        greatest(0, coalesce(p_finance_approval_sample_delta, 0)),
        now(),
        now()
      );
    END IF;
  END IF;

  DELETE FROM public.claims_analytics_daily_stats
  WHERE bucket_key = v_bucket_key
    AND claim_count = 0
    AND total_amount = 0
    AND hod_approval_hours_sum = 0
    AND hod_approval_sample_count = 0
    AND finance_approval_hours = 0
    AND finance_approval_samples = 0;
END;
$$;

ALTER FUNCTION public.apply_claims_analytics_delta(
  date,
  public.claim_status,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  integer,
  numeric,
  numeric,
  integer,
  numeric,
  integer
) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.refresh_claim_analytics_snapshot(p_claim_id text) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_claim record;
  v_hod_hours numeric(14,4);
  v_hod_samples integer;
  v_finance_hours numeric(14,4);
  v_finance_samples integer;
BEGIN
  IF p_claim_id IS NULL OR btrim(p_claim_id) = '' THEN
    RETURN;
  END IF;

  SELECT
    c.id AS claim_id,
    coalesce(c.submitted_at, c.created_at) AS submitted_on,
    coalesce(
      c.hod_action_at,
      CASE
        WHEN c.status = 'HOD approved - Awaiting finance approval'::public.claim_status THEN c.updated_at
        WHEN c.status IN (
          'Rejected - Resubmission Not Allowed'::public.claim_status,
          'Rejected - Resubmission Allowed'::public.claim_status
        ) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at
        ELSE NULL
      END
    ) AS resolved_hod_action_at,
    coalesce(
      c.finance_action_at,
      CASE
        WHEN c.status IN (
          'Finance Approved - Payment under process'::public.claim_status,
          'Payment Done - Closed'::public.claim_status
        ) THEN c.updated_at
        WHEN c.status IN (
          'Rejected - Resubmission Not Allowed'::public.claim_status,
          'Rejected - Resubmission Allowed'::public.claim_status
        ) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at
        ELSE NULL
      END
    ) AS resolved_finance_action_at,
    coalesce(c.submitted_at, c.created_at)::date AS date_key,
    c.status,
    c.department_id,
    c.payment_mode_id,
    ed.expense_category_id,
    coalesce(ed.product_id, ad.product_id) AS product_id,
    c.assigned_l2_approver_id,
    coalesce(ed.total_amount, ad.requested_amount, 0)::numeric(14,2) AS total_amount
  INTO v_claim
  FROM public.claims c
  LEFT JOIN public.expense_details ed
    ON ed.claim_id = c.id
    AND ed.is_active = true
  LEFT JOIN public.advance_details ad
    ON ad.claim_id = c.id
    AND ad.is_active = true
  WHERE c.id = p_claim_id
    AND c.is_active = true;

  IF NOT FOUND THEN
    DELETE FROM public.claims_analytics_snapshot
    WHERE claim_id = p_claim_id;
    RETURN;
  END IF;

  IF v_claim.resolved_hod_action_at IS NOT NULL
     AND v_claim.resolved_hod_action_at >= v_claim.submitted_on THEN
    v_hod_hours := round(
      (extract(epoch FROM (v_claim.resolved_hod_action_at - v_claim.submitted_on)) / 3600.0)::numeric,
      4
    );
    v_hod_samples := 1;
  ELSE
    v_hod_hours := 0;
    v_hod_samples := 0;
  END IF;

  IF v_claim.resolved_finance_action_at IS NOT NULL
     AND v_claim.resolved_hod_action_at IS NOT NULL
     AND v_claim.resolved_finance_action_at >= v_claim.resolved_hod_action_at THEN
    v_finance_hours := round(
      (extract(epoch FROM (v_claim.resolved_finance_action_at - v_claim.resolved_hod_action_at)) / 3600.0)::numeric,
      4
    );
    v_finance_samples := 1;
  ELSE
    v_finance_hours := 0;
    v_finance_samples := 0;
  END IF;

  INSERT INTO public.claims_analytics_snapshot (
    claim_id,
    date_key,
    status,
    department_id,
    payment_mode_id,
    expense_category_id,
    product_id,
    assigned_l2_approver_id,
    claim_count,
    total_amount,
    hod_approval_hours_sum,
    hod_approval_sample_count,
    finance_approval_hours,
    finance_approval_samples,
    created_at,
    updated_at
  )
  VALUES (
    v_claim.claim_id,
    v_claim.date_key,
    v_claim.status,
    v_claim.department_id,
    v_claim.payment_mode_id,
    v_claim.expense_category_id,
    v_claim.product_id,
    v_claim.assigned_l2_approver_id,
    1,
    v_claim.total_amount,
    v_hod_hours,
    v_hod_samples,
    v_finance_hours,
    v_finance_samples,
    now(),
    now()
  )
  ON CONFLICT (claim_id)
  DO UPDATE SET
    date_key = EXCLUDED.date_key,
    status = EXCLUDED.status,
    department_id = EXCLUDED.department_id,
    payment_mode_id = EXCLUDED.payment_mode_id,
    expense_category_id = EXCLUDED.expense_category_id,
    product_id = EXCLUDED.product_id,
    assigned_l2_approver_id = EXCLUDED.assigned_l2_approver_id,
    claim_count = EXCLUDED.claim_count,
    total_amount = EXCLUDED.total_amount,
    hod_approval_hours_sum = EXCLUDED.hod_approval_hours_sum,
    hod_approval_sample_count = EXCLUDED.hod_approval_sample_count,
    finance_approval_hours = EXCLUDED.finance_approval_hours,
    finance_approval_samples = EXCLUDED.finance_approval_samples,
    updated_at = now();
END;
$$;

ALTER FUNCTION public.refresh_claim_analytics_snapshot(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.trg_rollup_claims_analytics_snapshot() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    PERFORM public.apply_claims_analytics_delta(
      NEW.date_key,
      NEW.status,
      NEW.department_id,
      NEW.payment_mode_id,
      NEW.expense_category_id,
      NEW.product_id,
      NEW.assigned_l2_approver_id,
      NEW.claim_count,
      NEW.total_amount,
      NEW.hod_approval_hours_sum,
      NEW.hod_approval_sample_count,
      NEW.finance_approval_hours,
      NEW.finance_approval_samples
    );
    RETURN NULL;
  END IF;

  IF tg_op = 'UPDATE' THEN
    PERFORM public.apply_claims_analytics_delta(
      OLD.date_key,
      OLD.status,
      OLD.department_id,
      OLD.payment_mode_id,
      OLD.expense_category_id,
      OLD.product_id,
      OLD.assigned_l2_approver_id,
      -OLD.claim_count,
      -OLD.total_amount,
      -OLD.hod_approval_hours_sum,
      -OLD.hod_approval_sample_count,
      -OLD.finance_approval_hours,
      -OLD.finance_approval_samples
    );

    PERFORM public.apply_claims_analytics_delta(
      NEW.date_key,
      NEW.status,
      NEW.department_id,
      NEW.payment_mode_id,
      NEW.expense_category_id,
      NEW.product_id,
      NEW.assigned_l2_approver_id,
      NEW.claim_count,
      NEW.total_amount,
      NEW.hod_approval_hours_sum,
      NEW.hod_approval_sample_count,
      NEW.finance_approval_hours,
      NEW.finance_approval_samples
    );

    RETURN NULL;
  END IF;

  PERFORM public.apply_claims_analytics_delta(
    OLD.date_key,
    OLD.status,
    OLD.department_id,
    OLD.payment_mode_id,
    OLD.expense_category_id,
    OLD.product_id,
    OLD.assigned_l2_approver_id,
    -OLD.claim_count,
    -OLD.total_amount,
    -OLD.hod_approval_hours_sum,
    -OLD.hod_approval_sample_count,
    -OLD.finance_approval_hours,
    -OLD.finance_approval_samples
  );

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.trg_rollup_claims_analytics_snapshot() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_dashboard_analytics_payload(
  p_scope text,
  p_hod_department_ids uuid[] DEFAULT NULL,
  p_finance_approver_ids uuid[] DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_expense_category_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_finance_approver_id uuid DEFAULT NULL,
  p_finance_pipeline_statuses public.claim_status[] DEFAULT NULL,
  p_approved_statuses public.claim_status[] DEFAULT NULL,
  p_pending_statuses public.claim_status[] DEFAULT NULL,
  p_rejected_statuses public.claim_status[] DEFAULT NULL,
  p_hod_pending_status public.claim_status DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payload jsonb;
  v_use_cache boolean := to_regclass('public.claims_analytics_daily_stats') IS NOT NULL;
  v_finance_pipeline_statuses public.claim_status[] := coalesce(
    p_finance_pipeline_statuses,
    '{}'::public.claim_status[]
  );
  v_approved_statuses public.claim_status[] := coalesce(
    p_approved_statuses,
    '{}'::public.claim_status[]
  );
  v_pending_statuses public.claim_status[] := coalesce(
    p_pending_statuses,
    '{}'::public.claim_status[]
  );
  v_rejected_statuses public.claim_status[] := coalesce(
    p_rejected_statuses,
    '{}'::public.claim_status[]
  );
  v_finance_terminal_statuses public.claim_status[] := ARRAY[
    'Finance Approved - Payment under process'::public.claim_status,
    'Payment Done - Closed'::public.claim_status,
    'Rejected - Resubmission Not Allowed'::public.claim_status,
    'Rejected - Resubmission Allowed'::public.claim_status
  ];
BEGIN
  IF p_scope NOT IN ('admin', 'hod', 'finance') THEN
    RAISE EXCEPTION 'Invalid analytics scope: %', p_scope USING errcode = '22023';
  END IF;

  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid analytics date range.' USING errcode = '22023';
  END IF;

  IF v_use_cache THEN
    WITH filtered AS (
      SELECT
        s.status,
        s.claim_count::bigint AS claim_count,
        s.total_amount::numeric(14,2) AS total_amount,
        s.payment_mode_id,
        coalesce(nullif(trim(pm.name), ''), 'Unknown') AS payment_mode_name,
        s.department_id,
        coalesce(nullif(trim(md.name), ''), 'Unknown Department') AS department_name,
        s.assigned_l2_approver_id,
        coalesce(
          nullif(trim(fin_user.full_name), ''),
          nullif(trim(fin_user.email), ''),
          nullif(trim(mfa.provisional_email), ''),
          coalesce(s.assigned_l2_approver_id::text, 'Unassigned')
        ) AS finance_approver_name,
        s.hod_approval_hours_sum::numeric(18,4) AS hod_approval_hours_sum,
        s.hod_approval_sample_count::bigint AS hod_approval_sample_count,
        s.finance_approval_hours::numeric(18,4) AS finance_approval_hours,
        s.finance_approval_samples::bigint AS finance_approval_samples
      FROM public.claims_analytics_daily_stats s
      LEFT JOIN public.master_payment_modes pm ON pm.id = s.payment_mode_id
      LEFT JOIN public.master_departments md ON md.id = s.department_id
      LEFT JOIN public.master_finance_approvers mfa ON mfa.id = s.assigned_l2_approver_id
      LEFT JOIN public.users fin_user ON fin_user.id = mfa.user_id
      WHERE s.date_key BETWEEN p_date_from AND p_date_to
        AND (
          p_scope <> 'hod'
          OR (
            coalesce(array_length(p_hod_department_ids, 1), 0) > 0
            AND s.department_id = ANY(p_hod_department_ids)
          )
        )
        AND (
          p_scope <> 'finance'
          OR (
            (
              coalesce(array_length(p_finance_approver_ids, 1), 0) = 0
              AND (
                coalesce(array_length(v_finance_pipeline_statuses, 1), 0) = 0
                OR s.status = ANY(v_finance_pipeline_statuses)
              )
            )
            OR (
              coalesce(array_length(p_finance_approver_ids, 1), 0) > 0
              AND (
                (
                  coalesce(array_length(v_finance_pipeline_statuses, 1), 0) > 0
                  AND s.status = ANY(v_finance_pipeline_statuses)
                )
                OR s.assigned_l2_approver_id = ANY(p_finance_approver_ids)
              )
            )
          )
        )
        AND (p_department_id IS NULL OR s.department_id = p_department_id)
        AND (p_expense_category_id IS NULL OR s.expense_category_id = p_expense_category_id)
        AND (p_product_id IS NULL OR s.product_id = p_product_id)
        AND (p_finance_approver_id IS NULL OR s.assigned_l2_approver_id = p_finance_approver_id)
    ),
    base AS (
      SELECT
        f.status,
        sum(f.claim_count)::bigint AS claim_count,
        round(sum(f.total_amount), 2)::numeric(14,2) AS total_amount,
        f.payment_mode_id,
        f.payment_mode_name,
        f.department_id,
        f.department_name,
        round(sum(f.hod_approval_hours_sum), 4)::numeric(18,4) AS hod_approval_hours_sum,
        sum(f.hod_approval_sample_count)::bigint AS hod_approval_sample_count,
        round(sum(f.finance_approval_hours), 4)::numeric(18,4) AS finance_approval_hours,
        sum(f.finance_approval_samples)::bigint AS finance_approval_samples
      FROM filtered f
      GROUP BY
        f.status,
        f.payment_mode_id,
        f.payment_mode_name,
        f.department_id,
        f.department_name
    ),
    totals AS (
      SELECT
        coalesce(sum(b.claim_count), 0)::bigint AS claim_count,
        coalesce(round(sum(b.total_amount), 2), 0)::numeric(14,2) AS total_amount,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE coalesce(array_length(v_approved_statuses, 1), 0) > 0
                AND b.status = ANY(v_approved_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) AS approved_amount,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE coalesce(array_length(v_pending_statuses, 1), 0) > 0
                AND b.status = ANY(v_pending_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) AS pending_amount,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE p_hod_pending_status IS NOT NULL
                AND b.status = p_hod_pending_status
            ),
            2
          ),
          0
        )::numeric(14,2) AS hod_pending_amount,
        coalesce(
          sum(b.claim_count) FILTER (
            WHERE p_hod_pending_status IS NOT NULL
              AND b.status = p_hod_pending_status
          ),
          0
        )::bigint AS hod_pending_count,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE coalesce(array_length(v_rejected_statuses, 1), 0) > 0
                AND b.status = ANY(v_rejected_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) AS rejected_amount,
        coalesce(round(sum(b.finance_approval_hours), 4), 0)::numeric(18,4) AS finance_approval_hours,
        coalesce(sum(b.finance_approval_samples), 0)::bigint AS finance_approval_samples
      FROM base b
    ),
    status_enum AS (
      SELECT row_number() OVER () AS sort_order, status
      FROM unnest(enum_range(NULL::public.claim_status)) AS status
    ),
    status_rollup AS (
      SELECT
        b.status,
        sum(b.claim_count)::bigint AS claim_count,
        round(sum(b.total_amount), 2)::numeric(14,2) AS total_amount
      FROM base b
      GROUP BY b.status
    ),
    status_breakdown AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', se.status,
              'count', coalesce(sr.claim_count, 0),
              'amount', coalesce(sr.total_amount, 0)
            )
            ORDER BY se.sort_order
          ),
          '[]'::jsonb
        ) AS items
      FROM status_enum se
      LEFT JOIN status_rollup sr ON sr.status = se.status
    ),
    payment_breakdown AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'paymentModeId', pb.payment_mode_id,
              'paymentModeName', pb.payment_mode_name,
              'count', pb.claim_count,
              'amount', pb.total_amount
            )
            ORDER BY pb.payment_mode_name
          ),
          '[]'::jsonb
        ) AS items
      FROM (
        SELECT
          b.payment_mode_id,
          b.payment_mode_name,
          sum(b.claim_count)::bigint AS claim_count,
          round(sum(b.total_amount), 2)::numeric(14,2) AS total_amount
        FROM base b
        GROUP BY b.payment_mode_id, b.payment_mode_name
      ) pb
    ),
    efficiency AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'departmentId', e.department_id,
              'departmentName', e.department_name,
              'sampleCount', e.sample_count,
              'averageHoursToApproval', e.average_hours_to_approval,
              'averageDaysToApproval', e.average_days_to_approval
            )
            ORDER BY e.average_days_to_approval DESC
          ),
          '[]'::jsonb
        ) AS items
      FROM (
        SELECT
          b.department_id,
          b.department_name,
          sum(b.hod_approval_sample_count)::bigint AS sample_count,
          round(
            sum(b.hod_approval_hours_sum)
            / nullif(sum(b.hod_approval_sample_count), 0),
            2
          )::numeric(14,2) AS average_hours_to_approval,
          round(
            (
              sum(b.hod_approval_hours_sum)
              / nullif(sum(b.hod_approval_sample_count), 0)
            ) / 24,
            2
          )::numeric(14,2) AS average_days_to_approval
        FROM base b
        WHERE b.department_id IS NOT NULL
          AND b.hod_approval_sample_count > 0
        GROUP BY b.department_id, b.department_name
      ) e
    ),
    finance_breakdown AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'financeApproverId', f.finance_approver_id,
              'financeApproverName', f.finance_approver_name,
              'sampleCount', f.sample_count,
              'averageHoursToApproval', f.average_hours_to_approval,
              'averageDaysToApproval', f.average_days_to_approval
            )
            ORDER BY f.average_days_to_approval DESC
          ),
          '[]'::jsonb
        ) AS items
      FROM (
        SELECT
          coalesce(filtered.assigned_l2_approver_id::text, 'unassigned') AS finance_approver_id,
          max(filtered.finance_approver_name) AS finance_approver_name,
          sum(filtered.finance_approval_samples)::bigint AS sample_count,
          round(
            sum(filtered.finance_approval_hours)
            / nullif(sum(filtered.finance_approval_samples), 0),
            2
          )::numeric(14,2) AS average_hours_to_approval,
          round(
            (
              sum(filtered.finance_approval_hours)
              / nullif(sum(filtered.finance_approval_samples), 0)
            ) / 24,
            2
          )::numeric(14,2) AS average_days_to_approval
        FROM filtered
        WHERE filtered.finance_approval_samples > 0
        GROUP BY coalesce(filtered.assigned_l2_approver_id::text, 'unassigned')
      ) f
    )
    SELECT
      jsonb_build_object(
        'claimCount', t.claim_count,
        'amounts', jsonb_build_object(
          'totalAmount', t.total_amount,
          'approvedAmount', t.approved_amount,
          'pendingAmount', t.pending_amount,
          'hodPendingAmount', t.hod_pending_amount,
          'hodPendingCount', t.hod_pending_count,
          'rejectedAmount', t.rejected_amount
        ),
        'statusBreakdown', sb.items,
        'paymentModeBreakdown', pb.items,
        'efficiencyByDepartment', ef.items,
        'overallFinanceTatAverage',
          CASE
            WHEN t.finance_approval_samples > 0
              THEN round((t.finance_approval_hours / t.finance_approval_samples) / 24, 2)::numeric(14,2)
            ELSE 0::numeric(14,2)
          END,
        'overallFinanceTatSampleCount', t.finance_approval_samples,
        'financeApproverTatBreakdown', fb.items
      )
    INTO v_payload
    FROM totals t
    CROSS JOIN status_breakdown sb
    CROSS JOIN payment_breakdown pb
    CROSS JOIN efficiency ef
    CROSS JOIN finance_breakdown fb;
  ELSE
    WITH filtered AS (
      SELECT
        v.status,
        1::bigint AS claim_count,
        coalesce(v.amount, 0)::numeric(14,2) AS total_amount,
        v.payment_mode_id,
        coalesce(nullif(trim(v.type_of_claim), ''), 'Unknown') AS payment_mode_name,
        v.department_id,
        coalesce(nullif(trim(v.department_name), ''), 'Unknown Department') AS department_name,
        v.assigned_l2_approver_id,
        coalesce(
          nullif(trim(v.finance_email), ''),
          coalesce(v.assigned_l2_approver_id::text, 'Unassigned')
        ) AS finance_approver_name,
        CASE
          WHEN v.hod_action_date IS NOT NULL AND v.hod_action_date >= v.submitted_on
            THEN extract(epoch FROM (v.hod_action_date - v.submitted_on)) / 3600
          ELSE 0
        END::numeric(18,4) AS hod_approval_hours_sum,
        CASE
          WHEN v.hod_action_date IS NOT NULL AND v.hod_action_date >= v.submitted_on
            THEN 1
          ELSE 0
        END::bigint AS hod_approval_sample_count,
        CASE
          WHEN v.status = ANY(v_finance_terminal_statuses)
            AND v.hod_action_date IS NOT NULL
            AND v.finance_action_date IS NOT NULL
            AND v.finance_action_date >= v.hod_action_date
            THEN extract(epoch FROM (v.finance_action_date - v.hod_action_date)) / 3600
          ELSE 0
        END::numeric(18,4) AS finance_approval_hours,
        CASE
          WHEN v.status = ANY(v_finance_terminal_statuses)
            AND v.hod_action_date IS NOT NULL
            AND v.finance_action_date IS NOT NULL
            AND v.finance_action_date >= v.hod_action_date
            THEN 1
          ELSE 0
        END::bigint AS finance_approval_samples
      FROM public.vw_enterprise_claims_dashboard v
      WHERE v.submitted_on >= (p_date_from::timestamp AT TIME ZONE 'UTC')
        AND v.submitted_on <= ((p_date_to::timestamp + interval '1 day') AT TIME ZONE 'UTC' - interval '1 millisecond')
        AND (
          p_scope <> 'hod'
          OR (
            coalesce(array_length(p_hod_department_ids, 1), 0) > 0
            AND v.department_id = ANY(p_hod_department_ids)
          )
        )
        AND (
          p_scope <> 'finance'
          OR (
            (
              coalesce(array_length(p_finance_approver_ids, 1), 0) = 0
              AND (
                coalesce(array_length(v_finance_pipeline_statuses, 1), 0) = 0
                OR v.status = ANY(v_finance_pipeline_statuses)
              )
            )
            OR (
              coalesce(array_length(p_finance_approver_ids, 1), 0) > 0
              AND (
                (
                  coalesce(array_length(v_finance_pipeline_statuses, 1), 0) > 0
                  AND v.status = ANY(v_finance_pipeline_statuses)
                )
                OR v.assigned_l2_approver_id = ANY(p_finance_approver_ids)
              )
            )
          )
        )
        AND (p_department_id IS NULL OR v.department_id = p_department_id)
        AND (p_expense_category_id IS NULL OR v.expense_category_id = p_expense_category_id)
        AND (p_product_id IS NULL OR v.product_id = p_product_id)
        AND (p_finance_approver_id IS NULL OR v.assigned_l2_approver_id = p_finance_approver_id)
    ),
    base AS (
      SELECT
        f.status,
        sum(f.claim_count)::bigint AS claim_count,
        round(sum(f.total_amount), 2)::numeric(14,2) AS total_amount,
        f.payment_mode_id,
        f.payment_mode_name,
        f.department_id,
        f.department_name,
        round(sum(f.hod_approval_hours_sum), 4)::numeric(18,4) AS hod_approval_hours_sum,
        sum(f.hod_approval_sample_count)::bigint AS hod_approval_sample_count,
        round(sum(f.finance_approval_hours), 4)::numeric(18,4) AS finance_approval_hours,
        sum(f.finance_approval_samples)::bigint AS finance_approval_samples
      FROM filtered f
      GROUP BY
        f.status,
        f.payment_mode_id,
        f.payment_mode_name,
        f.department_id,
        f.department_name
    ),
    totals AS (
      SELECT
        coalesce(sum(b.claim_count), 0)::bigint AS claim_count,
        coalesce(round(sum(b.total_amount), 2), 0)::numeric(14,2) AS total_amount,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE coalesce(array_length(v_approved_statuses, 1), 0) > 0
                AND b.status = ANY(v_approved_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) AS approved_amount,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE coalesce(array_length(v_pending_statuses, 1), 0) > 0
                AND b.status = ANY(v_pending_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) AS pending_amount,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE p_hod_pending_status IS NOT NULL
                AND b.status = p_hod_pending_status
            ),
            2
          ),
          0
        )::numeric(14,2) AS hod_pending_amount,
        coalesce(
          sum(b.claim_count) FILTER (
            WHERE p_hod_pending_status IS NOT NULL
              AND b.status = p_hod_pending_status
          ),
          0
        )::bigint AS hod_pending_count,
        coalesce(
          round(
            sum(b.total_amount) FILTER (
              WHERE coalesce(array_length(v_rejected_statuses, 1), 0) > 0
                AND b.status = ANY(v_rejected_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) AS rejected_amount,
        coalesce(round(sum(b.finance_approval_hours), 4), 0)::numeric(18,4) AS finance_approval_hours,
        coalesce(sum(b.finance_approval_samples), 0)::bigint AS finance_approval_samples
      FROM base b
    ),
    status_enum AS (
      SELECT row_number() OVER () AS sort_order, status
      FROM unnest(enum_range(NULL::public.claim_status)) AS status
    ),
    status_rollup AS (
      SELECT
        b.status,
        sum(b.claim_count)::bigint AS claim_count,
        round(sum(b.total_amount), 2)::numeric(14,2) AS total_amount
      FROM base b
      GROUP BY b.status
    ),
    status_breakdown AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', se.status,
              'count', coalesce(sr.claim_count, 0),
              'amount', coalesce(sr.total_amount, 0)
            )
            ORDER BY se.sort_order
          ),
          '[]'::jsonb
        ) AS items
      FROM status_enum se
      LEFT JOIN status_rollup sr ON sr.status = se.status
    ),
    payment_breakdown AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'paymentModeId', pb.payment_mode_id,
              'paymentModeName', pb.payment_mode_name,
              'count', pb.claim_count,
              'amount', pb.total_amount
            )
            ORDER BY pb.payment_mode_name
          ),
          '[]'::jsonb
        ) AS items
      FROM (
        SELECT
          b.payment_mode_id,
          b.payment_mode_name,
          sum(b.claim_count)::bigint AS claim_count,
          round(sum(b.total_amount), 2)::numeric(14,2) AS total_amount
        FROM base b
        GROUP BY b.payment_mode_id, b.payment_mode_name
      ) pb
    ),
    efficiency AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'departmentId', e.department_id,
              'departmentName', e.department_name,
              'sampleCount', e.sample_count,
              'averageHoursToApproval', e.average_hours_to_approval,
              'averageDaysToApproval', e.average_days_to_approval
            )
            ORDER BY e.average_days_to_approval DESC
          ),
          '[]'::jsonb
        ) AS items
      FROM (
        SELECT
          b.department_id,
          b.department_name,
          sum(b.hod_approval_sample_count)::bigint AS sample_count,
          round(
            sum(b.hod_approval_hours_sum)
            / nullif(sum(b.hod_approval_sample_count), 0),
            2
          )::numeric(14,2) AS average_hours_to_approval,
          round(
            (
              sum(b.hod_approval_hours_sum)
              / nullif(sum(b.hod_approval_sample_count), 0)
            ) / 24,
            2
          )::numeric(14,2) AS average_days_to_approval
        FROM base b
        WHERE b.department_id IS NOT NULL
          AND b.hod_approval_sample_count > 0
        GROUP BY b.department_id, b.department_name
      ) e
    ),
    finance_breakdown AS (
      SELECT
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'financeApproverId', f.finance_approver_id,
              'financeApproverName', f.finance_approver_name,
              'sampleCount', f.sample_count,
              'averageHoursToApproval', f.average_hours_to_approval,
              'averageDaysToApproval', f.average_days_to_approval
            )
            ORDER BY f.average_days_to_approval DESC
          ),
          '[]'::jsonb
        ) AS items
      FROM (
        SELECT
          coalesce(filtered.assigned_l2_approver_id::text, 'unassigned') AS finance_approver_id,
          max(filtered.finance_approver_name) AS finance_approver_name,
          sum(filtered.finance_approval_samples)::bigint AS sample_count,
          round(
            sum(filtered.finance_approval_hours)
            / nullif(sum(filtered.finance_approval_samples), 0),
            2
          )::numeric(14,2) AS average_hours_to_approval,
          round(
            (
              sum(filtered.finance_approval_hours)
              / nullif(sum(filtered.finance_approval_samples), 0)
            ) / 24,
            2
          )::numeric(14,2) AS average_days_to_approval
        FROM filtered
        WHERE filtered.finance_approval_samples > 0
        GROUP BY coalesce(filtered.assigned_l2_approver_id::text, 'unassigned')
      ) f
    )
    SELECT
      jsonb_build_object(
        'claimCount', t.claim_count,
        'amounts', jsonb_build_object(
          'totalAmount', t.total_amount,
          'approvedAmount', t.approved_amount,
          'pendingAmount', t.pending_amount,
          'hodPendingAmount', t.hod_pending_amount,
          'hodPendingCount', t.hod_pending_count,
          'rejectedAmount', t.rejected_amount
        ),
        'statusBreakdown', sb.items,
        'paymentModeBreakdown', pb.items,
        'efficiencyByDepartment', ef.items,
        'overallFinanceTatAverage',
          CASE
            WHEN t.finance_approval_samples > 0
              THEN round((t.finance_approval_hours / t.finance_approval_samples) / 24, 2)::numeric(14,2)
            ELSE 0::numeric(14,2)
          END,
        'overallFinanceTatSampleCount', t.finance_approval_samples,
        'financeApproverTatBreakdown', fb.items
      )
    INTO v_payload
    FROM totals t
    CROSS JOIN status_breakdown sb
    CROSS JOIN payment_breakdown pb
    CROSS JOIN efficiency ef
    CROSS JOIN finance_breakdown fb;
  END IF;

  RETURN coalesce(
    v_payload,
    jsonb_build_object(
      'claimCount', 0,
      'amounts', jsonb_build_object(
        'totalAmount', 0,
        'approvedAmount', 0,
        'pendingAmount', 0,
        'hodPendingAmount', 0,
        'hodPendingCount', 0,
        'rejectedAmount', 0
      ),
      'statusBreakdown', '[]'::jsonb,
      'paymentModeBreakdown', '[]'::jsonb,
      'efficiencyByDepartment', '[]'::jsonb,
      'overallFinanceTatAverage', 0,
      'overallFinanceTatSampleCount', 0,
      'financeApproverTatBreakdown', '[]'::jsonb
    )
  );
END;
$$;

ALTER FUNCTION public.get_dashboard_analytics_payload(
  text,
  uuid[],
  uuid[],
  date,
  date,
  uuid,
  uuid,
  uuid,
  uuid,
  public.claim_status[],
  public.claim_status[],
  public.claim_status[],
  public.claim_status[],
  public.claim_status
) OWNER TO postgres;

-- Backfill analytics caches so historical claims get finance TAT metrics.
SELECT public.rebuild_claims_analytics_cache();
