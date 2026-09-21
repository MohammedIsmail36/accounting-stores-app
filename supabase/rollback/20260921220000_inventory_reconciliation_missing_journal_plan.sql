-- Explicit rollback for Stage 2D-A read-only planner.
DO $guard$
BEGIN
  IF current_setting('app.inventory_missing_journal_plan_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260921220000' THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_PLAN_ROLLBACK_NOT_AUTHORIZED';
  END IF;
END;
$guard$;

DROP FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date);
