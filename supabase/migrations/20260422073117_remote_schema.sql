


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."claim_status" AS ENUM (
    'Submitted - Awaiting HOD approval',
    'HOD approved - Awaiting finance approval',
    'Finance Approved - Payment under process',
    'Payment Done - Closed',
    'Rejected - Resubmission Not Allowed',
    'Rejected - Resubmission Allowed'
);


ALTER TYPE "public"."claim_status" OWNER TO "postgres";


COMMENT ON TYPE "public"."claim_status" IS 'Canonical claim state enum. UI must render enum values as-is from backend.';



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


CREATE OR REPLACE FUNCTION "public"."bulk_process_claims"("p_action" "text", "p_actor_id" "uuid", "p_claim_ids" "text"[], "p_reason" "text" DEFAULT NULL::"text", "p_allow_resubmission" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim_id text;
  v_processed_count integer := 0;
  v_normalized_action text;
  v_audit_action text;
  v_expected_status public.claim_status;
  v_next_status public.claim_status;
  v_effective_reason text;
  v_beneficiary_id uuid;
  v_payment_mode_name text;
  v_expense_total numeric := 0;
  v_advance_total numeric := 0;
  v_increment_reimbursements numeric := 0;
  v_increment_petty_cash_received numeric := 0;
  v_increment_petty_cash_spent numeric := 0;
begin
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    return 0;
  end if;

  if not exists (
    select 1
    from public.master_finance_approvers mfa
    where mfa.user_id = p_actor_id
      and mfa.is_active = true
  ) then
    raise exception 'p_actor_id is not an active finance approver';
  end if;

  v_normalized_action := upper(trim(coalesce(p_action, '')));

  case v_normalized_action
    when 'L2_APPROVE', 'L2_APPROVED' then
      v_audit_action := 'L2_APPROVED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := 'Finance Approved - Payment under process';
      v_effective_reason := null;

    when 'L2_REJECT', 'L2_REJECTED' then
      v_audit_action := 'L2_REJECTED';
      v_expected_status := 'HOD approved - Awaiting finance approval';
      v_next_status := case
        when p_allow_resubmission then 'Rejected - Resubmission Allowed'
        else 'Rejected - Resubmission Not Allowed'
      end;
      v_effective_reason := nullif(trim(coalesce(p_reason, '')), '');

      if v_effective_reason is null then
        raise exception 'p_reason is required for L2_REJECT';
      end if;

    when 'MARK_PAID', 'L2_MARK_PAID' then
      v_audit_action := 'L2_MARK_PAID';
      v_expected_status := 'Finance Approved - Payment under process';
      v_next_status := 'Payment Done - Closed';
      v_effective_reason := null;

    else
      raise exception 'Unknown bulk action: %', p_action;
  end case;

  foreach v_claim_id in array p_claim_ids loop
    update public.claims
    set
      status = v_next_status,
      rejection_reason = case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end,
      is_resubmission_allowed = case
        when v_audit_action = 'L2_REJECTED' then p_allow_resubmission
        else false
      end,
      finance_action_at = now(),
      updated_at = now()
    where id = v_claim_id
      and is_active = true
      and status = v_expected_status;

    if not found then
      continue;
    end if;

    insert into public.claim_audit_logs (
      claim_id,
      actor_id,
      action_type,
      assigned_to_id,
      remarks
    )
    values (
      v_claim_id,
      p_actor_id,
      v_audit_action,
      null,
      case
        when v_audit_action = 'L2_REJECTED' then v_effective_reason
        else null
      end
    );

    if v_audit_action = 'L2_REJECTED' and p_allow_resubmission then
      update public.expense_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;

      update public.advance_details
      set
        is_active = false,
        updated_at = now()
      where claim_id = v_claim_id
        and is_active = true;
    end if;

    if v_audit_action = 'L2_MARK_PAID' then
      select
        coalesce(c.on_behalf_of_id, c.submitted_by),
        lower(coalesce(pm.name, '')),
        coalesce(
          (
            select ed.total_amount
            from public.expense_details ed
            where ed.claim_id = c.id
              and ed.is_active = true
            limit 1
          ),
          0
        ),
        coalesce(
          (
            select ad.requested_amount
            from public.advance_details ad
            where ad.claim_id = c.id
              and ad.is_active = true
            limit 1
          ),
          0
        )
      into
        v_beneficiary_id,
        v_payment_mode_name,
        v_expense_total,
        v_advance_total
      from public.claims c
      left join public.master_payment_modes pm
        on pm.id = c.payment_mode_id
      where c.id = v_claim_id
      limit 1;

      v_increment_reimbursements := 0;
      v_increment_petty_cash_received := 0;
      v_increment_petty_cash_spent := 0;

      if v_payment_mode_name = 'reimbursement' then
        v_increment_reimbursements := greatest(coalesce(v_expense_total, 0), 0);
      elsif v_payment_mode_name in ('petty cash request', 'bulk petty cash request') then
        v_increment_petty_cash_received := greatest(coalesce(v_advance_total, 0), 0);
      elsif v_payment_mode_name = 'petty cash' then
        v_increment_petty_cash_spent := greatest(coalesce(v_expense_total, 0), 0);
      end if;

      if v_beneficiary_id is not null and (
        v_increment_reimbursements > 0
        or v_increment_petty_cash_received > 0
        or v_increment_petty_cash_spent > 0
      ) then
        insert into public.wallets (
          user_id,
          total_reimbursements_received,
          total_petty_cash_received,
          total_petty_cash_spent
        )
        values (
          v_beneficiary_id,
          v_increment_reimbursements,
          v_increment_petty_cash_received,
          v_increment_petty_cash_spent
        )
        on conflict (user_id)
        do update set
          total_reimbursements_received =
            public.wallets.total_reimbursements_received + excluded.total_reimbursements_received,
          total_petty_cash_received =
            public.wallets.total_petty_cash_received + excluded.total_petty_cash_received,
          total_petty_cash_spent =
            public.wallets.total_petty_cash_spent + excluded.total_petty_cash_spent,
          updated_at = now();
      end if;
    end if;

    v_processed_count := v_processed_count + 1;
  end loop;

  return v_processed_count;
end;
$$;


ALTER FUNCTION "public"."bulk_process_claims"("p_action" "text", "p_actor_id" "uuid", "p_claim_ids" "text"[], "p_reason" "text", "p_allow_resubmission" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_claim_with_detail"("p_payload" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_claim_id text;
  v_initial_status public.claim_status;
  v_payment_mode_name text;
  v_expected_detail_type text;
  v_detail_type text;
  v_basic_amount numeric;
  v_cgst_amount numeric;
  v_sgst_amount numeric;
  v_igst_amount numeric;
  v_is_gst_applicable boolean;
  v_advance_requested_amount numeric;
  v_advance_budget_month integer;
  v_advance_budget_year integer;
begin
  v_claim_id := nullif(trim(p_payload->>'claim_id'), '');

  if v_claim_id is null then
    raise exception 'claim_id is required';
  end if;

  if v_claim_id !~ '^(CLAIM|EA)-[A-Za-z0-9]+-[0-9]{8}-[A-Za-z0-9]+$' then
    raise exception 'claim_id % does not match required format', v_claim_id;
  end if;

  v_initial_status := coalesce(
    nullif(trim(p_payload->>'initial_status'), '')::public.claim_status,
    'Submitted - Awaiting HOD approval'::public.claim_status
  );

  select name into v_payment_mode_name
  from public.master_payment_modes
  where id = (p_payload->>'payment_mode_id')::uuid
    and is_active = true;

  if v_payment_mode_name is null then
    raise exception 'Invalid or inactive payment_mode_id';
  end if;

  if lower(v_payment_mode_name) in ('reimbursement', 'corporate card', 'happay', 'forex', 'petty cash') then
    v_expected_detail_type := 'expense';
  elsif lower(v_payment_mode_name) in ('petty cash request', 'bulk petty cash request') then
    v_expected_detail_type := 'advance';
  else
    raise exception 'Payment mode % is not mapped to a claim detail type', v_payment_mode_name;
  end if;

  v_detail_type := p_payload->>'detail_type';
  if v_detail_type is distinct from v_expected_detail_type then
    raise exception 'detail_type % does not match payment mode %', v_detail_type, v_payment_mode_name;
  end if;

  insert into public.claims (
    id,
    status,
    submission_type,
    detail_type,
    submitted_by,
    on_behalf_of_id,
    on_behalf_email,
    on_behalf_employee_code,
    department_id,
    payment_mode_id,
    assigned_l1_approver_id,
    assigned_l2_approver_id,
    submitted_at,
    is_active
  )
  values (
    v_claim_id,
    v_initial_status,
    p_payload->>'submission_type',
    v_detail_type,
    (p_payload->>'submitted_by')::uuid,
    (p_payload->>'on_behalf_of_id')::uuid,
    coalesce(nullif(trim(p_payload->>'on_behalf_email'), ''), 'N/A'),
    coalesce(nullif(trim(p_payload->>'on_behalf_employee_code'), ''), 'N/A'),
    (p_payload->>'department_id')::uuid,
    (p_payload->>'payment_mode_id')::uuid,
    (p_payload->>'assigned_l1_approver_id')::uuid,
    nullif(p_payload->>'assigned_l2_approver_id', '')::uuid,
    now(),
    true
  )
  returning id into v_claim_id;

  if v_detail_type = 'expense' then
    v_is_gst_applicable := coalesce((p_payload->'expense'->>'is_gst_applicable')::boolean, false);
    v_basic_amount := (p_payload->'expense'->>'basic_amount')::numeric;
    v_cgst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'cgst_amount')::numeric, 0) else 0 end;
    v_sgst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'sgst_amount')::numeric, 0) else 0 end;
    v_igst_amount := case when v_is_gst_applicable then coalesce((p_payload->'expense'->>'igst_amount')::numeric, 0) else 0 end;

    insert into public.expense_details (
      claim_id,
      bill_no,
      transaction_id,
      expense_category_id,
      product_id,
      location_id,
      location_type,
      location_details,
      purpose,
      is_gst_applicable,
      gst_number,
      cgst_amount,
      sgst_amount,
      igst_amount,
      transaction_date,
      basic_amount,
      currency_code,
      vendor_name,
      receipt_file_path,
      bank_statement_file_path,
      people_involved,
      remarks,
      ai_metadata
    )
    values (
      v_claim_id,
      p_payload->'expense'->>'bill_no',
      coalesce(nullif(trim(p_payload->'expense'->>'transaction_id'), ''), 'N/A'),
      (p_payload->'expense'->>'expense_category_id')::uuid,
      nullif(p_payload->'expense'->>'product_id', '')::uuid,
      (p_payload->'expense'->>'location_id')::uuid,
      nullif(trim(p_payload->'expense'->>'location_type'), ''),
      nullif(trim(p_payload->'expense'->>'location_details'), ''),
      coalesce(nullif(trim(p_payload->'expense'->>'purpose'), ''), 'N/A'),
      v_is_gst_applicable,
      coalesce(nullif(trim(p_payload->'expense'->>'gst_number'), ''), 'N/A'),
      v_cgst_amount,
      v_sgst_amount,
      v_igst_amount,
      (p_payload->'expense'->>'transaction_date')::date,
      v_basic_amount,
      coalesce(nullif(trim(p_payload->'expense'->>'currency_code'), ''), 'INR'),
      coalesce(nullif(trim(p_payload->'expense'->>'vendor_name'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'receipt_file_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'bank_statement_file_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'people_involved'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'expense'->>'remarks'), ''), 'N/A'),
      coalesce(p_payload->'expense'->'ai_metadata', '{}'::jsonb)
    );
  end if;

  if v_detail_type = 'advance' then
    v_advance_requested_amount := (p_payload->'advance'->>'requested_amount')::numeric;
    v_advance_budget_month := (p_payload->'advance'->>'budget_month')::integer;
    v_advance_budget_year := (p_payload->'advance'->>'budget_year')::integer;

    if v_advance_requested_amount is null then
      raise exception 'Advance requested_amount is required';
    end if;
    if v_advance_requested_amount <= 0 then
      raise exception 'Advance requested_amount must be greater than zero';
    end if;
    if v_advance_budget_month is null then
      raise exception 'Advance budget_month is required';
    end if;
    if v_advance_budget_year is null then
      raise exception 'Advance budget_year is required';
    end if;

    insert into public.advance_details (
      claim_id,
      requested_amount,
      budget_month,
      budget_year,
      expected_usage_date,
      purpose,
      product_id,
      location_id,
      supporting_document_path,
      remarks
    )
    values (
      v_claim_id,
      v_advance_requested_amount,
      v_advance_budget_month,
      v_advance_budget_year,
      nullif(p_payload->'advance'->>'expected_usage_date', '')::date,
      coalesce(nullif(trim(p_payload->'advance'->>'purpose'), ''), 'N/A'),
      nullif(p_payload->'advance'->>'product_id', '')::uuid,
      nullif(p_payload->'advance'->>'location_id', '')::uuid,
      coalesce(nullif(trim(p_payload->'advance'->>'supporting_document_path'), ''), 'N/A'),
      coalesce(nullif(trim(p_payload->'advance'->>'remarks'), ''), 'N/A')
    );
  end if;

  return v_claim_id;
