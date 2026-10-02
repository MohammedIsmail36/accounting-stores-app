-- One DO statement makes rename, wrapper and privileges atomic even with a CLI
-- that executes migration statements independently. No business arithmetic changes.
DO $migration$
DECLARE
  original_oid oid := to_regprocedure('public.get_account_balances(date,date,boolean)');
  internal_oid oid := to_regprocedure('public.get_account_balances_finance_internal(date,date,boolean)');
BEGIN
  IF current_user <> 'postgres'
     OR to_regprocedure('public.require_finance_api_access()') IS NULL
     OR original_oid IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_BALANCE_FINANCE_GUARD_BASELINE_MISMATCH';
  END IF;

  IF internal_oid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=original_oid
      AND prosecdef AND provolatile='s'
      AND prosrc LIKE '%PERFORM public.require_finance_api_access();%'
      AND prosrc LIKE '%RETURN public.get_account_balances_finance_internal(%')
      OR has_function_privilege('anon',original_oid,'EXECUTE')
      OR has_function_privilege('authenticated',internal_oid,'EXECUTE')
      OR has_function_privilege('anon',internal_oid,'EXECUTE')
      OR has_function_privilege('service_role',internal_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'ACCOUNT_BALANCE_FINANCE_GUARD_IDENTITY_CONFLICT';
    END IF;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid=original_oid AND r.rolname='postgres' AND p.prosecdef
      AND p.provolatile='s' AND p.prorettype='jsonb'::regtype AND p.pronargdefaults=3)
     OR has_function_privilege('anon',original_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'ACCOUNT_BALANCE_FINANCE_GUARD_BASELINE_MISMATCH';
  END IF;

  -- Bound SQL dependencies would retain the old function OID after rename.
  -- Refuse until they are reviewed, rather than leave a parallel unguarded path.
  IF EXISTS (SELECT 1 FROM pg_depend WHERE refclassid='pg_proc'::regclass AND refobjid=original_oid) THEN
    RAISE EXCEPTION 'ACCOUNT_BALANCE_FINANCE_GUARD_DEPENDENCY_REVIEW_REQUIRED';
  END IF;

  ALTER FUNCTION public.get_account_balances(date,date,boolean)
    RENAME TO get_account_balances_finance_internal;
  REVOKE ALL ON FUNCTION public.get_account_balances_finance_internal(date,date,boolean)
    FROM PUBLIC,anon,authenticated,service_role;

  EXECUTE $wrapper$
    CREATE FUNCTION public.get_account_balances(
      p_date_from date DEFAULT NULL,
      p_date_to date DEFAULT NULL,
      p_only_with_activity boolean DEFAULT false
    ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $body$
    BEGIN
      PERFORM public.require_finance_api_access();
      RETURN public.get_account_balances_finance_internal(
        p_date_from,p_date_to,p_only_with_activity
      );
    END;
    $body$;
  $wrapper$;

  REVOKE ALL ON FUNCTION public.get_account_balances(date,date,boolean) FROM PUBLIC,anon;
  GRANT EXECUTE ON FUNCTION public.get_account_balances(date,date,boolean)
    TO authenticated,service_role;
  COMMENT ON FUNCTION public.get_account_balances(date,date,boolean)
    IS 'SYSTEM:FINANCE_BALANCES_GUARD:20260928100000';
END;
$migration$;
