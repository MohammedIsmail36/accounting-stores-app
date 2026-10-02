-- ISOLATED ONLY: restores insecure historical definitions for proof of rollback.
-- Never use this on hosted Staging or production; live fallback must stay guarded.
DO $rollback$
DECLARE r record; oid_public oid; oid_private oid;
BEGIN
 IF current_database()<>'l3_public_restore' OR current_user<>'postgres'
  OR current_setting('accounting.ledger_statement_access_rollback',true) IS DISTINCT FROM 'ISOLATED_20260928120000' THEN
  RAISE EXCEPTION 'LEDGER_STATEMENT_ROLLBACK_NOT_AUTHORIZED';
 END IF;
 FOR r IN SELECT * FROM (VALUES ('get_ledger_active_accounts',''),('get_ledger_lines','uuid,date,date,integer,integer'),('get_account_statement','text,uuid,date,date,integer,integer')) v(name,args) LOOP
  oid_public:=to_regprocedure(format('public.%I(%s)',r.name,r.args));
  oid_private:=to_regprocedure(format('public.%I(%s)',r.name||'_access_internal',r.args));
  IF oid_public IS NULL OR oid_private IS NULL
   OR obj_description(oid_public,'pg_proc') IS DISTINCT FROM 'SYSTEM:LEDGER_STATEMENT_ACCESS_GUARD:20260928120000' THEN
   RAISE EXCEPTION 'LEDGER_STATEMENT_ROLLBACK_IDENTITY_CONFLICT';
  END IF;
 END LOOP;
 DROP FUNCTION public.get_ledger_active_accounts();
 DROP FUNCTION public.get_ledger_lines(uuid,date,date,integer,integer);
 DROP FUNCTION public.get_account_statement(text,uuid,date,date,integer,integer);
 ALTER FUNCTION public.get_ledger_active_accounts_access_internal() RENAME TO get_ledger_active_accounts;
 ALTER FUNCTION public.get_ledger_lines_access_internal(uuid,date,date,integer,integer) RENAME TO get_ledger_lines;
 ALTER FUNCTION public.get_account_statement_access_internal(text,uuid,date,date,integer,integer) RENAME TO get_account_statement;
 GRANT EXECUTE ON FUNCTION public.get_ledger_active_accounts(),public.get_ledger_lines(uuid,date,date,integer,integer),
  public.get_account_statement(text,uuid,date,date,integer,integer) TO authenticated,service_role;
END;$rollback$;