end;
$_$;


ALTER FUNCTION "public"."create_claim_with_detail"("p_payload" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_full_name text;
begin
  if new.email is null then
    return new;
  end if;

  -- Resolve full_name: full_name -> name -> email prefix.
  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(split_part(new.email, '@', 1)), '')
  );

  insert into public.users (
    id,
    email,
    full_name
  )
  values (
    new.id,
    new.email,
    v_full_name
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(nullif(trim(excluded.full_name), ''), public.users.full_name),
        updated_at = now();

  insert into public.wallets (
    user_id
  )
  values (
    new.id
  )
  on conflict (user_id) do nothing;

  -- Promote provisional finance approver entry.
  update public.master_finance_approvers mfa
  set user_id           = new.id,
      provisional_email = null,
      updated_at        = now()
  where mfa.user_id is null
    and mfa.provisional_email is not null
    and lower(mfa.provisional_email) = lower(new.email)
    and not exists (
      select 1
      from public.master_finance_approvers mfa_existing
      where mfa_existing.user_id = new.id
        and mfa_existing.id <> mfa.id
    );

  -- Promote provisional HOD assignment.
  update public.master_departments md
  set hod_user_id           = new.id,
      hod_provisional_email = null,
      updated_at            = now()
  where md.hod_user_id is null
    and md.hod_provisional_email is not null
    and lower(md.hod_provisional_email) = lower(new.email);

  -- Promote provisional founder assignment.
  update public.master_departments md
  set founder_user_id           = new.id,
      founder_provisional_email = null,
      updated_at                = now()
  where md.founder_user_id is null
    and md.founder_provisional_email is not null
    and lower(md.founder_provisional_email) = lower(new.email);

  -- Promote provisional admin entry.
  update public.admins a
  set user_id           = new.id,
      provisional_email = null,
      updated_at        = now()
  where a.user_id is null
    and a.provisional_email is not null
    and lower(a.provisional_email) = lower(new.email)
    and not exists (
      select 1
      from public.admins a_existing
      where a_existing.user_id = new.id
        and a_existing.id <> a.id
    );

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."make_claims_analytics_bucket_key"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select concat_ws(
    '|',
    to_char(p_date_key, 'YYYY-MM-DD'),
    p_status::text,
    coalesce(p_department_id::text, '__null__'),
    coalesce(p_payment_mode_id::text, '__null__'),
    coalesce(p_expense_category_id::text, '__null__'),
    coalesce(p_product_id::text, '__null__'),
    coalesce(p_assigned_l2_approver_id::text, '__null__')
  );
$$;


ALTER FUNCTION "public"."make_claims_analytics_bucket_key"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_l2_mark_paid_transition"("p_claim_id" "text", "p_actor_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_finance_approver_id uuid;
  v_claim_status public.claim_status;
  v_beneficiary_id uuid;
  v_payment_mode_id uuid;
  v_payment_mode_name text := '';
  v_expense_total numeric := 0;
  v_advance_total numeric := 0;
  v_increment_reimbursements numeric := 0;
  v_increment_petty_cash_received numeric := 0;
  v_increment_petty_cash_spent numeric := 0;
begin
  if p_claim_id is null or btrim(p_claim_id) = '' then
    raise exception 'p_claim_id is required';
  end if;

  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;

  select mfa.id
  into v_actor_finance_approver_id
  from public.master_finance_approvers mfa
  where mfa.user_id = p_actor_id
    and mfa.is_active = true
  order by mfa.created_at asc
  limit 1;

  if v_actor_finance_approver_id is null then
    raise exception 'p_actor_id is not an active finance approver';
  end if;

  select
    c.status,
    coalesce(c.on_behalf_of_id, c.submitted_by),
    c.payment_mode_id,
    coalesce(
      (
        select ed.total_amount
        from public.expense_details ed
        where ed.claim_id = c.id
          and ed.is_active = true
        limit 1
      ),
      0
    ),
    coalesce(
      (
        select ad.requested_amount
        from public.advance_details ad
        where ad.claim_id = c.id
          and ad.is_active = true
        limit 1
      ),
      0
    )
  into
    v_claim_status,
    v_beneficiary_id,
    v_payment_mode_id,
    v_expense_total,
    v_advance_total
  from public.claims c
  where c.id = p_claim_id
    and c.is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive: %', p_claim_id;
  end if;

  if v_payment_mode_id is not null then
    select lower(coalesce(pm.name, ''))
    into v_payment_mode_name
    from public.master_payment_modes pm
    where pm.id = v_payment_mode_id
      and pm.is_active = true
    limit 1;
  end if;

  if v_claim_status <> 'Finance Approved - Payment under process'::public.claim_status then
    raise exception 'Claim is not in payment-under-process stage.';
  end if;

  if v_payment_mode_name = 'reimbursement' then
    v_increment_reimbursements := greatest(coalesce(v_expense_total, 0), 0);
  elsif v_payment_mode_name in ('petty cash request', 'bulk petty cash request') then
    v_increment_petty_cash_received := greatest(coalesce(v_advance_total, 0), 0);
  elsif v_payment_mode_name = 'petty cash' then
    v_increment_petty_cash_spent := greatest(coalesce(v_expense_total, 0), 0);
  end if;

  update public.claims
  set
    status = 'Payment Done - Closed'::public.claim_status,
    assigned_l2_approver_id = v_actor_finance_approver_id,
    rejection_reason = null,
    is_resubmission_allowed = false,
    finance_action_at = now(),
    updated_at = now()
  where id = p_claim_id
    and is_active = true
    and status = 'Finance Approved - Payment under process'::public.claim_status;

  if not found then
    raise exception 'Claim state changed during mark-paid transition: %', p_claim_id;
  end if;

  if v_beneficiary_id is not null and (
    v_increment_reimbursements > 0
    or v_increment_petty_cash_received > 0
    or v_increment_petty_cash_spent > 0
  ) then
    insert into public.wallets (
      user_id,
      total_reimbursements_received,
      total_petty_cash_received,
      total_petty_cash_spent
    )
    values (
      v_beneficiary_id,
      v_increment_reimbursements,
      v_increment_petty_cash_received,
      v_increment_petty_cash_spent
    )
    on conflict (user_id)
    do update set
      total_reimbursements_received =
        public.wallets.total_reimbursements_received + excluded.total_reimbursements_received,
      total_petty_cash_received =
        public.wallets.total_petty_cash_received + excluded.total_petty_cash_received,
      total_petty_cash_spent =
        public.wallets.total_petty_cash_spent + excluded.total_petty_cash_spent,
      updated_at = now();
  end if;

  insert into public.claim_audit_logs (
    claim_id,
    actor_id,
    action_type,
    assigned_to_id,
    remarks
  )
  values (
    p_claim_id,
    p_actor_id,
    'L2_MARK_PAID',
    null,
    null
  );
end;
$$;


ALTER FUNCTION "public"."process_l2_mark_paid_transition"("p_claim_id" "text", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_claims_analytics_cache"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim_id text;
begin
  truncate table public.claims_analytics_daily_stats;
  truncate table public.claims_analytics_snapshot;

  for v_claim_id in
    select id
    from public.claims
    where is_active = true
  loop
    perform public.refresh_claim_analytics_snapshot(v_claim_id);
  end loop;
end;
$$;


ALTER FUNCTION "public"."rebuild_claims_analytics_cache"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."trg_refresh_claim_analytics_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim_id text;
begin
  if tg_table_name = 'claims' then
    v_claim_id := coalesce(new.id, old.id);
  else
    v_claim_id := coalesce(new.claim_id, old.claim_id);
  end if;

  perform public.refresh_claim_analytics_snapshot(v_claim_id);

  return null;
end;
$$;


ALTER FUNCTION "public"."trg_refresh_claim_analytics_snapshot"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim claims%rowtype;
  v_detail_type text;
begin
  select *
  into v_claim
  from public.claims
  where id = p_claim_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive: %', p_claim_id;
  end if;

  v_detail_type := trim(coalesce(p_payload ->> 'detailType', ''));

  if v_detail_type not in ('expense', 'advance') then
    raise exception 'Invalid detailType in finance edit payload.';
  end if;

  if v_claim.detail_type <> v_detail_type then
    raise exception 'Claim detail type mismatch for finance edit request.';
  end if;

  update public.claims
  set
    department_id = (p_payload ->> 'departmentId')::uuid,
    payment_mode_id = (p_payload ->> 'paymentModeId')::uuid,
    updated_at = now()
  where id = p_claim_id
    and is_active = true;

  if v_detail_type = 'expense' then
    update public.expense_details
    set
      bill_no = p_payload ->> 'billNo',
      expense_category_id = (p_payload ->> 'expenseCategoryId')::uuid,
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = (p_payload ->> 'locationId')::uuid,
      transaction_date = (p_payload ->> 'transactionDate')::date,
      is_gst_applicable = (p_payload ->> 'isGstApplicable')::boolean,
      gst_number = nullif(p_payload ->> 'gstNumber', ''),
      basic_amount = (p_payload ->> 'basicAmount')::numeric,
      total_amount = (p_payload ->> 'totalAmount')::numeric,
      vendor_name = nullif(p_payload ->> 'vendorName', ''),
      purpose = p_payload ->> 'purpose',
      people_involved = nullif(p_payload ->> 'peopleInvolved', ''),
      remarks = nullif(p_payload ->> 'remarks', ''),
      receipt_file_path = nullif(p_payload ->> 'receiptFilePath', ''),
      updated_at = now()
    where claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Active expense detail not found for claim: %', p_claim_id;
    end if;
  else
    update public.advance_details
    set
      purpose = p_payload ->> 'purpose',
      requested_amount = (p_payload ->> 'requestedAmount')::numeric,
      expected_usage_date = (p_payload ->> 'expectedUsageDate')::date,
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = nullif(p_payload ->> 'locationId', '')::uuid,
      remarks = nullif(p_payload ->> 'remarks', ''),
      supporting_document_path = nullif(p_payload ->> 'supportingDocumentPath', ''),
      updated_at = now()
    where claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Active advance detail not found for claim: %', p_claim_id;
    end if;
  end if;
end;
$$;


ALTER FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") IS 'Atomically updates claims and corresponding detail table rows for finance edit actions.';



CREATE OR REPLACE FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_claim public.claims%rowtype;
  v_detail_type text;
  v_trimmed_reason text;
  v_detail_id uuid;
begin
  v_trimmed_reason := btrim(coalesce(p_edit_reason, ''));

  if char_length(v_trimmed_reason) < 5 then
    raise exception 'An edit reason is required for the audit log.';
  end if;

  select *
  into v_claim
  from public.claims
  where id = p_claim_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Claim not found or inactive.';
  end if;

  v_detail_type := btrim(coalesce(p_payload ->> 'detailType', ''));

  if v_detail_type not in ('expense', 'advance') then
    raise exception 'Invalid detailType in finance edit payload.';
  end if;

  if v_claim.detail_type <> v_detail_type then
    raise exception 'Claim detail type mismatch for finance edit request.';
  end if;

  v_detail_id := nullif(p_payload ->> 'detailId', '')::uuid;

  if v_detail_id is null then
    raise exception 'Detail ID is required for finance edit payload.';
  end if;

  update public.claims
  set
    payment_mode_id = coalesce(nullif(p_payload ->> 'paymentModeId', '')::uuid, payment_mode_id),
    updated_at = now()
  where id = p_claim_id
    and is_active = true;

  if v_detail_type = 'expense' then
    update public.expense_details
    set
      bill_no = p_payload ->> 'billNo',
      expense_category_id = (p_payload ->> 'expenseCategoryId')::uuid,
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = (p_payload ->> 'locationId')::uuid,
      transaction_date = (p_payload ->> 'transactionDate')::date,
      is_gst_applicable = (p_payload ->> 'isGstApplicable')::boolean,
      gst_number = nullif(p_payload ->> 'gstNumber', ''),
      basic_amount = (p_payload ->> 'basicAmount')::numeric,
      cgst_amount = (p_payload ->> 'cgstAmount')::numeric,
      sgst_amount = (p_payload ->> 'sgstAmount')::numeric,
      igst_amount = (p_payload ->> 'igstAmount')::numeric,
      vendor_name = nullif(p_payload ->> 'vendorName', ''),
      purpose = p_payload ->> 'purpose',
      people_involved = nullif(p_payload ->> 'peopleInvolved', ''),
      remarks = nullif(p_payload ->> 'remarks', ''),
      receipt_file_path = nullif(p_payload ->> 'receiptFilePath', ''),
      bank_statement_file_path = nullif(p_payload ->> 'bankStatementFilePath', ''),
      updated_at = now()
    where id = v_detail_id
      and claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Cannot edit: Expense details missing or soft-deleted.';
    end if;
  else
    update public.advance_details
    set
      purpose = p_payload ->> 'purpose',
      requested_amount = (p_payload ->> 'requestedAmount')::numeric,
      expected_usage_date = (p_payload ->> 'expectedUsageDate')::date,
      product_id = nullif(p_payload ->> 'productId', '')::uuid,
      location_id = nullif(p_payload ->> 'locationId', '')::uuid,
      remarks = nullif(p_payload ->> 'remarks', ''),
      supporting_document_path = nullif(p_payload ->> 'supportingDocumentPath', ''),
      updated_at = now()
    where id = v_detail_id
      and claim_id = p_claim_id
      and is_active = true;

    if not found then
      raise exception 'Cannot edit: Advance details missing or soft-deleted.';
    end if;
  end if;

  insert into public.claim_audit_logs (
    claim_id,
    actor_id,
    action_type,
    assigned_to_id,
    remarks
  ) values (
    p_claim_id,
    p_actor_id,
    'FINANCE_EDITED',
    null,
    v_trimmed_reason
  );
end;
$$;


ALTER FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") IS 'Atomically updates claim detail data and appends FINANCE_EDITED audit log with mandatory reason.';



CREATE OR REPLACE FUNCTION "public"."validate_claim_detail_consistency"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  claim_detail_type text;
begin
  select detail_type into claim_detail_type
  from public.claims
  where id = new.claim_id;

  if claim_detail_type is null then
    raise exception 'Claim % does not exist', new.claim_id;
  end if;

  if tg_table_name = 'expense_details' then
    if claim_detail_type <> 'expense' then
      raise exception 'Claim % is not marked for expense details', new.claim_id;
    end if;

    if exists (select 1 from public.advance_details where claim_id = new.claim_id) then
      raise exception 'Claim % already has advance details', new.claim_id;
    end if;
  end if;

  if tg_table_name = 'advance_details' then
    if claim_detail_type <> 'advance' then
      raise exception 'Claim % is not marked for advance details', new.claim_id;
    end if;

    if exists (select 1 from public.expense_details where claim_id = new.claim_id) then
      raise exception 'Claim % already has expense details', new.claim_id;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_claim_detail_consistency"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."wallets_set_derived_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.total_reimbursements_received := coalesce(new.total_reimbursements_received, 0.00);
  new.total_petty_cash_received := coalesce(new.total_petty_cash_received, 0.00);
  new.total_petty_cash_spent := coalesce(new.total_petty_cash_spent, 0.00);
  new.petty_cash_balance := new.total_petty_cash_received - new.total_petty_cash_spent;
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."wallets_set_derived_fields"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_migration_history" (
    "name" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checksum" "text"
);


ALTER TABLE "public"."_migration_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provisional_email" "text",
    CONSTRAINT "admins_user_or_email_required" CHECK ((("user_id" IS NOT NULL) OR ("provisional_email" IS NOT NULL)))
);


