-- Safe only before a reason-coded draft is retained. Never discard reason data.
DO $preflight$
BEGIN
  IF to_regprocedure('public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)') IS NULL
     OR EXISTS (SELECT 1 FROM public.inventory_adjustment_items
       WHERE reason_code IS NOT NULL OR reason_reference IS NOT NULL) THEN
    RAISE EXCEPTION 'INVENTORY_ADJUSTMENT_REASONS_ROLLBACK_REFUSED';
  END IF;
END $preflight$;

DROP TRIGGER require_inventory_adjustment_reason_on_post ON public.inventory_adjustments;
DROP FUNCTION public.fn_require_inventory_adjustment_reason_on_post();
DROP FUNCTION public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb);
ALTER TABLE public.inventory_adjustment_items
  DROP CONSTRAINT inventory_adjustment_reason_reference_check,
  DROP CONSTRAINT inventory_adjustment_reason_code_check,
  DROP COLUMN reason_reference,
  DROP COLUMN reason_code;
