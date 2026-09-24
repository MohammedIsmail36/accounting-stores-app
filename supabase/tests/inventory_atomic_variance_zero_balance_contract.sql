-- Appended after base and hardening contracts inside fixed L3 BEGIN.
DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore'
     OR to_regprocedure('public.fn_guard_variance_zero_balance()') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_PRECISION_TEST_ISOLATION_FAILED';
  END IF;
END $guard$;

-- PRD-431 has a real legacy fractional-cent book value in the L3 snapshot.
-- A full shortage must fail atomically instead of leaving a non-zero value
-- behind a zero-quantity product.
DO $precision$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();err text;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-431';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q,0,-q,'اختبار دقة القيمة');
  BEGIN
    PERFORM public.post_inventory_adjustment_atomic(d,gen_random_uuid());
    RAISE EXCEPTION 'EXPECTED_PRECISION_REJECTION_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    IF err <> 'INVENTORY_VARIANCE_PRECISION_REVIEW_REQUIRED'
    THEN RAISE EXCEPTION 'PRECISION_WRONG_ERROR %',err; END IF;
  END;
  IF (SELECT quantity_on_hand FROM public.products WHERE id=p)<>q
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'draft'
     OR EXISTS(SELECT 1 FROM public.inventory_variance_operations WHERE source_id=d)
     OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE reference_id=d)
  THEN RAISE EXCEPTION 'PRECISION_REJECTION_LEFT_EFFECT'; END IF;
END $precision$;

SELECT 'INVENTORY_ATOMIC_VARIANCE_ZERO_BALANCE_OK';
ROLLBACK;
