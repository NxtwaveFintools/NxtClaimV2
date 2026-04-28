-- Roll back Finance TAT analytics additions.

-- Revert function definitions to their previous versions.
CREATE OR REPLACE FUNCTION "public"."apply_claims_analytics_delta"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid", "p_claim_count_delta" integer, "p_total_amount_delta" numeric, "p_hod_approval_hours_delta" numeric, "p_hod_approval_sample_delta" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_bucket_key text;
begin
  if p_date_key is null or p_status is null then
    return;
  end if;

  if coalesce(p_claim_count_delta, 0) = 0
     and coalesce(p_total_amount_delta, 0) = 0
     and coalesce(p_hod_approval_hours_delta, 0) = 0
     and coalesce(p_hod_approval_sample_delta, 0) = 0 then
    return;
  end if;

  v_bucket_key := public.make_claims_analytics_bucket_key(
    p_date_key,
    p_status,
    p_department_id,
    p_payment_mode_id,
    p_expense_category_id,
    p_product_id,
    p_assigned_l2_approver_id
  );

  update public.claims_analytics_daily_stats
  set
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
    updated_at = now()
  where bucket_key = v_bucket_key;

  if not found then
    if coalesce(p_claim_count_delta, 0) > 0
       or coalesce(p_total_amount_delta, 0) > 0
       or coalesce(p_hod_approval_hours_delta, 0) > 0
       or coalesce(p_hod_approval_sample_delta, 0) > 0 then
      insert into public.claims_analytics_daily_stats (
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
        created_at,
        updated_at
      )
      values (
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
        now(),
        now()
      );
    end if;
  end if;

  delete from public.claims_analytics_daily_stats
  where bucket_key = v_bucket_key
    and claim_count = 0
    and total_amount = 0
    and hod_approval_hours_sum = 0
    and hod_approval_sample_count = 0;
end;
$$;


