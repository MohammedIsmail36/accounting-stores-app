-- Roll back this unused guard before the hardening and base engine.
DO $guard$
BEGIN
  IF current_setting('app.inventory_variance_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260924102000' THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ZERO_GUARD_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF to_regprocedure('public.fn_guard_variance_zero_balance()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
       WHERE tgrelid='public.inventory_movements'::regclass
         AND tgname='trg_guard_variance_zero_balance' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ZERO_GUARD_ROLLBACK_BASELINE_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_variance_operations) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ZERO_GUARD_ROLLBACK_HAS_POSTINGS';
  END IF;
END $guard$;
DROP TRIGGER trg_guard_variance_zero_balance ON public.inventory_movements;
DROP FUNCTION public.fn_guard_variance_zero_balance();
