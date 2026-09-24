-- Use only after restoring the pre-cutover UI and verifying no atomic postings.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF current_setting('app.inventory_variance_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260924103000'
     OR to_regprocedure('public.fn_guard_inventory_adjustment_document()') IS NULL
     OR to_regprocedure('public.fn_guard_inventory_adjustment_item()') IS NULL
     OR to_regprocedure('public.fn_guard_inventory_adjustment_movement()') IS NULL
     OR EXISTS (SELECT 1 FROM public.inventory_variance_operations
       WHERE source_type = 'adjustment') THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_WRITE_GUARD_ROLLBACK_REFUSED';
  END IF;
END $preflight$;

DROP TRIGGER trg_guard_inventory_adjustment_document ON public.inventory_adjustments;
DROP TRIGGER trg_guard_inventory_adjustment_item ON public.inventory_adjustment_items;
DROP TRIGGER trg_guard_inventory_adjustment_movement ON public.inventory_movements;
DROP FUNCTION public.fn_guard_inventory_adjustment_document();
DROP FUNCTION public.fn_guard_inventory_adjustment_item();
DROP FUNCTION public.fn_guard_inventory_adjustment_movement();
GRANT EXECUTE ON FUNCTION public.adjust_product_quantity(uuid,numeric)
  TO PUBLIC, anon, authenticated, service_role;

COMMIT;