ALTER TABLE "public"."admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."advance_details" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "claim_id" "text" NOT NULL,
    "requested_amount" numeric(12,2) NOT NULL,
    "budget_month" integer NOT NULL,
    "budget_year" integer NOT NULL,
    "expected_usage_date" "date",
    "purpose" "text" NOT NULL,
    "product_id" "uuid",
    "location_id" "uuid",
    "remarks" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supporting_document_path" "text",
    CONSTRAINT "advance_details_budget_month_check" CHECK ((("budget_month" >= 1) AND ("budget_month" <= 12))),
    CONSTRAINT "advance_details_budget_year_check" CHECK ((("budget_year" >= 2000) AND ("budget_year" <= 2200))),
    CONSTRAINT "advance_details_requested_amount_check" CHECK (("requested_amount" > (0)::numeric))
);


ALTER TABLE "public"."advance_details" OWNER TO "postgres";


COMMENT ON TABLE "public"."advance_details" IS 'Advance branch details for petty cash request/bulk petty cash request payment modes.';



CREATE TABLE IF NOT EXISTS "public"."allowed_auth_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."allowed_auth_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claim_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "claim_id" "text" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "assigned_to_id" "uuid",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "claim_audit_logs_action_type_check" CHECK (("action_type" = ANY (ARRAY['SUBMITTED'::"text", 'UPDATED'::"text", 'L1_APPROVED'::"text", 'L1_REJECTED'::"text", 'L2_APPROVED'::"text", 'L2_REJECTED'::"text", 'L2_MARK_PAID'::"text", 'FINANCE_EDITED'::"text", 'ADMIN_SOFT_DELETED'::"text", 'ADMIN_PAYMENT_MODE_OVERRIDDEN'::"text"])))
);


ALTER TABLE "public"."claim_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claims" (
    "id" "text" NOT NULL,
    "status" "public"."claim_status" DEFAULT 'Submitted - Awaiting HOD approval'::"public"."claim_status" NOT NULL,
    "submission_type" "text" NOT NULL,
    "detail_type" "text" NOT NULL,
    "submitted_by" "uuid" NOT NULL,
    "on_behalf_email" "text",
    "on_behalf_employee_code" "text",
    "department_id" "uuid" NOT NULL,
    "payment_mode_id" "uuid" NOT NULL,
    "assigned_l1_approver_id" "uuid" NOT NULL,
    "assigned_l2_approver_id" "uuid",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "employee_id" "text" DEFAULT ''::"text" NOT NULL,
    "cc_emails" "text",
    "rejection_reason" "text",
    "on_behalf_of_id" "uuid" NOT NULL,
    "hod_action_at" timestamp with time zone,
    "finance_action_at" timestamp with time zone,
    "is_resubmission_allowed" boolean DEFAULT false NOT NULL,
    "deleted_by" "uuid",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "claims_detail_type_check" CHECK (("detail_type" = ANY (ARRAY['expense'::"text", 'advance'::"text"]))),
    CONSTRAINT "claims_on_behalf_fields" CHECK (((("submission_type" = 'Self'::"text") AND (COALESCE("on_behalf_email", 'N/A'::"text") = 'N/A'::"text") AND (COALESCE("on_behalf_employee_code", 'N/A'::"text") = 'N/A'::"text") AND ("on_behalf_of_id" = "submitted_by")) OR (("submission_type" = 'On Behalf'::"text") AND (COALESCE("on_behalf_email", 'N/A'::"text") <> 'N/A'::"text") AND (COALESCE("on_behalf_employee_code", 'N/A'::"text") <> 'N/A'::"text") AND ("on_behalf_of_id" IS NOT NULL)))),
    CONSTRAINT "claims_submission_type_check" CHECK (("submission_type" = ANY (ARRAY['Self'::"text", 'On Behalf'::"text"])))
);


