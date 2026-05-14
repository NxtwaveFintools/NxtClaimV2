BEGIN;

CREATE OR REPLACE FUNCTION public.complete_bc_payment(
  p_claim_id        TEXT,
  p_actor_user_id   UUID,
  p_is_vendor       BOOLEAN,
  p_vendor_id       TEXT,
  p_vendor_name     TEXT,
  p_audit_log_id    UUID,
  p_bc_response     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_finance_approver_id UUID;
BEGIN
  -- 0. Atomic authorization. The Edge Function pre-flight does this too,
  --    but we re-check here so the state transition cannot be bypassed.
  SELECT id INTO v_finance_approver_id
    FROM public.master_finance_approvers
   WHERE user_id = p_actor_user_id AND is_active = true
   LIMIT 1;

  IF v_finance_approver_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: actor % is not an active finance approver', p_actor_user_id;
  END IF;

  -- 1. Update claims with BC flags + the same fields the standard
  --    Finance-approve flow writes (assigned_l2_approver_id, finance_action_at).
  UPDATE public.claims
     SET status                  = 'Finance Approved - Payment under process'::public.claim_status,
         bc_payments_flag        = true,
         is_vendor_payment       = p_is_vendor,
         assigned_l2_approver_id = v_finance_approver_id,
         finance_action_at       = now(),
         updated_at              = now()
   WHERE id = p_claim_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND_OR_INACTIVE: %', p_claim_id;
  END IF;

  -- 2. Insert vendor row (NULLs for non-vendor — see migration
  --    20260513150000_fix_bc_claim_vendors_nullability.sql).
  INSERT INTO public.bc_claim_vendors (claim_id, bc_vendor_id, bc_vendor_name)
  VALUES (p_claim_id, p_vendor_id, p_vendor_name);

  -- 3. Mirror the application-level claim audit log entry that
  --    SupabaseClaimRepository.createClaimAuditLog produces today.
  INSERT INTO public.claim_audit_logs (claim_id, actor_id, action_type, assigned_to_id, remarks)
  VALUES (p_claim_id, p_actor_user_id, 'L2_APPROVED', NULL, NULL);

  -- 4. Finalize BC audit row.
  UPDATE public.bc_payment_audit_log
     SET status           = 'SUCCESS'::public.bc_payment_audit_status,
         bc_response_json = p_bc_response,
         resolved_at      = now()
   WHERE id = p_audit_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_LOG_ROW_NOT_FOUND: %', p_audit_log_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_bc_payment(
  TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB
) TO service_role;

COMMENT ON FUNCTION public.complete_bc_payment(TEXT, UUID, BOOLEAN, TEXT, TEXT, UUID, JSONB) IS
$comment$
Atomic post-BC-success transition for a claim.

Performs in one transaction:
  1. Auth gate: SELECT master_finance_approvers WHERE user_id = p_actor_user_id; raises UNAUTHORIZED if not active approver.
  2. UPDATE claims: status='Finance Approved - Payment under process', bc_payments_flag=true, is_vendor_payment=p_is_vendor, assigned_l2_approver_id=approver_id, finance_action_at=now(), updated_at=now(). Raises CLAIM_NOT_FOUND_OR_INACTIVE if no row affected.
  3. INSERT bc_claim_vendors(claim_id, bc_vendor_id, bc_vendor_name). Vendor fields are NULL when p_is_vendor=false.
  4. INSERT claim_audit_logs(claim_id, actor_id, action_type='L2_APPROVED', assigned_to_id=NULL, remarks=NULL). Mirrors the standard Finance-approve audit row.
  5. UPDATE bc_payment_audit_log SET status='SUCCESS', bc_response_json=p_bc_response, resolved_at=now() WHERE id=p_audit_log_id. Raises AUDIT_LOG_ROW_NOT_FOUND if no row matches.

p_actor_user_id is auth.uid() of the calling Finance Approver (NOT the finance_approver_id; the function does the lookup).
$comment$;

COMMIT;
