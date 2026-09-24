-- Enable only at the UI cutover. Legacy approved adjustments remain readable,
-- while draft editing and unrelated stock document flows remain available.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.adjust_product_quantity(uuid,numeric)') IS NULL
     OR to_regprocedure('public.fn_guard_inventory_adjustment_document()') IS NOT NULL
     OR to_regprocedure('public.fn_guard_inventory_adjustment_item()') IS NOT NULL
     OR to_regprocedure('public.fn_guard_inventory_adjustment_movement()') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p
       WHERE p.oid = 'public.adjust_product_quantity(uuid,numeric)'::regprocedure
         AND p.proacl::text ~ '(^|[,{])=X/')
     OR NOT has_function_privilege('anon', 'public.adjust_product_quantity(uuid,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.adjust_product_quantity(uuid,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.adjust_product_quantity(uuid,numeric)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_WRITE_GUARD_BASELINE_MISMATCH';
  END IF;
END $preflight$;

-- These triggers deliberately run as invoker. Inside the atomic SECURITY DEFINER
-- gateways current_user is their database owner; direct API writes keep their
-- restricted database role. A client-supplied session GUC is not trusted.
CREATE FUNCTION public.fn_guard_inventory_adjustment_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $guard$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('draft', 'review')
       OR NEW.status NOT IN ('draft', 'review')
       OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.adjustment_number IS DISTINCT FROM OLD.adjustment_number
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('draft', 'review') THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
  END IF;
  RETURN OLD;
END $guard$;

CREATE TRIGGER trg_guard_inventory_adjustment_document
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_inventory_adjustment_document();

CREATE FUNCTION public.fn_guard_inventory_adjustment_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $guard$
DECLARE
  v_old_status text;
  v_new_status text;
  v_old_journal uuid;
  v_new_journal uuid;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status, journal_entry_id INTO v_old_status, v_old_journal
    FROM public.inventory_adjustments WHERE id = OLD.adjustment_id;
    IF v_old_status NOT IN ('draft', 'review') OR v_old_journal IS NOT NULL THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status, journal_entry_id INTO v_new_status, v_new_journal
    FROM public.inventory_adjustments WHERE id = NEW.adjustment_id;
    IF v_new_status NOT IN ('draft', 'review') OR v_new_journal IS NOT NULL THEN
      RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $guard$;

CREATE TRIGGER trg_guard_inventory_adjustment_item
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_adjustment_items
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_inventory_adjustment_item();

CREATE FUNCTION public.fn_guard_inventory_adjustment_movement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $guard$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND
     (OLD.movement_type::text = 'adjustment'
       OR OLD.reference_type IN ('adjustment', 'inventory_adjustment')
       OR OLD.variance_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND
     (NEW.movement_type::text = 'adjustment'
       OR NEW.reference_type IN ('adjustment', 'inventory_adjustment')
       OR NEW.variance_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $guard$;

CREATE TRIGGER trg_guard_inventory_adjustment_movement
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_inventory_adjustment_movement();

REVOKE EXECUTE ON FUNCTION public.adjust_product_quantity(uuid,numeric)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