ALTER TABLE "public"."claims" OWNER TO "postgres";


COMMENT ON TABLE "public"."claims" IS 'Claim header table. Strict 1 claim = 1 transaction via child-table uniqueness and consistency triggers. No draft state supported.';



COMMENT ON COLUMN "public"."claims"."rejection_reason" IS 'Mandatory reason captured when a claim is rejected by L1 or Finance approver.';



CREATE TABLE IF NOT EXISTS "public"."claims_analytics_daily_stats" (
    "bucket_key" "text" NOT NULL,
    "date_key" "date" NOT NULL,
    "status" "public"."claim_status" NOT NULL,
    "department_id" "uuid",
    "payment_mode_id" "uuid",
    "expense_category_id" "uuid",
    "product_id" "uuid",
    "assigned_l2_approver_id" "uuid",
    "claim_count" integer DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "hod_approval_hours_sum" numeric(14,4) DEFAULT 0 NOT NULL,
    "hod_approval_sample_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "claims_analytics_daily_stats_claim_count_check" CHECK (("claim_count" >= 0)),
    CONSTRAINT "claims_analytics_daily_stats_hod_approval_hours_sum_check" CHECK (("hod_approval_hours_sum" >= (0)::numeric)),
    CONSTRAINT "claims_analytics_daily_stats_hod_approval_sample_count_check" CHECK (("hod_approval_sample_count" >= 0)),
    CONSTRAINT "claims_analytics_daily_stats_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."claims_analytics_daily_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claims_analytics_snapshot" (
    "claim_id" "text" NOT NULL,
    "date_key" "date" NOT NULL,
    "status" "public"."claim_status" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "payment_mode_id" "uuid" NOT NULL,
    "expense_category_id" "uuid",
    "product_id" "uuid",
    "assigned_l2_approver_id" "uuid",
    "claim_count" integer DEFAULT 1 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "hod_approval_hours_sum" numeric(14,4) DEFAULT 0 NOT NULL,
    "hod_approval_sample_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "claims_analytics_snapshot_claim_count_check" CHECK (("claim_count" = 1)),
    CONSTRAINT "claims_analytics_snapshot_hod_approval_hours_sum_check" CHECK (("hod_approval_hours_sum" >= (0)::numeric)),
    CONSTRAINT "claims_analytics_snapshot_hod_approval_sample_count_check" CHECK (("hod_approval_sample_count" >= 0)),
    CONSTRAINT "claims_analytics_snapshot_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."claims_analytics_snapshot" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_viewers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."department_viewers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_details" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "claim_id" "text" NOT NULL,
    "bill_no" "text" NOT NULL,
    "expense_category_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "location_id" "uuid" NOT NULL,
    "is_gst_applicable" boolean DEFAULT false NOT NULL,
    "gst_number" "text",
    "transaction_date" "date" NOT NULL,
    "basic_amount" numeric(12,2) NOT NULL,
    "currency_code" "text" DEFAULT 'INR'::"text" NOT NULL,
    "vendor_name" "text",
    "receipt_file_path" "text",
    "remarks" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bank_statement_file_path" "text",
    "people_involved" "text",
    "purpose" "text" DEFAULT 'General Expense'::"text" NOT NULL,
    "cgst_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "sgst_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "igst_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "transaction_id" "text",
    "total_amount" numeric GENERATED ALWAYS AS ((((COALESCE("basic_amount", (0)::numeric) + COALESCE("cgst_amount", (0)::numeric)) + COALESCE("sgst_amount", (0)::numeric)) + COALESCE("igst_amount", (0)::numeric))) STORED,
    "location_type" "text",
    "location_details" "text",
    "ai_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "chk_expense_location_details_requires_out_station" CHECK ((("location_type" = 'Out Station'::"text") OR ("location_details" IS NULL))),
    CONSTRAINT "expense_details_claimed_amount_check" CHECK (("basic_amount" > (0)::numeric)),
    CONSTRAINT "expense_details_gst_fields" CHECK (((("is_gst_applicable" = false) AND ("cgst_amount" = (0)::numeric) AND ("sgst_amount" = (0)::numeric) AND ("igst_amount" = (0)::numeric)) OR (("is_gst_applicable" = true) AND ("cgst_amount" >= (0)::numeric) AND ("sgst_amount" >= (0)::numeric) AND ("igst_amount" >= (0)::numeric))))
);


ALTER TABLE "public"."expense_details" OWNER TO "postgres";


COMMENT ON TABLE "public"."expense_details" IS 'Expense branch details for reimbursement/corporate card/happay/forex payment modes.';



COMMENT ON COLUMN "public"."expense_details"."location_type" IS 'Per-expense location classification: Base Location or Out Station. NULL for legacy claims.';



COMMENT ON COLUMN "public"."expense_details"."location_details" IS 'Free-text details required when location_type is Out Station. NULL otherwise.';



COMMENT ON COLUMN "public"."expense_details"."ai_metadata" IS 'AI extraction audit metadata, including edited_fields originals for finance/admin review.';



CREATE TABLE IF NOT EXISTS "public"."master_departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "hod_user_id" "uuid",
    "founder_user_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hod_provisional_email" "text",
    "founder_provisional_email" "text",
    CONSTRAINT "dept_founder_user_or_email_required" CHECK ((("founder_user_id" IS NOT NULL) OR ("founder_provisional_email" IS NOT NULL))),
    CONSTRAINT "dept_hod_user_or_email_required" CHECK ((("hod_user_id" IS NOT NULL) OR ("hod_provisional_email" IS NOT NULL)))
);


ALTER TABLE "public"."master_departments" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_departments" IS 'Department master mapping for dynamic L1 routing. HOD and founder may be same for specific departments based on source master data.';



CREATE TABLE IF NOT EXISTS "public"."master_expense_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."master_expense_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_expense_categories" IS 'Master data table for transaction/expense categories. Soft delete via is_active only.';



CREATE TABLE IF NOT EXISTS "public"."master_finance_approvers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "is_primary" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provisional_email" "text",
    CONSTRAINT "finance_approver_user_or_email_required" CHECK (((("user_id" IS NOT NULL) AND ("provisional_email" IS NULL)) OR (("user_id" IS NULL) AND ("provisional_email" IS NOT NULL))))
);


ALTER TABLE "public"."master_finance_approvers" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_finance_approvers" IS 'Dedicated L2 approver mapping. Claims route to active finance approver(s) only.';



CREATE TABLE IF NOT EXISTS "public"."master_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."master_locations" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_locations" IS 'Master data table for locations. Soft delete via is_active only.';



CREATE TABLE IF NOT EXISTS "public"."master_payment_modes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."master_payment_modes" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_payment_modes" IS 'Master data table for payment modes. Soft delete via is_active only.';



CREATE TABLE IF NOT EXISTS "public"."master_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version_name" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."master_policies" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_policies" IS 'Versioned company policy records. file_url points to a PDF stored in the public policies bucket.';



CREATE TABLE IF NOT EXISTS "public"."master_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."master_products" OWNER TO "postgres";


COMMENT ON TABLE "public"."master_products" IS 'Master data table for products. Soft delete via is_active only.';



CREATE TABLE IF NOT EXISTS "public"."user_policy_acceptances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_policy_acceptances" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_policy_acceptances" IS 'Legal audit trail of user acceptance timestamps per policy version. Historical rows are immutable.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'employee'::"text" NOT NULL,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['employee'::"text", 'hod'::"text", 'founder'::"text", 'finance'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_claims_dashboard" WITH ("security_invoker"='on') AS
 SELECT "c"."id" AS "claim_id",
    COALESCE(NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text"), NULLIF(TRIM(BOTH FROM "split_part"("u"."email", '@'::"text", 1)), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), 'N/A'::"text") AS "employee_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_employee_code"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text"), 'N/A'::"text") AS "employee_id",
    "c"."employee_id" AS "claim_employee_id_raw",
    "c"."on_behalf_employee_code" AS "on_behalf_employee_code_raw",
    NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") AS "submitter_name_raw",
    NULLIF(TRIM(BOTH FROM "beneficiary"."full_name"), ''::"text") AS "beneficiary_name_raw",
    COALESCE(NULLIF(TRIM(BOTH FROM "md"."name"), ''::"text"), 'Unknown Department'::"text") AS "department_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "mpm"."name"), ''::"text"),
        CASE
            WHEN ("c"."detail_type" = 'advance'::"text") THEN 'Advance'::"text"
            WHEN ("c"."detail_type" = 'expense'::"text") THEN 'Expense'::"text"
            ELSE 'Unknown'::"text"
        END) AS "type_of_claim",
    (COALESCE("ed"."total_amount", "ad"."requested_amount", (0)::numeric))::numeric(14,2) AS "amount",
    "c"."status",
    COALESCE("c"."submitted_at", "c"."created_at") AS "submitted_on",
    COALESCE("c"."hod_action_at",
        CASE
            WHEN ("c"."status" = 'HOD approved - Awaiting finance approval'::"public"."claim_status") THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "hod_action_date",
    COALESCE("c"."finance_action_at",
        CASE
            WHEN ("c"."status" = ANY (ARRAY['Finance Approved - Payment under process'::"public"."claim_status", 'Payment Done - Closed'::"public"."claim_status"])) THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NOT NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "finance_action_date",
    COALESCE("ed"."location_id", "ad"."location_id") AS "location_id",
    COALESCE("ed"."product_id", "ad"."product_id") AS "product_id",
    "ed"."expense_category_id",
    "c"."submitted_by",
    "c"."on_behalf_of_id",
    "c"."on_behalf_email",
    "c"."assigned_l1_approver_id",
    "c"."assigned_l2_approver_id",
    "c"."department_id",
    "c"."payment_mode_id",
    "c"."detail_type",
    "c"."submission_type",
    "c"."is_active",
    "c"."created_at",
    "c"."updated_at",
    "c"."deleted_by",
    "c"."deleted_at",
    NULLIF(TRIM(BOTH FROM "deleted_by_user"."full_name"), ''::"text") AS "deleted_by_name",
    "deleted_by_user"."role" AS "deleted_by_role",
    "u"."email" AS "submitter_email",
    "hod"."email" AS "hod_email",
    "finance"."email" AS "finance_email",
        CASE
            WHEN ((NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL)) THEN (((TRIM(BOTH FROM "u"."full_name") || ' ('::"text") || TRIM(BOTH FROM "u"."email")) || ')'::"text")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."full_name")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."email")
            ELSE "c"."employee_id"
        END AS "submitter_label",
        CASE
            WHEN ("c"."detail_type" = 'expense'::"text") THEN COALESCE(NULLIF(TRIM(BOTH FROM "mec_name"."name"), ''::"text"), 'Uncategorized'::"text")
            ELSE 'Advance'::"text"
        END AS "category_name",
    COALESCE("ed"."purpose", "ad"."purpose") AS "purpose",
    "ed"."receipt_file_path",
    "ed"."bank_statement_file_path",
    "ad"."supporting_document_path"
   FROM (((((((((("public"."claims" "c"
     LEFT JOIN "public"."users" "u" ON (("u"."id" = "c"."submitted_by")))
     LEFT JOIN "public"."users" "beneficiary" ON (("beneficiary"."id" = "c"."on_behalf_of_id")))
     LEFT JOIN "public"."users" "hod" ON (("hod"."id" = "c"."assigned_l1_approver_id")))
     LEFT JOIN "public"."users" "finance" ON (("finance"."id" = "c"."assigned_l2_approver_id")))
     LEFT JOIN "public"."users" "deleted_by_user" ON (("deleted_by_user"."id" = "c"."deleted_by")))
     LEFT JOIN "public"."master_departments" "md" ON (("md"."id" = "c"."department_id")))
     LEFT JOIN "public"."master_payment_modes" "mpm" ON (("mpm"."id" = "c"."payment_mode_id")))
     LEFT JOIN "public"."expense_details" "ed" ON (("ed"."claim_id" = "c"."id")))
     LEFT JOIN "public"."master_expense_categories" "mec_name" ON (("mec_name"."id" = "ed"."expense_category_id")))
     LEFT JOIN "public"."advance_details" "ad" ON (("ad"."claim_id" = "c"."id")));


