-- Patch remaining NULL string columns on manually-inserted auth.users rows.
-- GoTrue's Go scanner cannot Scan NULL into a string field, causing SSO login
-- crashes. Targets only the four columns confirmed NULL after the prior patch.
UPDATE auth.users
SET
  email_change           = COALESCE(email_change, ''),
  phone_change           = COALESCE(phone_change, ''),
  phone_change_token     = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, '')
WHERE
  email_change           IS NULL OR
  phone_change           IS NULL OR
  phone_change_token     IS NULL OR
  reauthentication_token IS NULL;
