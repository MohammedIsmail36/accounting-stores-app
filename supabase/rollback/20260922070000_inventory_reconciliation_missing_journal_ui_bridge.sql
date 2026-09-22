-- Explicit rollback for the stage 2D-C server-side UI bridge.
DO $guard$
BEGIN
  IF current_setting('app.inventory_missing_journal_ui_bridge_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260922070000' THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_UI_BRIDGE_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_reconciliation_repair_items i
    JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
    WHERE i.repair_type = 'create_missing_inventory_journal'
      AND r.status IN ('draft', 'ready_for_review', 'approved')
  ) THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_UI_BRIDGE_ROLLBACK_ACTIVE_REPAIRS';
  END IF;
END;
$guard$;

DROP TRIGGER trg_prepare_inventory_missing_journal_repair_item
  ON public.inventory_reconciliation_repair_items;
DROP FUNCTION public.fn_prepare_inventory_missing_journal_repair_item();
