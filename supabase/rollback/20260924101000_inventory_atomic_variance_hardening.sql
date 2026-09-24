-- Roll back the unused hardening layer before rolling back the base engine.
DO $guard$
BEGIN
  IF current_setting('app.inventory_variance_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260924101000' THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_HARDENING_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF to_regprocedure('public.post_inventory_adjustment_atomic_base(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic_base(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_HARDENING_ROLLBACK_BASELINE_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_variance_operations) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_HARDENING_ROLLBACK_HAS_POSTINGS';
  END IF;
END $guard$;

DROP FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text);
DROP FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid);
ALTER FUNCTION public.reverse_inventory_adjustment_atomic_base(uuid,uuid,text)
  RENAME TO reverse_inventory_adjustment_atomic;
ALTER FUNCTION public.post_inventory_adjustment_atomic_base(uuid,uuid)
  RENAME TO post_inventory_adjustment_atomic;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid)
  TO authenticated, service_role;
DROP TRIGGER trg_capture_variance_journal_signature
  ON public.inventory_variance_operations;
DROP FUNCTION public.fn_capture_variance_journal_signature();
ALTER TABLE public.inventory_variance_operations DROP COLUMN journal_signature;
