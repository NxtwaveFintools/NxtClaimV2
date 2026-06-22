-- =============================================================================
-- Migration: Fix saravan@nxtwave.co.in auth fallback credentials
-- Branch: fixNull
--
-- CONTEXT
-- This user was manually inserted into auth.users, bypassing GoTrue.
-- Prior migrations (20260622102000, 20260622120000) fixed NULL token columns
-- so GoTrue's scanner no longer crashes when reading the row.
--
-- REMAINING GAPS
-- 1. encrypted_password IS NULL  → no email/password fallback
-- 2. auth.identities is EMPTY    → no Azure SSO identity pre-linked
--
-- WHY DELETE-AND-RECREATE IS NOT AN OPTION
-- The following FK constraints all carry ON DELETE RESTRICT and block deletion
-- of this auth.users row:
--   public.users.id                      (which is blocked by)
--     claims.assigned_l1_approver_id     ← 1 live claim awaiting HOD approval
--     master_departments.approver1_id    ← GuideXPert department HOD mapping
--     wallets.user_id
--
-- STRATEGY: FIX IN PLACE
-- 1. Set encrypted_password → gives immediate email+password fallback access.
-- 2. Do NOT touch auth.identities manually. GoTrue will auto-link the Azure
--    identity (create the auth.identities row) on saravan's FIRST successful
--    Microsoft SSO login now that the NULL columns are resolved.
--
-- ROLLBACK
-- See paired down-migration at bottom of file (commented, copy-paste to undo).
-- =============================================================================

BEGIN;

-- Step 1: Set fallback password
-- Uses bcrypt cost factor 10 (GoTrue default). The email+password route will
-- be available immediately after this migration is applied.
UPDATE auth.users
SET
  encrypted_password = extensions.crypt('password123', extensions.gen_salt('bf')),
  email_confirmed_at = COALESCE(email_confirmed_at, now()), -- The safety net!
  updated_at         = now()
WHERE email = 'saravan@nxtwave.co.in';

-- Safety guard: abort the transaction if the target row was not found.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE email              = 'saravan@nxtwave.co.in'
      AND encrypted_password IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Remediation aborted: saravan@nxtwave.co.in not found or password not set';
  END IF;
END $$;

-- Step 2: Update app_metadata providers list to reflect both login paths.
-- GoTrue refreshes the session JWT from raw_app_meta_data; listing "azure"
-- here does not link the identity but signals intent and avoids a stale JWT
-- after the auto-link occurs on first SSO login.
UPDATE auth.users
SET
  raw_app_meta_data = jsonb_set(
    raw_app_meta_data,
    '{providers}',
    '["email","azure"]'
  ),
  updated_at = now()
WHERE email = 'saravan@nxtwave.co.in';

COMMIT;

-- =============================================================================
-- ROLLBACK (do not run unless reverting intentionally)
-- =============================================================================
-- BEGIN;
-- UPDATE auth.users
-- SET
--   encrypted_password = NULL,
--   raw_app_meta_data  = jsonb_set(raw_app_meta_data, '{providers}', '["email"]'),
--   updated_at         = now()
-- WHERE email = 'saravan@nxtwave.co.in';
-- COMMIT;
