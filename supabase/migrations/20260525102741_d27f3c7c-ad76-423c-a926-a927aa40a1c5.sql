
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.fn_check_period_lock() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.fn_audit_trigger() FROM anon, authenticated, public;
