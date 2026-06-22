-- Patch any existing auth.users rows where token columns were left NULL
-- by a manual insert that bypassed GoTrue. Must run before the trigger.
UPDATE auth.users
SET
  confirmation_token        = COALESCE(confirmation_token, ''),
  recovery_token            = COALESCE(recovery_token, ''),
  email_change_token_new    = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL;

-- Trigger function to block manual inserts into auth.users that omit
-- GoTrue-managed token columns. ALTER TABLE ADD CONSTRAINT is not allowed
-- on auth.users (GoTrue owns the table), so a trigger is used instead.
CREATE OR REPLACE FUNCTION public.block_null_auth_token_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmation_token IS NULL OR NEW.recovery_token IS NULL THEN
    RAISE EXCEPTION
      'Direct insert into auth.users rejected: token columns must not be NULL. '
      'Use the GoTrue API (supabase.auth.admin.createUser) instead of raw SQL.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_auth_tokens_not_null
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_null_auth_token_insert();
