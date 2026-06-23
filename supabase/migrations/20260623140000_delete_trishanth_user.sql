-- Delete all data for trishanthreddy.samanthula@nxtwave.co.in
-- Dry-run counts: 24 submitted claims, 13 on_behalf_of claims, 22 audit log actor rows,
--                 2 deleted_by refs (nulled, not deleted), 1 policy acceptance, 1 wallet

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = 'saravan@nxtwave.co.in';

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User not found, skipping.';
    RETURN;
  END IF;

  -- 1. Policy acceptances
  DELETE FROM public.user_policy_acceptances WHERE user_id = v_user_id;

  -- 2. Audit logs: rows where he was the actor, assigned_to, or on his claims
  DELETE FROM public.claim_audit_logs
  WHERE actor_id      = v_user_id
     OR assigned_to_id = v_user_id
     OR claim_id IN (
       SELECT id FROM public.claims
       WHERE submitted_by = v_user_id OR on_behalf_of_id = v_user_id
     );

  -- 3. Claim detail child rows for all his claims
  DELETE FROM public.advance_details
  WHERE claim_id IN (
    SELECT id FROM public.claims
    WHERE submitted_by = v_user_id OR on_behalf_of_id = v_user_id
  );

  DELETE FROM public.expense_details
  WHERE claim_id IN (
    SELECT id FROM public.claims
    WHERE submitted_by = v_user_id OR on_behalf_of_id = v_user_id
  );

  DELETE FROM public.bc_claim_details
  WHERE claim_id IN (
    SELECT id FROM public.claims
    WHERE submitted_by = v_user_id OR on_behalf_of_id = v_user_id
  );

  -- 4. NULL out deleted_by on other users' claims he happened to soft-delete (2 rows)
  UPDATE public.claims SET deleted_by = NULL WHERE deleted_by = v_user_id;

  -- 5. Delete all his claims (CASCADE handles claim_verification_runs + claims_analytics_snapshot)
  DELETE FROM public.claims
  WHERE submitted_by = v_user_id OR on_behalf_of_id = v_user_id;

  -- 6. Delete wallet
  DELETE FROM public.wallets WHERE user_id = v_user_id;

  -- 7. Delete public.users (CASCADE handles admins row if any)
  DELETE FROM public.users WHERE id = v_user_id;

  -- 8. Delete auth.users
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE 'Deleted user trishanthreddy.samanthula@nxtwave.co.in (%) and all associated data.', v_user_id;
END;
$$;
