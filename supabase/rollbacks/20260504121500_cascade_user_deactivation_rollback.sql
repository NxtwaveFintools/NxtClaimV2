DROP TRIGGER IF EXISTS tr_cascade_user_deactivation ON public.users;

DROP FUNCTION IF EXISTS public.fn_cascade_user_deactivation();