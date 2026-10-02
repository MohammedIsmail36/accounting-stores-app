-- Isolated rehearsal only. This restores an insecure historical definition;
-- a live rollback requires a separately reviewed maintenance/capture procedure.
DO $rollback$
BEGIN
  IF current_database()<>'l3_public_restore' OR current_user<>'postgres'
    OR current_setting('accounting.balance_access_rollback',true) IS DISTINCT FROM 'ISOLATED_20260928100000'
    OR obj_description('public.get_account_balances(date,date,boolean)'::regprocedure,'pg_proc')
       IS DISTINCT FROM 'SYSTEM:FINANCE_BALANCES_GUARD:20260928100000'
    OR to_regprocedure('public.get_account_balances_finance_internal(date,date,boolean)') IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_BALANCE_FINANCE_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  DROP FUNCTION public.get_account_balances(date,date,boolean);
  ALTER FUNCTION public.get_account_balances_finance_internal(date,date,boolean)
    RENAME TO get_account_balances;
  GRANT EXECUTE ON FUNCTION public.get_account_balances(date,date,boolean)
    TO authenticated,service_role;
END;
$rollback$;