ALTER FUNCTION "public"."apply_claims_analytics_delta"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid", "p_claim_count_delta" integer, "p_total_amount_delta" numeric, "p_hod_approval_hours_delta" numeric, "p_hod_approval_sample_delta" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_dashboard_analytics_payload"("p_scope" "text", "p_hod_department_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_finance_approver_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_date_from" "date" DEFAULT NULL::"date", "p_date_to" "date" DEFAULT NULL::"date", "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_expense_category_id" "uuid" DEFAULT NULL::"uuid", "p_product_id" "uuid" DEFAULT NULL::"uuid", "p_finance_approver_id" "uuid" DEFAULT NULL::"uuid", "p_finance_pipeline_statuses" "public"."claim_status"[] DEFAULT NULL::"public"."claim_status"[], "p_approved_statuses" "public"."claim_status"[] DEFAULT NULL::"public"."claim_status"[], "p_pending_statuses" "public"."claim_status"[] DEFAULT NULL::"public"."claim_status"[], "p_rejected_statuses" "public"."claim_status"[] DEFAULT NULL::"public"."claim_status"[], "p_hod_pending_status" "public"."claim_status" DEFAULT NULL::"public"."claim_status") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_payload jsonb;
  v_use_cache boolean := to_regclass('public.claims_analytics_daily_stats') is not null;
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
begin
  if p_scope not in ('admin', 'hod', 'finance') then
    raise exception 'Invalid analytics scope: %', p_scope using errcode = '22023';
  end if;

  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception 'Invalid analytics date range.' using errcode = '22023';
  end if;

  if v_use_cache then
    with base as (
      select
        s.status,
        sum(s.claim_count)::bigint as claim_count,
        round(sum(s.total_amount), 2)::numeric(14,2) as total_amount,
        s.payment_mode_id,
        coalesce(nullif(trim(pm.name), ''), 'Unknown') as payment_mode_name,
        s.department_id,
        coalesce(nullif(trim(md.name), ''), 'Unknown Department') as department_name,
        round(sum(s.hod_approval_hours_sum), 4)::numeric(18,4) as hod_approval_hours_sum,
        sum(s.hod_approval_sample_count)::bigint as hod_approval_sample_count
      from public.claims_analytics_daily_stats s
      left join public.master_payment_modes pm on pm.id = s.payment_mode_id
      left join public.master_departments md on md.id = s.department_id
      where s.date_key between p_date_from and p_date_to
        and (
          p_scope <> 'hod'
          or (
            coalesce(array_length(p_hod_department_ids, 1), 0) > 0
            and s.department_id = any(p_hod_department_ids)
          )
        )
        and (
          p_scope <> 'finance'
          or (
            (
              coalesce(array_length(p_finance_approver_ids, 1), 0) = 0
              and (
                coalesce(array_length(v_finance_pipeline_statuses, 1), 0) = 0
                or s.status = any(v_finance_pipeline_statuses)
              )
            )
            or (
              coalesce(array_length(p_finance_approver_ids, 1), 0) > 0
              and (
                (
                  coalesce(array_length(v_finance_pipeline_statuses, 1), 0) > 0
                  and s.status = any(v_finance_pipeline_statuses)
                )
                or s.assigned_l2_approver_id = any(p_finance_approver_ids)
              )
            )
          )
        )
        and (p_department_id is null or s.department_id = p_department_id)
        and (p_expense_category_id is null or s.expense_category_id = p_expense_category_id)
        and (p_product_id is null or s.product_id = p_product_id)
        and (p_finance_approver_id is null or s.assigned_l2_approver_id = p_finance_approver_id)
      group by
        s.status,
        s.payment_mode_id,
        pm.name,
        s.department_id,
        md.name
    ),
    totals as (
      select
        coalesce(sum(b.claim_count), 0)::bigint as claim_count,
        coalesce(round(sum(b.total_amount), 2), 0)::numeric(14,2) as total_amount,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where coalesce(array_length(v_approved_statuses, 1), 0) > 0
                and b.status = any(v_approved_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) as approved_amount,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where coalesce(array_length(v_pending_statuses, 1), 0) > 0
                and b.status = any(v_pending_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) as pending_amount,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where p_hod_pending_status is not null
                and b.status = p_hod_pending_status
            ),
            2
          ),
          0
        )::numeric(14,2) as hod_pending_amount,
        coalesce(
          sum(b.claim_count) filter (
            where p_hod_pending_status is not null
              and b.status = p_hod_pending_status
          ),
          0
        )::bigint as hod_pending_count,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where coalesce(array_length(v_rejected_statuses, 1), 0) > 0
                and b.status = any(v_rejected_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) as rejected_amount
      from base b
    ),
    status_enum as (
      select row_number() over () as sort_order, status
      from unnest(enum_range(null::public.claim_status)) as status
    ),
    status_rollup as (
      select
        b.status,
        sum(b.claim_count)::bigint as claim_count,
        round(sum(b.total_amount), 2)::numeric(14,2) as total_amount
      from base b
      group by b.status
    ),
    status_breakdown as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', se.status,
              'count', coalesce(sr.claim_count, 0),
              'amount', coalesce(sr.total_amount, 0)
            )
            order by se.sort_order
          ),
          '[]'::jsonb
        ) as items
      from status_enum se
      left join status_rollup sr on sr.status = se.status
    ),
    payment_breakdown as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'paymentModeId', pb.payment_mode_id,
              'paymentModeName', pb.payment_mode_name,
              'count', pb.claim_count,
              'amount', pb.total_amount
            )
            order by pb.payment_mode_name
          ),
          '[]'::jsonb
        ) as items
      from (
        select
          b.payment_mode_id,
          b.payment_mode_name,
          sum(b.claim_count)::bigint as claim_count,
          round(sum(b.total_amount), 2)::numeric(14,2) as total_amount
        from base b
        group by b.payment_mode_id, b.payment_mode_name
      ) pb
    ),
    efficiency as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'departmentId', e.department_id,
              'departmentName', e.department_name,
              'sampleCount', e.sample_count,
              'averageHoursToApproval', e.average_hours_to_approval,
              'averageDaysToApproval', e.average_days_to_approval
            )
            order by e.average_days_to_approval desc
          ),
          '[]'::jsonb
        ) as items
      from (
        select
          b.department_id,
          b.department_name,
          sum(b.hod_approval_sample_count)::bigint as sample_count,
          round(
            sum(b.hod_approval_hours_sum)
            / nullif(sum(b.hod_approval_sample_count), 0),
            2
          )::numeric(14,2) as average_hours_to_approval,
          round(
            (
              sum(b.hod_approval_hours_sum)
              / nullif(sum(b.hod_approval_sample_count), 0)
            ) / 24,
            2
          )::numeric(14,2) as average_days_to_approval
        from base b
        where b.department_id is not null
          and b.hod_approval_sample_count > 0
        group by b.department_id, b.department_name
      ) e
    )
    select
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
        'efficiencyByDepartment', ef.items
      )
    into v_payload
    from totals t
    cross join status_breakdown sb
    cross join payment_breakdown pb
    cross join efficiency ef;
  else
    with base as (
      select
        v.status,
        count(*)::bigint as claim_count,
        round(sum(coalesce(v.amount, 0)), 2)::numeric(14,2) as total_amount,
        v.payment_mode_id,
        coalesce(nullif(trim(v.type_of_claim), ''), 'Unknown') as payment_mode_name,
        v.department_id,
        coalesce(nullif(trim(v.department_name), ''), 'Unknown Department') as department_name,
        round(
          sum(
            case
              when v.hod_action_date is not null and v.hod_action_date >= v.submitted_on
                then extract(epoch from (v.hod_action_date - v.submitted_on)) / 3600
              else 0
            end
          ),
          4
        )::numeric(18,4) as hod_approval_hours_sum,
        sum(
          case
            when v.hod_action_date is not null and v.hod_action_date >= v.submitted_on
              then 1
            else 0
          end
        )::bigint as hod_approval_sample_count
      from public.vw_enterprise_claims_dashboard v
      where v.submitted_on >= (p_date_from::timestamp at time zone 'UTC')
        and v.submitted_on <= ((p_date_to::timestamp + interval '1 day') at time zone 'UTC' - interval '1 millisecond')
        and (
          p_scope <> 'hod'
          or (
            coalesce(array_length(p_hod_department_ids, 1), 0) > 0
            and v.department_id = any(p_hod_department_ids)
          )
        )
        and (
          p_scope <> 'finance'
          or (
            (
              coalesce(array_length(p_finance_approver_ids, 1), 0) = 0
              and (
                coalesce(array_length(v_finance_pipeline_statuses, 1), 0) = 0
                or v.status = any(v_finance_pipeline_statuses)
              )
            )
            or (
              coalesce(array_length(p_finance_approver_ids, 1), 0) > 0
              and (
                (
                  coalesce(array_length(v_finance_pipeline_statuses, 1), 0) > 0
                  and v.status = any(v_finance_pipeline_statuses)
                )
                or v.assigned_l2_approver_id = any(p_finance_approver_ids)
              )
            )
          )
        )
        and (p_department_id is null or v.department_id = p_department_id)
        and (p_expense_category_id is null or v.expense_category_id = p_expense_category_id)
        and (p_product_id is null or v.product_id = p_product_id)
        and (p_finance_approver_id is null or v.assigned_l2_approver_id = p_finance_approver_id)
      group by
        v.status,
        v.payment_mode_id,
        payment_mode_name,
        v.department_id,
        department_name
    ),
    totals as (
      select
        coalesce(sum(b.claim_count), 0)::bigint as claim_count,
        coalesce(round(sum(b.total_amount), 2), 0)::numeric(14,2) as total_amount,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where coalesce(array_length(v_approved_statuses, 1), 0) > 0
                and b.status = any(v_approved_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) as approved_amount,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where coalesce(array_length(v_pending_statuses, 1), 0) > 0
                and b.status = any(v_pending_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) as pending_amount,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where p_hod_pending_status is not null
                and b.status = p_hod_pending_status
            ),
            2
          ),
          0
        )::numeric(14,2) as hod_pending_amount,
        coalesce(
          sum(b.claim_count) filter (
            where p_hod_pending_status is not null
              and b.status = p_hod_pending_status
          ),
          0
        )::bigint as hod_pending_count,
        coalesce(
          round(
            sum(b.total_amount) filter (
              where coalesce(array_length(v_rejected_statuses, 1), 0) > 0
                and b.status = any(v_rejected_statuses)
            ),
            2
          ),
          0
        )::numeric(14,2) as rejected_amount
      from base b
    ),
    status_enum as (
      select row_number() over () as sort_order, status
      from unnest(enum_range(null::public.claim_status)) as status
    ),
    status_rollup as (
      select
        b.status,
        sum(b.claim_count)::bigint as claim_count,
        round(sum(b.total_amount), 2)::numeric(14,2) as total_amount
      from base b
      group by b.status
    ),
    status_breakdown as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', se.status,
              'count', coalesce(sr.claim_count, 0),
              'amount', coalesce(sr.total_amount, 0)
            )
            order by se.sort_order
          ),
          '[]'::jsonb
        ) as items
      from status_enum se
      left join status_rollup sr on sr.status = se.status
    ),
    payment_breakdown as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'paymentModeId', pb.payment_mode_id,
              'paymentModeName', pb.payment_mode_name,
              'count', pb.claim_count,
              'amount', pb.total_amount
            )
            order by pb.payment_mode_name
          ),
          '[]'::jsonb
        ) as items
      from (
        select
          b.payment_mode_id,
          b.payment_mode_name,
          sum(b.claim_count)::bigint as claim_count,
          round(sum(b.total_amount), 2)::numeric(14,2) as total_amount
        from base b
        group by b.payment_mode_id, b.payment_mode_name
      ) pb
    ),
    efficiency as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'departmentId', e.department_id,
              'departmentName', e.department_name,
              'sampleCount', e.sample_count,
              'averageHoursToApproval', e.average_hours_to_approval,
              'averageDaysToApproval', e.average_days_to_approval
            )
            order by e.average_days_to_approval desc
          ),
          '[]'::jsonb
        ) as items
      from (
        select
          b.department_id,
          b.department_name,
          sum(b.hod_approval_sample_count)::bigint as sample_count,
          round(
            sum(b.hod_approval_hours_sum)
            / nullif(sum(b.hod_approval_sample_count), 0),
            2
          )::numeric(14,2) as average_hours_to_approval,
          round(
            (
              sum(b.hod_approval_hours_sum)
              / nullif(sum(b.hod_approval_sample_count), 0)
            ) / 24,
            2
          )::numeric(14,2) as average_days_to_approval
        from base b
        where b.department_id is not null
          and b.hod_approval_sample_count > 0
        group by b.department_id, b.department_name
      ) e
    )
    select
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
        'efficiencyByDepartment', ef.items
      )
    into v_payload
    from totals t
    cross join status_breakdown sb
    cross join payment_breakdown pb
    cross join efficiency ef;
  end if;

  return coalesce(
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
      'efficiencyByDepartment', '[]'::jsonb
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_dashboard_analytics_payload"("p_scope" "text", "p_hod_department_ids" "uuid"[], "p_finance_approver_ids" "uuid"[], "p_date_from" "date", "p_date_to" "date", "p_department_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_finance_approver_id" "uuid", "p_finance_pipeline_statuses" "public"."claim_status"[], "p_approved_statuses" "public"."claim_status"[], "p_pending_statuses" "public"."claim_status"[], "p_rejected_statuses" "public"."claim_status"[], "p_hod_pending_status" "public"."claim_status") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."refresh_claim_analytics_snapshot"("p_claim_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim record;
  v_hod_hours numeric(14,4);
  v_hod_samples integer;
begin
  if p_claim_id is null or btrim(p_claim_id) = '' then
    return;
  end if;

  select
    c.id as claim_id,
    coalesce(c.submitted_at, c.created_at) as submitted_on,
    coalesce(
      c.hod_action_at,
      case
        when c.status = 'HOD approved - Awaiting finance approval'::public.claim_status then c.updated_at
        when c.status in (
          'Rejected - Resubmission Not Allowed'::public.claim_status,
          'Rejected - Resubmission Allowed'::public.claim_status
        ) and c.assigned_l2_approver_id is null then c.updated_at
        else null
      end
    ) as resolved_hod_action_at,
    coalesce(c.submitted_at, c.created_at)::date as date_key,
    c.status,
    c.department_id,
    c.payment_mode_id,
    ed.expense_category_id,
    coalesce(ed.product_id, ad.product_id) as product_id,
    c.assigned_l2_approver_id,
    coalesce(ed.total_amount, ad.requested_amount, 0)::numeric(14,2) as total_amount
  into v_claim
  from public.claims c
  left join public.expense_details ed
    on ed.claim_id = c.id
    and ed.is_active = true
  left join public.advance_details ad
    on ad.claim_id = c.id
    and ad.is_active = true
  where c.id = p_claim_id
    and c.is_active = true;

  if not found then
    delete from public.claims_analytics_snapshot
    where claim_id = p_claim_id;
    return;
  end if;

  if v_claim.resolved_hod_action_at is not null
     and v_claim.resolved_hod_action_at >= v_claim.submitted_on then
    v_hod_hours := round(
      (extract(epoch from (v_claim.resolved_hod_action_at - v_claim.submitted_on)) / 3600.0)::numeric,
      4
    );
    v_hod_samples := 1;
  else
    v_hod_hours := 0;
    v_hod_samples := 0;
  end if;

  insert into public.claims_analytics_snapshot (
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
    created_at,
    updated_at
  )
  values (
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
    now(),
    now()
  )
  on conflict (claim_id)
  do update set
    date_key = excluded.date_key,
    status = excluded.status,
    department_id = excluded.department_id,
    payment_mode_id = excluded.payment_mode_id,
    expense_category_id = excluded.expense_category_id,
    product_id = excluded.product_id,
    assigned_l2_approver_id = excluded.assigned_l2_approver_id,
    claim_count = excluded.claim_count,
    total_amount = excluded.total_amount,
    hod_approval_hours_sum = excluded.hod_approval_hours_sum,
    hod_approval_sample_count = excluded.hod_approval_sample_count,
    updated_at = now();
end;
$$;


ALTER FUNCTION "public"."refresh_claim_analytics_snapshot"("p_claim_id" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."trg_rollup_claims_analytics_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_claims_analytics_delta(
      new.date_key,
      new.status,
      new.department_id,
      new.payment_mode_id,
      new.expense_category_id,
      new.product_id,
      new.assigned_l2_approver_id,
      new.claim_count,
      new.total_amount,
      new.hod_approval_hours_sum,
      new.hod_approval_sample_count
    );
    return null;
  end if;

  if tg_op = 'UPDATE' then
    perform public.apply_claims_analytics_delta(
      old.date_key,
      old.status,
      old.department_id,
      old.payment_mode_id,
      old.expense_category_id,
      old.product_id,
      old.assigned_l2_approver_id,
      -old.claim_count,
      -old.total_amount,
      -old.hod_approval_hours_sum,
      -old.hod_approval_sample_count
    );

    perform public.apply_claims_analytics_delta(
      new.date_key,
      new.status,
      new.department_id,
      new.payment_mode_id,
      new.expense_category_id,
      new.product_id,
      new.assigned_l2_approver_id,
      new.claim_count,
      new.total_amount,
      new.hod_approval_hours_sum,
      new.hod_approval_sample_count
    );

    return null;
  end if;

  perform public.apply_claims_analytics_delta(
    old.date_key,
    old.status,
    old.department_id,
    old.payment_mode_id,
    old.expense_category_id,
    old.product_id,
    old.assigned_l2_approver_id,
    -old.claim_count,
    -old.total_amount,
    -old.hod_approval_hours_sum,
    -old.hod_approval_sample_count
  );

  return null;
end;
$$;


ALTER FUNCTION "public"."trg_rollup_claims_analytics_snapshot"() OWNER TO "postgres";

-- Remove constraints introduced for Finance TAT columns (safe if already absent).
ALTER TABLE public.claims_analytics_daily_stats
  DROP CONSTRAINT IF EXISTS claims_analytics_daily_stats_finance_approval_hours_check,
  DROP CONSTRAINT IF EXISTS claims_analytics_daily_stats_finance_approval_samples_check;

ALTER TABLE public.claims_analytics_snapshot
  DROP CONSTRAINT IF EXISTS claims_analytics_snapshot_finance_approval_hours_check,
  DROP CONSTRAINT IF EXISTS claims_analytics_snapshot_finance_approval_samples_check;

-- Remove Finance TAT columns from analytics cache tables.
ALTER TABLE public.claims_analytics_daily_stats
  DROP COLUMN IF EXISTS finance_approval_hours,
  DROP COLUMN IF EXISTS finance_approval_samples;

ALTER TABLE public.claims_analytics_snapshot
  DROP COLUMN IF EXISTS finance_approval_hours,
  DROP COLUMN IF EXISTS finance_approval_samples;

-- Rebuild analytics cache to ensure rolled-back schema and metrics are consistent.
SELECT public.rebuild_claims_analytics_cache();