-- Explicit rollback for Stage 2D-B. Refuses to remove traceability after a
-- committed missing-journal execution.
DO $guard$
BEGIN
  IF current_setting('app.inventory_missing_journal_executor_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260921233000' THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_EXECUTOR_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_repair_effects
    WHERE effect_type = 'missing_inventory_journal_created'
  ) THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_EXECUTOR_ROLLBACK_HAS_EXECUTIONS';
  END IF;
  IF to_regprocedure('public.execute_inventory_reconciliation_repair_rebuild_2c(uuid,integer,uuid)') IS NULL
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_EXECUTOR_ROLLBACK_BASELINE_MISMATCH';
  END IF;
END;
$guard$;

DROP FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid);
ALTER FUNCTION public.execute_inventory_reconciliation_repair_rebuild_2c(uuid, integer, uuid)
  RENAME TO execute_inventory_reconciliation_repair;
REVOKE ALL ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  TO authenticated, service_role;

DROP FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date);
ALTER FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(text, uuid, date)
  RENAME TO get_inventory_reconciliation_journal_plan;
REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  TO authenticated, service_role;
