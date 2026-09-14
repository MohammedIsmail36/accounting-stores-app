-- Explicit emergency rollback body for stage 2B on the owned Staging project.
-- The caller must set the transaction-local authorization token and handle
-- migration history separately after this schema rollback succeeds.

DO $guard$
BEGIN
  IF current_setting('app.inventory_repair_rollback_authorized', true)
     IS DISTINCT FROM 'STAGING_20260913234500' THEN
    RAISE EXCEPTION 'INVENTORY_REPAIR_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF to_regclass('public.inventory_reconciliation_repairs') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_REPAIR_ROLLBACK_OBJECTS_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_reconciliation_repairs) THEN
    RAISE EXCEPTION 'INVENTORY_REPAIR_ROLLBACK_HAS_RECORDS';
  END IF;
END;
$guard$;

DROP FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid);
DROP FUNCTION public.cancel_inventory_reconciliation_repair(uuid, text, integer, uuid);
DROP FUNCTION public.approve_inventory_reconciliation_repair(uuid, integer, text, uuid);
DROP FUNCTION public.submit_inventory_reconciliation_repair(uuid, integer, uuid);
DROP FUNCTION public.update_inventory_reconciliation_repair(uuid, text, text, jsonb, integer, uuid);
DROP FUNCTION public.create_inventory_reconciliation_repair(text, text, text, timestamptz, text, jsonb, uuid);
DROP FUNCTION public.inventory_reconciliation_replace_repair_items(uuid, jsonb);
DROP FUNCTION public.inventory_reconciliation_repair_replay(uuid, text, uuid);
DROP FUNCTION public.inventory_reconciliation_repair_result(uuid);
DROP FUNCTION public.inventory_reconciliation_repair_require_actor(boolean);

DROP TABLE public.inventory_reconciliation_repair_effects;
DROP TABLE public.inventory_reconciliation_repair_events;
DROP TABLE public.inventory_reconciliation_repair_items;
DROP TABLE public.inventory_reconciliation_repairs;
