-- Do not leave a non-zero movement book value when the adjusted card reaches
-- zero. Legacy movement values may contain fractional cents; such a product
-- requires reconciliation before a full write-off, not silent rounding.
DO $preflight$
BEGIN
  IF to_regclass('public.inventory_variance_operations') IS NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.inventory_movements'::regclass
       AND tgname='trg_guard_variance_zero_balance' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_ZERO_GUARD_BASELINE_MISMATCH';
  END IF;
END $preflight$;

CREATE FUNCTION public.fn_guard_variance_zero_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
DECLARE
  v_after_quantity numeric;
  v_before_book_value numeric;
BEGIN
  IF NEW.variance_operation_id IS NULL
     OR NEW.movement_type::text <> 'adjustment' OR NEW.quantity >= 0 THEN
    RETURN NEW;
  END IF;
  SELECT quantity_on_hand INTO v_after_quantity FROM public.products
  WHERE id = NEW.product_id;
  IF v_after_quantity <> 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(CASE
    WHEN m.movement_type::text = 'adjustment'
      THEN sign(m.quantity) * abs(m.total_cost)
    WHEN m.movement_type::text IN ('sale','purchase_return')
      THEN -abs(m.total_cost)
    ELSE abs(m.total_cost) END),0)
  INTO v_before_book_value FROM public.inventory_movements m
  WHERE m.product_id = NEW.product_id;
  IF abs(NEW.total_cost) IS DISTINCT FROM v_before_book_value THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_PRECISION_REVIEW_REQUIRED';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_guard_variance_zero_balance
BEFORE INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_variance_zero_balance();

REVOKE ALL ON FUNCTION public.fn_guard_variance_zero_balance()
  FROM PUBLIC, anon, authenticated, service_role;
