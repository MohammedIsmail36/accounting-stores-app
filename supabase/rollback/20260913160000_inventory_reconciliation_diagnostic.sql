-- Emergency rollback of the original diagnostic, only after all later inventory
-- repair/variance components have been reversed. Execute in one transaction.
-- The caller must set the authorization token transaction-locally and handle
-- migration-history repair separately after verifying the schema rollback.
DO $guard$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)'
  )::oid;
BEGIN
  IF current_setting('app.inventory_diagnostic_rollback_authorized', true)
       IS DISTINCT FROM 'EXPLICIT_INVENTORY_DIAGNOSTIC_ROLLBACK_20260913160000' THEN
    RAISE EXCEPTION 'INVENTORY_DIAGNOSTIC_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_DIAGNOSTIC_ROLLBACK_OBJECT_MISSING';
  END IF;
  IF to_regclass('public.inventory_reconciliation_repairs') IS NOT NULL
     OR to_regclass('public.inventory_reconciliation_repair_items') IS NOT NULL
     OR to_regclass('public.inventory_variance_operations') IS NOT NULL
     OR to_regclass('public.inventory_variance_operation_lines') IS NOT NULL THEN
    RAISE EXCEPTION 'INVENTORY_DIAGNOSTIC_ROLLBACK_COMPONENTS_REMAIN';
  END IF;
  IF obj_description(v_function_oid, 'pg_proc')
       IS DISTINCT FROM 'Read-only current-state inventory reconciliation by product and explicit source; never performs repairs.'
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.oid = v_function_oid
         AND p.prosecdef
         AND p.provolatile = 's'
         AND p.prosrc LIKE '%RECONCILIATION_SNAPSHOT_STALE%'
         AND p.prosrc LIKE '%all_recorded_stock_effects%'
     ) THEN
    RAISE EXCEPTION 'INVENTORY_DIAGNOSTIC_ROLLBACK_DEFINITION_CHANGED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.oid <> v_function_oid
      AND p.prosrc ILIKE '%get_inventory_reconciliation_diagnostic%'
  ) THEN
    RAISE EXCEPTION 'INVENTORY_DIAGNOSTIC_ROLLBACK_FUNCTION_DEPENDENCIES';
  END IF;
END;
$guard$;

DROP FUNCTION public.get_inventory_reconciliation_diagnostic(
  text, boolean, text, integer, integer, text
) RESTRICT;
