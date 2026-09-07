
-- Revoke anon EXECUTE on all SECURITY DEFINER functions in public schema.
-- Also revoke authenticated EXECUTE on admin-only helper functions that should only be called from edge functions using the service role.

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_account_statement(text, uuid, date, date, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_ledger_lines(uuid, date, date, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_account_balances(date, date, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_ledger_active_accounts() FROM anon;

-- Admin helpers were created outside the migration history in some legacy
-- environments and are absent in a clean bootstrap. Revoke them only when
-- they exist so a new environment can replay the full migration chain.
DO $$
BEGIN
  IF to_regprocedure('public.admin_insert_profile(uuid,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_insert_profile(uuid, text) FROM anon, authenticated, public';
  END IF;

  IF to_regprocedure('public.admin_insert_user_role(uuid,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_insert_user_role(uuid, text) FROM anon, authenticated, public';
  END IF;
END;
$$;
