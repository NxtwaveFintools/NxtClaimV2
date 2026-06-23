-- Migration: auto-transfer pending L1 claims when a department's HOD is replaced.
--
-- How it works:
--   When `master_departments.approver1_id` is changed (e.g. via the Admin UI),
--   a BEFORE-UPDATE trigger fires and moves every claim in that department whose
--   status is 'Submitted - Awaiting HOD approval' and assigned_l1_approver_id =
--   OLD.approver1_id → NEW.approver1_id, then writes one audit-log row per claim.
--
-- Reversible: yes — swapping the HOD back moves the claims back because the same
--   trigger fires on every approver1_id change.

-- ── 1. Transfer function ───────────────────────────────────────────────────────
-- SECURITY DEFINER so the trigger can UPDATE claims and INSERT audit logs even
-- when the calling session (e.g. an admin via the REST API) lacks direct DML
-- rights on those tables due to RLS policies.
CREATE OR REPLACE FUNCTION transfer_pending_hod_claims(
    p_dept_id    uuid,
    p_old_hod_id uuid,
    p_new_hod_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_transferred bigint := 0;
BEGIN
    -- Skip when HODs are the same, or either side is null
    IF p_old_hod_id IS NULL
       OR p_new_hod_id IS NULL
       OR p_old_hod_id = p_new_hod_id
    THEN
        RETURN jsonb_build_object(
            'transferred', 0,
            'skipped',     true,
            'reason',      'old and new HOD are identical or null'
        );
    END IF;

    WITH updated AS (
        UPDATE claims
        SET    assigned_l1_approver_id = p_new_hod_id,
               updated_at              = now()
        WHERE  department_id           = p_dept_id
          AND  assigned_l1_approver_id = p_old_hod_id
          AND  status                  = 'Submitted - Awaiting HOD approval'
        RETURNING id
    ),
    logged AS (
        INSERT INTO claim_audit_logs (claim_id, actor_id, action_type, assigned_to_id, remarks)
        SELECT
            u.id,
            p_new_hod_id,
            'HOD_REASSIGNED',
            p_new_hod_id,
            'Pending claims auto-transferred to new HOD on department approver change'
        FROM updated u
        RETURNING 1
    )
    SELECT count(*) INTO v_transferred FROM logged;

    RETURN jsonb_build_object(
        'dept_id',     p_dept_id,
        'old_hod_id',  p_old_hod_id,
        'new_hod_id',  p_new_hod_id,
        'transferred', v_transferred
    );
END;
$$;

-- Only backend / service-role may call this function directly
REVOKE EXECUTE ON FUNCTION transfer_pending_hod_claims(uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION transfer_pending_hod_claims(uuid, uuid, uuid) TO service_role;


-- ── 2. Trigger function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_transfer_claims_on_hod_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Fire only when approver1_id actually changes
    IF NEW.approver1_id IS DISTINCT FROM OLD.approver1_id THEN
        PERFORM transfer_pending_hod_claims(
            NEW.id,
            OLD.approver1_id,
            NEW.approver1_id
        );
    END IF;
    RETURN NEW;
END;
$$;

-- ── 3. Trigger on master_departments ──────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_hod_change_transfer_claims ON master_departments;

CREATE TRIGGER trg_hod_change_transfer_claims
    AFTER UPDATE OF approver1_id ON master_departments
    FOR EACH ROW
    EXECUTE FUNCTION trg_transfer_claims_on_hod_change();
