-- Explicit rollback of an unused Phase 3 engine only. Never undo postings here.
DO $guard$
BEGIN
  IF current_setting('app.inventory_variance_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260924100000' THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF to_regclass('public.inventory_variance_operations') IS NULL
     OR to_regclass('public.inventory_variance_operation_lines') IS NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ROLLBACK_BASELINE_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_variance_operations)
     OR EXISTS (SELECT 1 FROM public.inventory_variance_operation_lines)
     OR EXISTS (SELECT 1 FROM public.inventory_movements
       WHERE variance_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ROLLBACK_HAS_POSTINGS';
  END IF;
END $guard$;

DROP FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text);
DROP FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid);
DROP FUNCTION public.apply_inventory_variance_effects_internal(
  uuid,text,uuid,date,jsonb,jsonb,text,uuid
);
ALTER TABLE public.inventory_movements DROP COLUMN variance_operation_id;
DROP TABLE public.inventory_variance_operation_lines;
DROP TABLE public.inventory_variance_operations;
