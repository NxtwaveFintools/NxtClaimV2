-- Update founder account password hash using pgcrypto bcrypt.
DO $$
DECLARE
	v_rows_updated integer := 0;
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_extension
		WHERE extname = 'pgcrypto'
	) THEN
		RAISE EXCEPTION 'pgcrypto extension is required but not installed';
	END IF;

	UPDATE auth.users
	SET
		encrypted_password = extensions.crypt('Nxtwave@2026', extensions.gen_salt('bf')),
		updated_at = now()
	WHERE lower(email) = lower('founder@nxtwave.co.in');

	GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

	IF v_rows_updated <> 1 THEN
		RAISE EXCEPTION 'Expected to update exactly one founder account, updated % rows', v_rows_updated;
	END IF;
END
$$;
