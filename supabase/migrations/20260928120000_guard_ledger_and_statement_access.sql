-- Atomic security-only wrappers. Original arithmetic, dates, pagination and
-- result shapes stay inside private implementations; no business rows change.
DO $migration$
DECLARE r record; original_oid oid; private_oid oid; present_count integer:=0;
BEGIN
 IF current_user<>'postgres' OR to_regprocedure('public.require_finance_api_access()') IS NULL THEN
  RAISE EXCEPTION 'LEDGER_STATEMENT_ACCESS_BASELINE_MISMATCH';
 END IF;
 FOR r IN SELECT * FROM (VALUES
  ('get_ledger_active_accounts','',0),
  ('get_ledger_lines','uuid,date,date,integer,integer',5),
  ('get_account_statement','text,uuid,date,date,integer,integer',4)
 ) v(name,args,defaults) LOOP
  original_oid:=to_regprocedure(format('public.%I(%s)',r.name,r.args));
  private_oid:=to_regprocedure(format('public.%I(%s)',r.name||'_access_internal',r.args));
  IF original_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles owner_role ON owner_role.oid=p.proowner
   WHERE p.oid=original_oid AND owner_role.rolname='postgres' AND p.prosecdef AND p.provolatile='s'
    AND p.prorettype='jsonb'::regtype AND p.pronargdefaults=r.defaults)
   OR has_function_privilege('anon',original_oid,'EXECUTE')
   OR NOT has_function_privilege('authenticated',original_oid,'EXECUTE')
   OR NOT has_function_privilege('service_role',original_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'LEDGER_STATEMENT_ACCESS_BASELINE_MISMATCH: %',r.name;
  END IF;
  IF private_oid IS NOT NULL THEN
   present_count:=present_count+1;
   IF obj_description(original_oid,'pg_proc') IS DISTINCT FROM 'SYSTEM:LEDGER_STATEMENT_ACCESS_GUARD:20260928120000'
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=original_oid AND prosrc LIKE '%RETURN public.'||r.name||'_access_internal(%'
      AND ((r.name<>'get_account_statement' AND prosrc LIKE '%PERFORM public.require_finance_api_access();%')
        OR (r.name='get_account_statement' AND prosrc LIKE '%CUSTOMER_STATEMENT_ACCESS_DENIED%'
          AND prosrc LIKE '%PERFORM public.require_finance_api_access();%'
          AND prosrc LIKE '%INVALID_STATEMENT_ENTITY_TYPE%')))
    OR has_function_privilege('anon',private_oid,'EXECUTE')
    OR has_function_privilege('authenticated',private_oid,'EXECUTE')
    OR has_function_privilege('service_role',private_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'LEDGER_STATEMENT_ACCESS_IDENTITY_CONFLICT: %',r.name;
   END IF;
  ELSIF EXISTS(SELECT 1 FROM pg_depend WHERE refclassid='pg_proc'::regclass AND refobjid=original_oid) THEN
   RAISE EXCEPTION 'LEDGER_STATEMENT_ACCESS_DEPENDENCY_REVIEW_REQUIRED: %',r.name;
  END IF;
 END LOOP;
 IF present_count=3 THEN RETURN; END IF;
 IF present_count<>0 THEN RAISE EXCEPTION 'LEDGER_STATEMENT_ACCESS_PARTIAL_IDENTITY_CONFLICT'; END IF;

 ALTER FUNCTION public.get_ledger_active_accounts() RENAME TO get_ledger_active_accounts_access_internal;
 ALTER FUNCTION public.get_ledger_lines(uuid,date,date,integer,integer) RENAME TO get_ledger_lines_access_internal;
 ALTER FUNCTION public.get_account_statement(text,uuid,date,date,integer,integer) RENAME TO get_account_statement_access_internal;
 REVOKE ALL ON FUNCTION public.get_ledger_active_accounts_access_internal(),
  public.get_ledger_lines_access_internal(uuid,date,date,integer,integer),
  public.get_account_statement_access_internal(text,uuid,date,date,integer,integer)
  FROM PUBLIC,anon,authenticated,service_role;

 EXECUTE $wrapper$
  CREATE FUNCTION public.get_ledger_active_accounts()
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
  AS $body$ BEGIN
   PERFORM public.require_finance_api_access();
   RETURN public.get_ledger_active_accounts_access_internal();
  END;$body$;
 $wrapper$;
 EXECUTE $wrapper$
  CREATE FUNCTION public.get_ledger_lines(p_account_id uuid DEFAULT NULL,p_date_from date DEFAULT NULL,
   p_date_to date DEFAULT NULL,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
  AS $body$ BEGIN
   PERFORM public.require_finance_api_access();
   RETURN public.get_ledger_lines_access_internal(p_account_id,p_date_from,p_date_to,p_limit,p_offset);
  END;$body$;
 $wrapper$;
 EXECUTE $wrapper$
  CREATE FUNCTION public.get_account_statement(p_entity_type text,p_entity_id uuid,p_date_from date DEFAULT NULL,
   p_date_to date DEFAULT NULL,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
  AS $body$ BEGIN
   -- A sales user legitimately reads customers, but never suppliers or ledger.
   IF COALESCE(auth.role(),'')<>'service_role' AND (
    auth.uid() IS NULL OR NOT (
     public.has_role(auth.uid(),'admin'::public.app_role)
     OR public.has_role(auth.uid(),'accountant'::public.app_role)
     OR public.has_role(auth.uid(),'sales'::public.app_role))) THEN
    RAISE EXCEPTION 'CUSTOMER_STATEMENT_ACCESS_DENIED' USING ERRCODE='42501';
   END IF;
   IF p_entity_type='supplier' THEN
    PERFORM public.require_finance_api_access();
   ELSIF p_entity_type IS DISTINCT FROM 'customer' THEN
    RAISE EXCEPTION 'INVALID_STATEMENT_ENTITY_TYPE' USING ERRCODE='22023';
   END IF;
   RETURN public.get_account_statement_access_internal(p_entity_type,p_entity_id,p_date_from,p_date_to,p_limit,p_offset);
  END;$body$;
 $wrapper$;
 REVOKE ALL ON FUNCTION public.get_ledger_active_accounts(),
  public.get_ledger_lines(uuid,date,date,integer,integer),
  public.get_account_statement(text,uuid,date,date,integer,integer) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.get_ledger_active_accounts(),
  public.get_ledger_lines(uuid,date,date,integer,integer),
  public.get_account_statement(text,uuid,date,date,integer,integer) TO authenticated,service_role;
 COMMENT ON FUNCTION public.get_ledger_active_accounts() IS 'SYSTEM:LEDGER_STATEMENT_ACCESS_GUARD:20260928120000';
 COMMENT ON FUNCTION public.get_ledger_lines(uuid,date,date,integer,integer) IS 'SYSTEM:LEDGER_STATEMENT_ACCESS_GUARD:20260928120000';
 COMMENT ON FUNCTION public.get_account_statement(text,uuid,date,date,integer,integer) IS 'SYSTEM:LEDGER_STATEMENT_ACCESS_GUARD:20260928120000';
END;$migration$;
