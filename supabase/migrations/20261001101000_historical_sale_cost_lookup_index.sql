BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF to_regclass('public.historical_sale_cost_corrections') IS NULL
     OR to_regclass('public.historical_sale_cost_by_movement') IS NOT NULL
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_LOOKUP_BASELINE_MISMATCH'; END IF;
END $guard$;
CREATE INDEX historical_sale_cost_by_movement
  ON public.historical_sale_cost_corrections (movement_id);
COMMIT;
