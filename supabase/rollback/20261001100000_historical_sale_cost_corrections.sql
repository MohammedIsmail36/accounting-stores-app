-- Safe only when no committed correction exists. Data rollback requires an auditable reversing row.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
  IF to_regclass('public.historical_sale_cost_corrections') IS NULL THEN
    RAISE EXCEPTION 'HISTORICAL_SALE_COST_ROLLBACK_SCHEMA_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.historical_sale_cost_corrections) THEN
    RAISE EXCEPTION 'HISTORICAL_SALE_COST_ROLLBACK_HAS_DATA';
  END IF;
END $guard$;
DROP VIEW public.inventory_movements_effective_cost;
DROP TRIGGER protect_corrected_sale_movement_before_mutation ON public.inventory_movements;
DROP TRIGGER prevent_historical_sale_cost_change_before_mutation ON public.historical_sale_cost_corrections;
DROP TRIGGER validate_historical_sale_cost_correction_before_insert ON public.historical_sale_cost_corrections;
DROP FUNCTION public.protect_corrected_sale_movement();
DROP FUNCTION public.prevent_historical_sale_cost_change();
DROP FUNCTION public.validate_historical_sale_cost_correction();
DROP TABLE public.historical_sale_cost_corrections;
COMMIT;
