-- Performance: push dashboard analytics aggregation to Postgres.
-- This RPC returns a fully aggregated analytics payload so the app does not
-- perform in-memory aggregation/filtering on large analytics datasets.

create or replace function public.get_dashboard_analytics_payload(
  p_scope text,
  p_hod_department_ids uuid[] default null,
  p_finance_approver_ids uuid[] default null,
  p_date_from date default null,
  p_date_to date default null,
  p_department_id uuid default null,
  p_expense_category_id uuid default null,
  p_product_id uuid default null,
  p_finance_approver_id uuid default null,
  p_finance_pipeline_statuses public.claim_status[] default null,
  p_approved_statuses public.claim_status[] default null,
  p_pending_statuses public.claim_status[] default null,
  p_rejected_statuses public.claim_status[] default null,
  p_hod_pending_status public.claim_status default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

-- Rollback
-- drop function if exists public.get_dashboard_analytics_payload(
--   text,
--   uuid[],
--   uuid[],
--   date,
--   date,
--   uuid,
--   uuid,
--   uuid,
--   uuid,
--   public.claim_status[],
--   public.claim_status[],
--   public.claim_status[],
--   public.claim_status[],
--   public.claim_status
-- );
