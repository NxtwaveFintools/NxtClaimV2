-- Add HOD_REASSIGNED to the claim_audit_logs action_type allowlist.
-- Required so the HOD replacement trigger can write audit rows.

ALTER TABLE claim_audit_logs
    DROP CONSTRAINT claim_audit_logs_action_type_check;

ALTER TABLE claim_audit_logs
    ADD CONSTRAINT claim_audit_logs_action_type_check
    CHECK (action_type = ANY (ARRAY[
        'SUBMITTED',
        'UPDATED',
        'L1_APPROVED',
        'L1_REJECTED',
        'L2_APPROVED',
        'L2_REJECTED',
        'L2_MARK_PAID',
        'FINANCE_EDITED',
        'ADMIN_SOFT_DELETED',
        'ADMIN_PAYMENT_MODE_OVERRIDDEN',
        'BC_SUBMITTED',
        'BC_SUBMISSION_FAILED',
        'AI_VERIFICATION_COMPLETED',
        'AI_VERIFICATION_OVERRIDDEN',
        'AI_VERIFICATION_RERUN',
        'HOD_REASSIGNED'
    ]));
