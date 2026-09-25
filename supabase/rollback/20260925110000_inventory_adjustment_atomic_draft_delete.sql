-- Run only after restoring the previous UI. The old UI requires direct DELETE.
DO $preflight$
BEGIN
  IF to_regprocedure('public.delete_inventory_adjustment_draft(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_DELETE_ROLLBACK_BASELINE_MISMATCH';
  END IF;
END $preflight$;

DROP FUNCTION public.delete_inventory_adjustment_draft(uuid,timestamptz);
GRANT DELETE ON public.inventory_adjustments, public.inventory_adjustment_items
  TO anon, authenticated;