ALTER VIEW "public"."vw_admin_claims_dashboard" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_enterprise_claims_dashboard" WITH ("security_invoker"='on') AS
 SELECT "c"."id" AS "claim_id",
    COALESCE(NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text"), NULLIF(TRIM(BOTH FROM "split_part"("u"."email", '@'::"text", 1)), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), 'N/A'::"text") AS "employee_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_employee_code"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text"), 'N/A'::"text") AS "employee_id",
    "c"."employee_id" AS "claim_employee_id_raw",
    "c"."on_behalf_employee_code" AS "on_behalf_employee_code_raw",
    NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") AS "submitter_name_raw",
    NULLIF(TRIM(BOTH FROM "beneficiary"."full_name"), ''::"text") AS "beneficiary_name_raw",
    COALESCE(NULLIF(TRIM(BOTH FROM "md"."name"), ''::"text"), 'Unknown Department'::"text") AS "department_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "mpm"."name"), ''::"text"),
        CASE
            WHEN ("c"."detail_type" = 'advance'::"text") THEN 'Advance'::"text"
            WHEN ("c"."detail_type" = 'expense'::"text") THEN 'Expense'::"text"
            ELSE 'Unknown'::"text"
        END) AS "type_of_claim",
    (COALESCE("ed"."total_amount", "ad"."requested_amount", (0)::numeric))::numeric(14,2) AS "amount",
    "c"."status",
    COALESCE("c"."submitted_at", "c"."created_at") AS "submitted_on",
    COALESCE("c"."hod_action_at",
        CASE
            WHEN ("c"."status" = 'HOD approved - Awaiting finance approval'::"public"."claim_status") THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "hod_action_date",
    COALESCE("c"."finance_action_at",
        CASE
            WHEN ("c"."status" = ANY (ARRAY['Finance Approved - Payment under process'::"public"."claim_status", 'Payment Done - Closed'::"public"."claim_status"])) THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NOT NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "finance_action_date",
    COALESCE("ed"."location_id", "ad"."location_id") AS "location_id",
    COALESCE("ed"."product_id", "ad"."product_id") AS "product_id",
    "ed"."expense_category_id",
    "c"."submitted_by",
    "c"."on_behalf_of_id",
    "c"."on_behalf_email",
    "c"."assigned_l1_approver_id",
    "c"."assigned_l2_approver_id",
    "c"."department_id",
    "c"."payment_mode_id",
    "c"."detail_type",
    "c"."submission_type",
    "c"."is_active",
    "c"."created_at",
    "c"."updated_at",
    "u"."email" AS "submitter_email",
    "hod"."email" AS "hod_email",
    "finance"."email" AS "finance_email",
        CASE
            WHEN ((NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL)) THEN (((TRIM(BOTH FROM "u"."full_name") || ' ('::"text") || TRIM(BOTH FROM "u"."email")) || ')'::"text")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."full_name")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."email")
            ELSE "c"."employee_id"
        END AS "submitter_label",
        CASE
            WHEN ("c"."detail_type" = 'expense'::"text") THEN COALESCE(NULLIF(TRIM(BOTH FROM "mec_name"."name"), ''::"text"), 'Uncategorized'::"text")
            ELSE 'Advance'::"text"
        END AS "category_name",
    COALESCE("ed"."purpose", "ad"."purpose") AS "purpose",
    "ed"."receipt_file_path",
    "ed"."bank_statement_file_path",
    "ad"."supporting_document_path"
   FROM ((((((((("public"."claims" "c"
     LEFT JOIN "public"."users" "u" ON (("u"."id" = "c"."submitted_by")))
     LEFT JOIN "public"."users" "beneficiary" ON (("beneficiary"."id" = "c"."on_behalf_of_id")))
     LEFT JOIN "public"."users" "hod" ON (("hod"."id" = "c"."assigned_l1_approver_id")))
     LEFT JOIN "public"."users" "finance" ON (("finance"."id" = "c"."assigned_l2_approver_id")))
     LEFT JOIN "public"."master_departments" "md" ON (("md"."id" = "c"."department_id")))
     LEFT JOIN "public"."master_payment_modes" "mpm" ON (("mpm"."id" = "c"."payment_mode_id")))
     LEFT JOIN "public"."expense_details" "ed" ON ((("ed"."claim_id" = "c"."id") AND ("ed"."is_active" = true))))
     LEFT JOIN "public"."master_expense_categories" "mec_name" ON (("mec_name"."id" = "ed"."expense_category_id")))
     LEFT JOIN "public"."advance_details" "ad" ON ((("ad"."claim_id" = "c"."id") AND ("ad"."is_active" = true))))
  WHERE ("c"."is_active" = true);


ALTER VIEW "public"."vw_enterprise_claims_dashboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "total_reimbursements_received" numeric(14,2) DEFAULT 0.00 NOT NULL,
    "total_petty_cash_received" numeric(14,2) DEFAULT 0.00 NOT NULL,
    "total_petty_cash_spent" numeric(14,2) DEFAULT 0.00 NOT NULL,
    "petty_cash_balance" numeric(14,2) DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wallets_petty_cash_balance_consistency" CHECK (("petty_cash_balance" = ("total_petty_cash_received" - "total_petty_cash_spent"))),
    CONSTRAINT "wallets_total_petty_cash_received_non_negative" CHECK (("total_petty_cash_received" >= (0)::numeric)),
    CONSTRAINT "wallets_total_petty_cash_spent_non_negative" CHECK (("total_petty_cash_spent" >= (0)::numeric)),
    CONSTRAINT "wallets_total_reimbursements_non_negative" CHECK (("total_reimbursements_received" >= (0)::numeric))
);


ALTER TABLE "public"."wallets" OWNER TO "postgres";


ALTER TABLE ONLY "public"."_migration_history"
    ADD CONSTRAINT "_migration_history_pkey" PRIMARY KEY ("name");



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."advance_details"
    ADD CONSTRAINT "advance_details_claim_id_key" UNIQUE ("claim_id");



ALTER TABLE ONLY "public"."advance_details"
    ADD CONSTRAINT "advance_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."allowed_auth_domains"
    ADD CONSTRAINT "allowed_auth_domains_domain_key" UNIQUE ("domain");



ALTER TABLE ONLY "public"."allowed_auth_domains"
    ADD CONSTRAINT "allowed_auth_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claim_audit_logs"
    ADD CONSTRAINT "claim_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claims_analytics_daily_stats"
    ADD CONSTRAINT "claims_analytics_daily_stats_pkey" PRIMARY KEY ("bucket_key");



ALTER TABLE ONLY "public"."claims_analytics_snapshot"
    ADD CONSTRAINT "claims_analytics_snapshot_pkey" PRIMARY KEY ("claim_id");



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_viewers"
    ADD CONSTRAINT "department_viewers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_viewers"
    ADD CONSTRAINT "department_viewers_unique_assignment" UNIQUE ("user_id", "department_id");



ALTER TABLE ONLY "public"."expense_details"
    ADD CONSTRAINT "expense_details_claim_id_key" UNIQUE ("claim_id");



ALTER TABLE ONLY "public"."expense_details"
    ADD CONSTRAINT "expense_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_departments"
    ADD CONSTRAINT "master_departments_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."master_departments"
    ADD CONSTRAINT "master_departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_expense_categories"
    ADD CONSTRAINT "master_expense_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."master_expense_categories"
    ADD CONSTRAINT "master_expense_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_finance_approvers"
    ADD CONSTRAINT "master_finance_approvers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_finance_approvers"
    ADD CONSTRAINT "master_finance_approvers_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."master_locations"
    ADD CONSTRAINT "master_locations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."master_locations"
    ADD CONSTRAINT "master_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_payment_modes"
    ADD CONSTRAINT "master_payment_modes_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."master_payment_modes"
    ADD CONSTRAINT "master_payment_modes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_policies"
    ADD CONSTRAINT "master_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_policies"
    ADD CONSTRAINT "master_policies_version_name_key" UNIQUE ("version_name");



