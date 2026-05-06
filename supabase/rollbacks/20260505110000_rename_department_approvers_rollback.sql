BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'master_departments'
      AND column_name = 'approver1_id'
  ) THEN
    ALTER TABLE public.master_departments RENAME COLUMN approver1_id TO hod_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'master_departments'
      AND column_name = 'approver2_id'
  ) THEN
    ALTER TABLE public.master_departments RENAME COLUMN approver2_id TO founder_user_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'master_departments'
      AND column_name = 'approver1_provisional_email'
  ) THEN
    ALTER TABLE public.master_departments RENAME COLUMN approver1_provisional_email TO hod_provisional_email;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'master_departments'
      AND column_name = 'approver2_provisional_email'
  ) THEN
    ALTER TABLE public.master_departments RENAME COLUMN approver2_provisional_email TO founder_provisional_email;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dept_approver1_user_or_email_required'
      AND conrelid = 'public.master_departments'::regclass
  ) THEN
    ALTER TABLE public.master_departments
      RENAME CONSTRAINT dept_approver1_user_or_email_required TO dept_hod_user_or_email_required;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dept_approver2_user_or_email_required'
      AND conrelid = 'public.master_departments'::regclass
  ) THEN
    ALTER TABLE public.master_departments
      RENAME CONSTRAINT dept_approver2_user_or_email_required TO dept_founder_user_or_email_required;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_departments_approver1_id_fkey'
      AND conrelid = 'public.master_departments'::regclass
  ) THEN
    ALTER TABLE public.master_departments
      RENAME CONSTRAINT master_departments_approver1_id_fkey TO master_departments_hod_user_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_departments_approver2_id_fkey'
      AND conrelid = 'public.master_departments'::regclass
  ) THEN
    ALTER TABLE public.master_departments
      RENAME CONSTRAINT master_departments_approver2_id_fkey TO master_departments_founder_user_id_fkey;
  END IF;
END;
$$;

ALTER INDEX IF EXISTS public.idx_master_departments_approver1_id
  RENAME TO idx_master_departments_hod_user_id;

ALTER INDEX IF EXISTS public.idx_master_departments_approver2_id
  RENAME TO idx_master_departments_founder_user_id;

ALTER INDEX IF EXISTS public.idx_master_departments_approver1_provisional_email
  RENAME TO idx_master_departments_hod_provisional_email;

ALTER INDEX IF EXISTS public.idx_master_departments_approver2_provisional_email
  RENAME TO idx_master_departments_founder_provisional_email;

COMMENT ON TABLE public.master_departments IS
  'Department master mapping for dynamic L1 routing. HOD and founder may be same for specific departments based on source master data.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_full_name text;
BEGIN
  IF new.email IS NULL THEN
    RETURN new;
  END IF;

  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(split_part(new.email, '@', 1)), '')
  );

  INSERT INTO public.users (
    id,
    email,
    full_name
  )
  VALUES (
    new.id,
    new.email,
    v_full_name
  )
  ON CONFLICT (id) DO UPDATE
    SET email = excluded.email,
        full_name = coalesce(nullif(trim(excluded.full_name), ''), public.users.full_name),
        updated_at = now();

  INSERT INTO public.wallets (
    user_id
  )
  VALUES (
    new.id
  )
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.master_finance_approvers mfa
  SET user_id = new.id,
      provisional_email = null,
      updated_at = now()
  WHERE mfa.user_id IS NULL
    AND mfa.provisional_email IS NOT NULL
    AND lower(mfa.provisional_email) = lower(new.email)
    AND NOT EXISTS (
      SELECT 1
      FROM public.master_finance_approvers mfa_existing
      WHERE mfa_existing.user_id = new.id
        AND mfa_existing.id <> mfa.id
    );

  UPDATE public.master_departments md
  SET hod_user_id = new.id,
      hod_provisional_email = null,
      updated_at = now()
  WHERE md.hod_user_id IS NULL
    AND md.hod_provisional_email IS NOT NULL
    AND lower(md.hod_provisional_email) = lower(new.email);

  UPDATE public.master_departments md
  SET founder_user_id = new.id,
      founder_provisional_email = null,
      updated_at = now()
  WHERE md.founder_user_id IS NULL
    AND md.founder_provisional_email IS NOT NULL
    AND lower(md.founder_provisional_email) = lower(new.email);

  UPDATE public.admins a
  SET user_id = new.id,
      provisional_email = null,
      updated_at = now()
  WHERE a.user_id IS NULL
    AND a.provisional_email IS NOT NULL
    AND lower(a.provisional_email) = lower(new.email)
    AND NOT EXISTS (
      SELECT 1
      FROM public.admins a_existing
      WHERE a_existing.user_id = new.id
        AND a_existing.id <> a.id
    );

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cascade_user_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF new.is_active = false AND old.is_active = true THEN
    DELETE FROM public.admins
    WHERE user_id = new.id;

    UPDATE public.master_finance_approvers
    SET is_active = false,
        updated_at = now()
    WHERE user_id = new.id
      AND is_active = true;

    UPDATE public.department_viewers
    SET is_active = false,
        updated_at = now()
    WHERE user_id = new.id
      AND is_active = true;

    UPDATE public.master_departments
    SET hod_provisional_email = lower(new.email),
        hod_user_id = null,
        updated_at = now()
    WHERE hod_user_id = new.id;

    UPDATE public.master_departments
    SET founder_provisional_email = lower(new.email),
        founder_user_id = null,
        updated_at = now()
    WHERE founder_user_id = new.id;
  END IF;

  RETURN new;
END;
$$;

COMMIT;