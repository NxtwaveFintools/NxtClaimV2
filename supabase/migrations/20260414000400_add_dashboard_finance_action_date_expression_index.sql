-- Performance: make finance_action_date range filters sargable against the enterprise dashboard view.
create index concurrently if not exists idx_claims_dashboard_active_finance_action_date_expr
  on public.claims using btree ((
    coalesce(
      finance_action_at,
      case
        when status in (
          'Finance Approved - Payment under process'::public.claim_status,
          'Payment Done - Closed'::public.claim_status
        ) then updated_at
        when status in (
          'Rejected - Resubmission Not Allowed'::public.claim_status,
          'Rejected - Resubmission Allowed'::public.claim_status
        ) and assigned_l2_approver_id is not null then updated_at
        else null
      end
    )
  ))
  where is_active = true;

-- Rollback (manual):
-- drop index concurrently if exists public.idx_claims_dashboard_active_finance_action_date_expr;