ALTER TABLE ONLY "public"."master_products"
    ADD CONSTRAINT "master_products_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."master_products"
    ADD CONSTRAINT "master_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_policy_acceptances"
    ADD CONSTRAINT "user_policy_acceptances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_policy_acceptances"
    ADD CONSTRAINT "user_policy_acceptances_user_policy_key" UNIQUE ("user_id", "policy_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_user_id_key" UNIQUE ("user_id");



CREATE INDEX "idx_admins_provisional_email" ON "public"."admins" USING "btree" ("provisional_email") WHERE ("provisional_email" IS NOT NULL);



CREATE INDEX "idx_advance_details_claim_id" ON "public"."advance_details" USING "btree" ("claim_id");



CREATE INDEX "idx_advance_details_location_id" ON "public"."advance_details" USING "btree" ("location_id");



CREATE INDEX "idx_advance_details_product_id" ON "public"."advance_details" USING "btree" ("product_id");



CREATE INDEX "idx_claim_audit_logs_actor_id" ON "public"."claim_audit_logs" USING "btree" ("actor_id");



CREATE INDEX "idx_claim_audit_logs_assigned_to_id" ON "public"."claim_audit_logs" USING "btree" ("assigned_to_id", "created_at" DESC);



CREATE INDEX "idx_claim_audit_logs_claim_created_at" ON "public"."claim_audit_logs" USING "btree" ("claim_id", "created_at");



CREATE INDEX "idx_claim_audit_logs_created_at" ON "public"."claim_audit_logs" USING "btree" ("created_at");



CREATE INDEX "idx_claims_analytics_daily_stats_date_key" ON "public"."claims_analytics_daily_stats" USING "btree" ("date_key" DESC);



CREATE INDEX "idx_claims_analytics_daily_stats_department_date" ON "public"."claims_analytics_daily_stats" USING "btree" ("department_id", "date_key" DESC);



CREATE INDEX "idx_claims_analytics_daily_stats_expense_category_date" ON "public"."claims_analytics_daily_stats" USING "btree" ("expense_category_id", "date_key" DESC);



CREATE INDEX "idx_claims_analytics_daily_stats_finance_approver_date" ON "public"."claims_analytics_daily_stats" USING "btree" ("assigned_l2_approver_id", "date_key" DESC);



CREATE INDEX "idx_claims_analytics_daily_stats_payment_mode_date" ON "public"."claims_analytics_daily_stats" USING "btree" ("payment_mode_id", "date_key" DESC);



CREATE INDEX "idx_claims_analytics_daily_stats_product_date" ON "public"."claims_analytics_daily_stats" USING "btree" ("product_id", "date_key" DESC);



CREATE INDEX "idx_claims_analytics_daily_stats_status" ON "public"."claims_analytics_daily_stats" USING "btree" ("status");



CREATE INDEX "idx_claims_analytics_snapshot_assigned_l2_approver_id" ON "public"."claims_analytics_snapshot" USING "btree" ("assigned_l2_approver_id");



CREATE INDEX "idx_claims_analytics_snapshot_department_id" ON "public"."claims_analytics_snapshot" USING "btree" ("department_id");



CREATE INDEX "idx_claims_analytics_snapshot_expense_category_id" ON "public"."claims_analytics_snapshot" USING "btree" ("expense_category_id");



CREATE INDEX "idx_claims_analytics_snapshot_payment_mode_id" ON "public"."claims_analytics_snapshot" USING "btree" ("payment_mode_id");



CREATE INDEX "idx_claims_analytics_snapshot_product_id" ON "public"."claims_analytics_snapshot" USING "btree" ("product_id");



CREATE INDEX "idx_claims_assigned_l1_approver_id" ON "public"."claims" USING "btree" ("assigned_l1_approver_id");



CREATE INDEX "idx_claims_assigned_l2_approver_id" ON "public"."claims" USING "btree" ("assigned_l2_approver_id");



CREATE INDEX "idx_claims_created_at" ON "public"."claims" USING "btree" ("created_at");



CREATE INDEX "idx_claims_dashboard_active_department_submitted" ON "public"."claims" USING "btree" ("department_id", "submitted_at" DESC) WHERE ("is_active" = true);



CREATE INDEX "idx_claims_dashboard_active_finance_action_date_expr" ON "public"."claims" USING "btree" (COALESCE("finance_action_at",
CASE
    WHEN ("status" = ANY (ARRAY['Finance Approved - Payment under process'::"public"."claim_status", 'Payment Done - Closed'::"public"."claim_status"])) THEN "updated_at"
    WHEN (("status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("assigned_l2_approver_id" IS NOT NULL)) THEN "updated_at"
    ELSE NULL::timestamp with time zone
END)) WHERE ("is_active" = true);



CREATE INDEX "idx_claims_dashboard_active_hod_action_date_expr" ON "public"."claims" USING "btree" (COALESCE("hod_action_at",
CASE
    WHEN ("status" = 'HOD approved - Awaiting finance approval'::"public"."claim_status") THEN "updated_at"
    WHEN (("status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("assigned_l2_approver_id" IS NULL)) THEN "updated_at"
    ELSE NULL::timestamp with time zone
END)) WHERE ("is_active" = true);



CREATE INDEX "idx_claims_dashboard_active_status_submitted" ON "public"."claims" USING "btree" ("status", "submitted_at" DESC) WHERE ("is_active" = true);



CREATE INDEX "idx_claims_dashboard_active_submitted" ON "public"."claims" USING "btree" ("submitted_at" DESC) WHERE ("is_active" = true);



CREATE INDEX "idx_claims_dashboard_active_submitted_on_expr" ON "public"."claims" USING "btree" (COALESCE("submitted_at", "created_at")) WHERE ("is_active" = true);



CREATE INDEX "idx_claims_department_id" ON "public"."claims" USING "btree" ("department_id");



CREATE INDEX "idx_claims_employee_id_trgm" ON "public"."claims" USING "gin" ("employee_id" "public"."gin_trgm_ops") WHERE (("is_active" = true) AND ("employee_id" <> ''::"text"));



CREATE INDEX "idx_claims_finance_action_at" ON "public"."claims" USING "btree" ("finance_action_at");



CREATE INDEX "idx_claims_hod_action_at" ON "public"."claims" USING "btree" ("hod_action_at");



CREATE INDEX "idx_claims_id_trgm" ON "public"."claims" USING "gin" ("id" "public"."gin_trgm_ops") WHERE ("is_active" = true);



CREATE INDEX "idx_claims_is_active" ON "public"."claims" USING "btree" ("is_active");



CREATE INDEX "idx_claims_on_behalf_email_trgm" ON "public"."claims" USING "gin" ("on_behalf_email" "public"."gin_trgm_ops") WHERE (("is_active" = true) AND ("on_behalf_email" IS NOT NULL) AND ("on_behalf_email" <> ''::"text"));



CREATE INDEX "idx_claims_on_behalf_employee_code_trgm" ON "public"."claims" USING "gin" ("on_behalf_employee_code" "public"."gin_trgm_ops") WHERE (("is_active" = true) AND ("on_behalf_employee_code" IS NOT NULL) AND ("on_behalf_employee_code" <> ''::"text"));



CREATE INDEX "idx_claims_on_behalf_of_id" ON "public"."claims" USING "btree" ("on_behalf_of_id");



CREATE INDEX "idx_claims_payment_mode_id" ON "public"."claims" USING "btree" ("payment_mode_id");



CREATE INDEX "idx_claims_status" ON "public"."claims" USING "btree" ("status");



CREATE INDEX "idx_claims_status_approver_submitted" ON "public"."claims" USING "btree" ("status", "assigned_l1_approver_id", "submitted_at" DESC) WHERE ("is_active" = true);



CREATE INDEX "idx_claims_submitted_by" ON "public"."claims" USING "btree" ("submitted_by");



CREATE INDEX "idx_department_viewers_active" ON "public"."department_viewers" USING "btree" ("user_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_department_viewers_department_id" ON "public"."department_viewers" USING "btree" ("department_id");



CREATE INDEX "idx_department_viewers_user_id" ON "public"."department_viewers" USING "btree" ("user_id");



CREATE INDEX "idx_expense_details_bill_no" ON "public"."expense_details" USING "btree" ("bill_no");



CREATE INDEX "idx_expense_details_claim_id" ON "public"."expense_details" USING "btree" ("claim_id");



CREATE INDEX "idx_expense_details_expense_category_id" ON "public"."expense_details" USING "btree" ("expense_category_id");



CREATE INDEX "idx_expense_details_location_id" ON "public"."expense_details" USING "btree" ("location_id");



CREATE INDEX "idx_expense_details_product_id" ON "public"."expense_details" USING "btree" ("product_id");



CREATE INDEX "idx_master_departments_founder_provisional_email" ON "public"."master_departments" USING "btree" ("founder_provisional_email") WHERE ("founder_provisional_email" IS NOT NULL);



CREATE INDEX "idx_master_departments_founder_user_id" ON "public"."master_departments" USING "btree" ("founder_user_id");



CREATE INDEX "idx_master_departments_hod_provisional_email" ON "public"."master_departments" USING "btree" ("hod_provisional_email") WHERE ("hod_provisional_email" IS NOT NULL);



CREATE INDEX "idx_master_departments_hod_user_id" ON "public"."master_departments" USING "btree" ("hod_user_id");



CREATE INDEX "idx_master_departments_is_active" ON "public"."master_departments" USING "btree" ("is_active");



CREATE INDEX "idx_master_expense_categories_is_active" ON "public"."master_expense_categories" USING "btree" ("is_active");



CREATE INDEX "idx_master_finance_approvers_is_active" ON "public"."master_finance_approvers" USING "btree" ("is_active");



CREATE INDEX "idx_master_finance_approvers_is_primary" ON "public"."master_finance_approvers" USING "btree" ("is_primary");



CREATE INDEX "idx_master_finance_approvers_provisional_email" ON "public"."master_finance_approvers" USING "btree" ("provisional_email") WHERE ("provisional_email" IS NOT NULL);



CREATE INDEX "idx_master_locations_is_active" ON "public"."master_locations" USING "btree" ("is_active");



CREATE INDEX "idx_master_payment_modes_is_active" ON "public"."master_payment_modes" USING "btree" ("is_active");



CREATE INDEX "idx_master_policies_created_at" ON "public"."master_policies" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_master_policies_is_active" ON "public"."master_policies" USING "btree" ("is_active");



CREATE INDEX "idx_master_products_is_active" ON "public"."master_products" USING "btree" ("is_active");



CREATE INDEX "idx_user_policy_acceptances_accepted_at" ON "public"."user_policy_acceptances" USING "btree" ("accepted_at" DESC);



CREATE INDEX "idx_user_policy_acceptances_policy_id" ON "public"."user_policy_acceptances" USING "btree" ("policy_id");



CREATE INDEX "idx_user_policy_acceptances_user_id" ON "public"."user_policy_acceptances" USING "btree" ("user_id");



CREATE INDEX "idx_users_email_trgm" ON "public"."users" USING "gin" ("email" "public"."gin_trgm_ops");



CREATE INDEX "idx_users_full_name_trgm" ON "public"."users" USING "gin" ("full_name" "public"."gin_trgm_ops") WHERE (("full_name" IS NOT NULL) AND ("full_name" <> ''::"text"));



CREATE INDEX "idx_wallets_updated_at" ON "public"."wallets" USING "btree" ("updated_at");



CREATE UNIQUE INDEX "uq_expense_details_active_bill" ON "public"."expense_details" USING "btree" ("bill_no", "transaction_date", "total_amount") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "uq_master_policies_single_active" ON "public"."master_policies" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE OR REPLACE TRIGGER "trg_advance_details_refresh_analytics_snapshot" AFTER INSERT OR DELETE OR UPDATE ON "public"."advance_details" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refresh_claim_analytics_snapshot"();



CREATE OR REPLACE TRIGGER "trg_claims_analytics_snapshot_rollup" AFTER INSERT OR DELETE OR UPDATE ON "public"."claims_analytics_snapshot" FOR EACH ROW EXECUTE FUNCTION "public"."trg_rollup_claims_analytics_snapshot"();



CREATE OR REPLACE TRIGGER "trg_claims_refresh_analytics_snapshot" AFTER INSERT OR DELETE OR UPDATE ON "public"."claims" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refresh_claim_analytics_snapshot"();



CREATE OR REPLACE TRIGGER "trg_expense_details_refresh_analytics_snapshot" AFTER INSERT OR DELETE OR UPDATE ON "public"."expense_details" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refresh_claim_analytics_snapshot"();



CREATE OR REPLACE TRIGGER "trg_validate_advance_claim_detail" BEFORE INSERT OR UPDATE ON "public"."advance_details" FOR EACH ROW EXECUTE FUNCTION "public"."validate_claim_detail_consistency"();



CREATE OR REPLACE TRIGGER "trg_validate_expense_claim_detail" BEFORE INSERT OR UPDATE ON "public"."expense_details" FOR EACH ROW EXECUTE FUNCTION "public"."validate_claim_detail_consistency"();



CREATE OR REPLACE TRIGGER "trg_wallets_set_derived_fields" BEFORE INSERT OR UPDATE ON "public"."wallets" FOR EACH ROW EXECUTE FUNCTION "public"."wallets_set_derived_fields"();



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."advance_details"
    ADD CONSTRAINT "advance_details_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."advance_details"
    ADD CONSTRAINT "advance_details_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."master_locations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."advance_details"
    ADD CONSTRAINT "advance_details_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."master_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claim_audit_logs"
    ADD CONSTRAINT "claim_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."claim_audit_logs"
    ADD CONSTRAINT "claim_audit_logs_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."claim_audit_logs"
    ADD CONSTRAINT "claim_audit_logs_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id");



ALTER TABLE ONLY "public"."claims_analytics_daily_stats"
    ADD CONSTRAINT "claims_analytics_daily_stats_assigned_l2_approver_id_fkey" FOREIGN KEY ("assigned_l2_approver_id") REFERENCES "public"."master_finance_approvers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_daily_stats"
    ADD CONSTRAINT "claims_analytics_daily_stats_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."master_departments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_daily_stats"
    ADD CONSTRAINT "claims_analytics_daily_stats_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "public"."master_expense_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_daily_stats"
    ADD CONSTRAINT "claims_analytics_daily_stats_payment_mode_id_fkey" FOREIGN KEY ("payment_mode_id") REFERENCES "public"."master_payment_modes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_daily_stats"
    ADD CONSTRAINT "claims_analytics_daily_stats_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."master_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_snapshot"
    ADD CONSTRAINT "claims_analytics_snapshot_assigned_l2_approver_id_fkey" FOREIGN KEY ("assigned_l2_approver_id") REFERENCES "public"."master_finance_approvers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_snapshot"
    ADD CONSTRAINT "claims_analytics_snapshot_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claims_analytics_snapshot"
    ADD CONSTRAINT "claims_analytics_snapshot_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."master_departments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_snapshot"
    ADD CONSTRAINT "claims_analytics_snapshot_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "public"."master_expense_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_snapshot"
    ADD CONSTRAINT "claims_analytics_snapshot_payment_mode_id_fkey" FOREIGN KEY ("payment_mode_id") REFERENCES "public"."master_payment_modes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims_analytics_snapshot"
    ADD CONSTRAINT "claims_analytics_snapshot_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."master_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_assigned_l1_approver_id_fkey" FOREIGN KEY ("assigned_l1_approver_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_assigned_l2_approver_id_fkey" FOREIGN KEY ("assigned_l2_approver_id") REFERENCES "public"."master_finance_approvers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."master_departments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_on_behalf_of_id_fkey" FOREIGN KEY ("on_behalf_of_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_payment_mode_id_fkey" FOREIGN KEY ("payment_mode_id") REFERENCES "public"."master_payment_modes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."department_viewers"
    ADD CONSTRAINT "department_viewers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."master_departments"("id");



ALTER TABLE ONLY "public"."department_viewers"
    ADD CONSTRAINT "department_viewers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."expense_details"
    ADD CONSTRAINT "expense_details_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expense_details"
    ADD CONSTRAINT "expense_details_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "public"."master_expense_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expense_details"
    ADD CONSTRAINT "expense_details_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."master_locations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expense_details"
    ADD CONSTRAINT "expense_details_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."master_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."master_departments"
    ADD CONSTRAINT "master_departments_founder_user_id_fkey" FOREIGN KEY ("founder_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."master_departments"
    ADD CONSTRAINT "master_departments_hod_user_id_fkey" FOREIGN KEY ("hod_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."master_finance_approvers"
    ADD CONSTRAINT "master_finance_approvers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_policy_acceptances"
    ADD CONSTRAINT "user_policy_acceptances_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."master_policies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_policy_acceptances"
    ADD CONSTRAINT "user_policy_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."admins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admins can insert policies" ON "public"."master_policies" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "admins can update policies" ON "public"."master_policies" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "admins_delete_admin" ON "public"."admins" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "admins_insert_admin" ON "public"."admins" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "admins_select_own_row" ON "public"."admins" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."advance_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "advance_details_select_admin" ON "public"."advance_details" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."allowed_auth_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated users can read active domains" ON "public"."allowed_auth_domains" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "authenticated users can read active expense categories" ON "public"."master_expense_categories" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "authenticated users can read active locations" ON "public"."master_locations" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "authenticated users can read active payment modes" ON "public"."master_payment_modes" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "authenticated users can read active policy" ON "public"."master_policies" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "authenticated users can read active products" ON "public"."master_products" FOR SELECT TO "authenticated" USING (("is_active" = true));



ALTER TABLE "public"."claim_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "claim_audit_logs_insert_admin" ON "public"."claim_audit_logs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "claim_audit_logs_select_admin" ON "public"."claim_audit_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "claim_audit_logs_select_involved_users" ON "public"."claim_audit_logs" FOR SELECT TO "authenticated" USING ((("actor_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("assigned_to_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."claims" "c"
  WHERE (("c"."id" = "claim_audit_logs"."claim_id") AND (("c"."submitted_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("c"."on_behalf_of_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("c"."assigned_l1_approver_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("c"."assigned_l2_approver_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claims_analytics_daily_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claims_analytics_snapshot" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "claims_select_admin" ON "public"."claims" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "claims_update_admin" ON "public"."claims" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."department_viewers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "department_viewers_can_read_department_claims" ON "public"."claims" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."department_viewers" "dv"
  WHERE (("dv"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("dv"."department_id" = "claims"."department_id") AND ("dv"."is_active" = true)))));



CREATE POLICY "department_viewers_select_own" ON "public"."department_viewers" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."expense_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expense_details_select_admin" ON "public"."expense_details" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "finance can insert wallets" ON "public"."wallets" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."master_finance_approvers" "mfa"
  WHERE (("mfa"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("mfa"."is_active" = true)))));



CREATE POLICY "finance can update wallets" ON "public"."wallets" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."master_finance_approvers" "mfa"
  WHERE (("mfa"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("mfa"."is_active" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."master_finance_approvers" "mfa"
  WHERE (("mfa"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("mfa"."is_active" = true)))));



ALTER TABLE "public"."master_departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_departments_insert_admin" ON "public"."master_departments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "master_departments_select_authenticated" ON "public"."master_departments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "master_departments_update_admin" ON "public"."master_departments" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."master_expense_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_expense_categories_insert_admin" ON "public"."master_expense_categories" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "master_expense_categories_update_admin" ON "public"."master_expense_categories" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."master_finance_approvers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_finance_approvers_delete_admin" ON "public"."master_finance_approvers" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "master_finance_approvers_insert_admin" ON "public"."master_finance_approvers" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "master_finance_approvers_select_authenticated" ON "public"."master_finance_approvers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "master_finance_approvers_update_admin" ON "public"."master_finance_approvers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."master_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_locations_insert_admin" ON "public"."master_locations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "master_locations_update_admin" ON "public"."master_locations" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."master_payment_modes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_payment_modes_insert_admin" ON "public"."master_payment_modes" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "master_payment_modes_update_admin" ON "public"."master_payment_modes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."master_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."master_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_products_insert_admin" ON "public"."master_products" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "master_products_update_admin" ON "public"."master_products" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "submitters and approvers can read advance details" ON "public"."advance_details" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."claims" "c"
  WHERE (("c"."id" = "advance_details"."claim_id") AND ((( SELECT "auth"."uid"() AS "uid") = "c"."submitted_by") OR (( SELECT "auth"."uid"() AS "uid") = "c"."on_behalf_of_id") OR (( SELECT "auth"."uid"() AS "uid") = "c"."assigned_l1_approver_id") OR (EXISTS ( SELECT 1
           FROM "public"."master_finance_approvers" "mfa"
          WHERE (("mfa"."id" = "c"."assigned_l2_approver_id") AND ("mfa"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("mfa"."is_active" = true)))))))));



CREATE POLICY "submitters and approvers can read claims" ON "public"."claims" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "submitted_by") OR (( SELECT "auth"."uid"() AS "uid") = "on_behalf_of_id") OR (( SELECT "auth"."uid"() AS "uid") = "assigned_l1_approver_id") OR (EXISTS ( SELECT 1
   FROM "public"."master_finance_approvers" "mfa"
  WHERE (("mfa"."id" = "claims"."assigned_l2_approver_id") AND ("mfa"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("mfa"."is_active" = true))))));



CREATE POLICY "submitters and approvers can read expense details" ON "public"."expense_details" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."claims" "c"
  WHERE (("c"."id" = "expense_details"."claim_id") AND ((( SELECT "auth"."uid"() AS "uid") = "c"."submitted_by") OR (( SELECT "auth"."uid"() AS "uid") = "c"."on_behalf_of_id") OR (( SELECT "auth"."uid"() AS "uid") = "c"."assigned_l1_approver_id") OR (EXISTS ( SELECT 1
           FROM "public"."master_finance_approvers" "mfa"
          WHERE (("mfa"."id" = "c"."assigned_l2_approver_id") AND ("mfa"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("mfa"."is_active" = true)))))))));



CREATE POLICY "submitters can create claims" ON "public"."claims" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "submitted_by"));



ALTER TABLE "public"."user_policy_acceptances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users can insert own policy acceptances" ON "public"."user_policy_acceptances" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "users can read own policy acceptances" ON "public"."user_policy_acceptances" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "users can read own profile" ON "public"."users" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "users can read own wallet" ON "public"."wallets" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "users can update own profile" ON "public"."users" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "users_select_admin" ON "public"."users" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "users_update_admin" ON "public"."users" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."wallets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallets_select_admin" ON "public"."wallets" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admins" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";





























































































































































































GRANT ALL ON FUNCTION "public"."apply_claims_analytics_delta"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid", "p_claim_count_delta" integer, "p_total_amount_delta" numeric, "p_hod_approval_hours_delta" numeric, "p_hod_approval_sample_delta" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."apply_claims_analytics_delta"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid", "p_claim_count_delta" integer, "p_total_amount_delta" numeric, "p_hod_approval_hours_delta" numeric, "p_hod_approval_sample_delta" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_claims_analytics_delta"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid", "p_claim_count_delta" integer, "p_total_amount_delta" numeric, "p_hod_approval_hours_delta" numeric, "p_hod_approval_sample_delta" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_process_claims"("p_action" "text", "p_actor_id" "uuid", "p_claim_ids" "text"[], "p_reason" "text", "p_allow_resubmission" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_process_claims"("p_action" "text", "p_actor_id" "uuid", "p_claim_ids" "text"[], "p_reason" "text", "p_allow_resubmission" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_process_claims"("p_action" "text", "p_actor_id" "uuid", "p_claim_ids" "text"[], "p_reason" "text", "p_allow_resubmission" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_claim_with_detail"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_claim_with_detail"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_claim_with_detail"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_analytics_payload"("p_scope" "text", "p_hod_department_ids" "uuid"[], "p_finance_approver_ids" "uuid"[], "p_date_from" "date", "p_date_to" "date", "p_department_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_finance_approver_id" "uuid", "p_finance_pipeline_statuses" "public"."claim_status"[], "p_approved_statuses" "public"."claim_status"[], "p_pending_statuses" "public"."claim_status"[], "p_rejected_statuses" "public"."claim_status"[], "p_hod_pending_status" "public"."claim_status") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_analytics_payload"("p_scope" "text", "p_hod_department_ids" "uuid"[], "p_finance_approver_ids" "uuid"[], "p_date_from" "date", "p_date_to" "date", "p_department_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_finance_approver_id" "uuid", "p_finance_pipeline_statuses" "public"."claim_status"[], "p_approved_statuses" "public"."claim_status"[], "p_pending_statuses" "public"."claim_status"[], "p_rejected_statuses" "public"."claim_status"[], "p_hod_pending_status" "public"."claim_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_analytics_payload"("p_scope" "text", "p_hod_department_ids" "uuid"[], "p_finance_approver_ids" "uuid"[], "p_date_from" "date", "p_date_to" "date", "p_department_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_finance_approver_id" "uuid", "p_finance_pipeline_statuses" "public"."claim_status"[], "p_approved_statuses" "public"."claim_status"[], "p_pending_statuses" "public"."claim_status"[], "p_rejected_statuses" "public"."claim_status"[], "p_hod_pending_status" "public"."claim_status") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."make_claims_analytics_bucket_key"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."make_claims_analytics_bucket_key"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."make_claims_analytics_bucket_key"("p_date_key" "date", "p_status" "public"."claim_status", "p_department_id" "uuid", "p_payment_mode_id" "uuid", "p_expense_category_id" "uuid", "p_product_id" "uuid", "p_assigned_l2_approver_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_l2_mark_paid_transition"("p_claim_id" "text", "p_actor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."process_l2_mark_paid_transition"("p_claim_id" "text", "p_actor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_l2_mark_paid_transition"("p_claim_id" "text", "p_actor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rebuild_claims_analytics_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."rebuild_claims_analytics_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rebuild_claims_analytics_cache"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_claim_analytics_snapshot"("p_claim_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_claim_analytics_snapshot"("p_claim_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_claim_analytics_snapshot"("p_claim_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_refresh_claim_analytics_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_refresh_claim_analytics_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_refresh_claim_analytics_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_rollup_claims_analytics_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_rollup_claims_analytics_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_rollup_claims_analytics_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_claim_by_finance"("p_claim_id" "text", "p_actor_id" "uuid", "p_edit_reason" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_claim_detail_consistency"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_claim_detail_consistency"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_claim_detail_consistency"() TO "service_role";



GRANT ALL ON FUNCTION "public"."wallets_set_derived_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."wallets_set_derived_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."wallets_set_derived_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";
























GRANT ALL ON TABLE "public"."_migration_history" TO "anon";
GRANT ALL ON TABLE "public"."_migration_history" TO "authenticated";
GRANT ALL ON TABLE "public"."_migration_history" TO "service_role";



GRANT ALL ON TABLE "public"."admins" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."admins" TO "authenticated";



GRANT ALL ON TABLE "public"."advance_details" TO "anon";
GRANT ALL ON TABLE "public"."advance_details" TO "authenticated";
GRANT ALL ON TABLE "public"."advance_details" TO "service_role";



GRANT ALL ON TABLE "public"."allowed_auth_domains" TO "anon";
GRANT ALL ON TABLE "public"."allowed_auth_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."allowed_auth_domains" TO "service_role";



GRANT ALL ON TABLE "public"."claim_audit_logs" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."claim_audit_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."claims" TO "anon";
GRANT ALL ON TABLE "public"."claims" TO "authenticated";
GRANT ALL ON TABLE "public"."claims" TO "service_role";



GRANT ALL ON TABLE "public"."claims_analytics_daily_stats" TO "anon";
GRANT ALL ON TABLE "public"."claims_analytics_daily_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."claims_analytics_daily_stats" TO "service_role";



GRANT ALL ON TABLE "public"."claims_analytics_snapshot" TO "anon";
GRANT ALL ON TABLE "public"."claims_analytics_snapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."claims_analytics_snapshot" TO "service_role";



GRANT ALL ON TABLE "public"."department_viewers" TO "anon";
GRANT ALL ON TABLE "public"."department_viewers" TO "authenticated";
GRANT ALL ON TABLE "public"."department_viewers" TO "service_role";



GRANT ALL ON TABLE "public"."expense_details" TO "anon";
GRANT ALL ON TABLE "public"."expense_details" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_details" TO "service_role";



GRANT ALL ON TABLE "public"."master_departments" TO "anon";
GRANT ALL ON TABLE "public"."master_departments" TO "authenticated";
GRANT ALL ON TABLE "public"."master_departments" TO "service_role";



GRANT ALL ON TABLE "public"."master_expense_categories" TO "anon";
GRANT ALL ON TABLE "public"."master_expense_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."master_expense_categories" TO "service_role";



GRANT ALL ON TABLE "public"."master_finance_approvers" TO "anon";
GRANT ALL ON TABLE "public"."master_finance_approvers" TO "authenticated";
GRANT ALL ON TABLE "public"."master_finance_approvers" TO "service_role";



GRANT ALL ON TABLE "public"."master_locations" TO "anon";
GRANT ALL ON TABLE "public"."master_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."master_locations" TO "service_role";



GRANT ALL ON TABLE "public"."master_payment_modes" TO "anon";
GRANT ALL ON TABLE "public"."master_payment_modes" TO "authenticated";
GRANT ALL ON TABLE "public"."master_payment_modes" TO "service_role";



GRANT ALL ON TABLE "public"."master_policies" TO "anon";
GRANT ALL ON TABLE "public"."master_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."master_policies" TO "service_role";



GRANT ALL ON TABLE "public"."master_products" TO "anon";
GRANT ALL ON TABLE "public"."master_products" TO "authenticated";
GRANT ALL ON TABLE "public"."master_products" TO "service_role";



GRANT ALL ON TABLE "public"."user_policy_acceptances" TO "anon";
GRANT ALL ON TABLE "public"."user_policy_acceptances" TO "authenticated";
GRANT ALL ON TABLE "public"."user_policy_acceptances" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_claims_dashboard" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_claims_dashboard" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_claims_dashboard" TO "service_role";



GRANT ALL ON TABLE "public"."vw_enterprise_claims_dashboard" TO "anon";
GRANT ALL ON TABLE "public"."vw_enterprise_claims_dashboard" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_enterprise_claims_dashboard" TO "service_role";



GRANT ALL ON TABLE "public"."wallets" TO "anon";
GRANT ALL ON TABLE "public"."wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."wallets" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

revoke delete on table "public"."admins" from "anon";

revoke insert on table "public"."admins" from "anon";

revoke references on table "public"."admins" from "anon";

revoke select on table "public"."admins" from "anon";

revoke trigger on table "public"."admins" from "anon";

revoke truncate on table "public"."admins" from "anon";

revoke update on table "public"."admins" from "anon";

revoke references on table "public"."admins" from "authenticated";

revoke trigger on table "public"."admins" from "authenticated";

revoke truncate on table "public"."admins" from "authenticated";

revoke update on table "public"."admins" from "authenticated";

revoke delete on table "public"."claim_audit_logs" from "anon";

revoke insert on table "public"."claim_audit_logs" from "anon";

revoke references on table "public"."claim_audit_logs" from "anon";

revoke select on table "public"."claim_audit_logs" from "anon";

revoke trigger on table "public"."claim_audit_logs" from "anon";

revoke truncate on table "public"."claim_audit_logs" from "anon";

revoke update on table "public"."claim_audit_logs" from "anon";

revoke delete on table "public"."claim_audit_logs" from "authenticated";

revoke references on table "public"."claim_audit_logs" from "authenticated";

revoke trigger on table "public"."claim_audit_logs" from "authenticated";

revoke truncate on table "public"."claim_audit_logs" from "authenticated";

revoke update on table "public"."claim_audit_logs" from "authenticated";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "admins can update policy files"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'policies'::text) AND (EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid))))))
with check (((bucket_id = 'policies'::text) AND (EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid))))));



  create policy "admins can upload policy files"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'policies'::text) AND (EXISTS ( SELECT 1
   FROM public.admins a
  WHERE (a.user_id = ( SELECT auth.uid() AS uid))))));



  create policy "authenticated users can read claim files"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'claims'::text));



  create policy "authenticated users can read policy files"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'policies'::text));



  create policy "authenticated users can upload own claim files"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'claims'::text) AND (split_part(name, '/'::text, 1) = ANY (ARRAY['expenses'::text, 'petty_cash_requests'::text])) AND (split_part(name, '/'::text, 2) = (( SELECT auth.uid() AS uid))::text) AND (split_part(name, '/'::text, 3) <> ''::text)));



