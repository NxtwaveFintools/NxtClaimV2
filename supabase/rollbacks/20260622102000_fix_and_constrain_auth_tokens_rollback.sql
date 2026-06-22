-- Drop the guard trigger and its function added by the forward migration.
-- NOTE: The UPDATE that patched NULL tokens to '' is not reversible —
-- we cannot know which rows originally had NULL without a prior backup.
DROP TRIGGER IF EXISTS enforce_auth_tokens_not_null ON auth.users;
DROP FUNCTION IF EXISTS public.block_null_auth_token_insert();
