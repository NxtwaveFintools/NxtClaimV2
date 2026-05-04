-- Revoke ABAC assignments when a user is deactivated in public.users.

CREATE OR REPLACE FUNCTION public.fn_cascade_user_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_active = false AND OLD.is_active = true THEN
    DELETE FROM public.admins
    WHERE user_id = NEW.id;

    UPDATE public.master_finance_approvers
    SET
      is_active = false,
      updated_at = now()
    WHERE user_id = NEW.id
      AND is_active = true;

    UPDATE public.department_viewers
    SET
      is_active = false,
      updated_at = now()
    WHERE user_id = NEW.id
      AND is_active = true;

    UPDATE public.master_departments
    SET
      hod_provisional_email = lower(NEW.email),
      hod_user_id = null,
      updated_at = now()
    WHERE hod_user_id = NEW.id;

    UPDATE public.master_departments
    SET
      founder_provisional_email = lower(NEW.email),
      founder_user_id = null,
      updated_at = now()
    WHERE founder_user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_cascade_user_deactivation() OWNER TO postgres;

DROP TRIGGER IF EXISTS tr_cascade_user_deactivation ON public.users;

CREATE TRIGGER tr_cascade_user_deactivation
AFTER UPDATE OF is_active ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.fn_cascade_user_deactivation();