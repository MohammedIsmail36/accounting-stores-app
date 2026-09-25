-- Safe structural rollback while the UI has not switched to this gateway.
DO $preflight$
BEGIN
  IF to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamp with time zone,date,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_SAVE_ROLLBACK_MISMATCH';
  END IF;
END $preflight$;

DROP FUNCTION public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb);
