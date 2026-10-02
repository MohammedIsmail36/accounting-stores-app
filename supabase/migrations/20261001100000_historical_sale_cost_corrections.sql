-- Infrastructure only. This migration never inserts a historical correction.
-- Deploy only with the dependent diagnostic/report readers and an approved company-specific data script.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regclass('public.inventory_movements') IS NULL
     OR to_regclass('public.sales_invoices') IS NULL
     OR to_regclass('public.historical_sale_cost_corrections') IS NOT NULL
     OR to_regclass('public.inventory_movements_effective_cost') IS NOT NULL
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_SCHEMA_BASELINE_MISMATCH'; END IF;
END $preflight$;

CREATE TABLE public.historical_sale_cost_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  movement_id uuid NOT NULL REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  source_invoice_id uuid NOT NULL REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  expected_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  expected_quantity numeric NOT NULL CHECK (expected_quantity > 0),
  expected_original_total_cost numeric NOT NULL CHECK (expected_original_total_cost >= 0),
  delta_cost numeric NOT NULL CHECK (delta_cost <> 0),
  reverses_id uuid UNIQUE REFERENCES public.historical_sale_cost_corrections(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 16),
  approval_reference text NOT NULL CHECK (length(btrim(approval_reference)) >= 8),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT historical_sale_cost_reversal_sign CHECK (
    (reverses_id IS NULL AND delta_cost > 0)
    OR (reverses_id IS NOT NULL AND delta_cost < 0)
  )
);
CREATE UNIQUE INDEX historical_sale_cost_one_original_per_movement
  ON public.historical_sale_cost_corrections (movement_id)
  WHERE reverses_id IS NULL;
CREATE INDEX historical_sale_cost_by_invoice
  ON public.historical_sale_cost_corrections (source_invoice_id);

CREATE FUNCTION public.validate_historical_sale_cost_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
DECLARE
  v_movement public.inventory_movements%ROWTYPE;
  v_original public.historical_sale_cost_corrections%ROWTYPE;
  v_status text;
  v_current_delta numeric;
BEGIN
  SELECT * INTO v_movement FROM public.inventory_movements
   WHERE id = NEW.movement_id FOR UPDATE;
  IF NOT FOUND OR v_movement.movement_type::text <> 'sale'
    OR v_movement.reference_type <> 'sales_invoice'
    OR v_movement.reference_id IS DISTINCT FROM NEW.source_invoice_id
    OR v_movement.product_id IS DISTINCT FROM NEW.expected_product_id
    OR v_movement.quantity IS DISTINCT FROM NEW.expected_quantity
    OR v_movement.total_cost IS DISTINCT FROM NEW.expected_original_total_cost
  THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_SOURCE_CHANGED' USING ERRCODE = 'P0001'; END IF;

  SELECT status::text INTO v_status FROM public.sales_invoices
   WHERE id = NEW.source_invoice_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'HISTORICAL_SALE_COST_INVOICE_NOT_POSTED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(delta_cost), 0) INTO v_current_delta
    FROM public.historical_sale_cost_corrections
   WHERE movement_id = NEW.movement_id;
  IF NEW.reverses_id IS NULL THEN
    IF v_current_delta <> 0 OR NEW.expected_original_total_cost + NEW.delta_cost < 0 THEN
      RAISE EXCEPTION 'HISTORICAL_SALE_COST_PREVIOUS_CORRECTION_OR_NEGATIVE_VALUE' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO v_original FROM public.historical_sale_cost_corrections
     WHERE id = NEW.reverses_id AND reverses_id IS NULL FOR SHARE;
    IF NOT FOUND OR v_original.movement_id <> NEW.movement_id
      OR v_original.source_invoice_id <> NEW.source_invoice_id
      OR NEW.delta_cost <> -v_original.delta_cost
      OR v_current_delta <> v_original.delta_cost
    THEN RAISE EXCEPTION 'HISTORICAL_SALE_COST_INVALID_REVERSAL' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.prevent_historical_sale_cost_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'HISTORICAL_SALE_COST_APPEND_ONLY' USING ERRCODE = 'P0001';
END;
$function$;

CREATE FUNCTION public.protect_corrected_sale_movement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.historical_sale_cost_corrections WHERE movement_id = OLD.id)
     AND (TG_OP = 'DELETE' OR OLD.product_id IS DISTINCT FROM NEW.product_id
       OR OLD.movement_type IS DISTINCT FROM NEW.movement_type
       OR OLD.quantity IS DISTINCT FROM NEW.quantity
       OR OLD.unit_cost IS DISTINCT FROM NEW.unit_cost
       OR OLD.total_cost IS DISTINCT FROM NEW.total_cost
       OR OLD.reference_type IS DISTINCT FROM NEW.reference_type
       OR OLD.reference_id IS DISTINCT FROM NEW.reference_id
       OR OLD.movement_date IS DISTINCT FROM NEW.movement_date)
  THEN RAISE EXCEPTION 'CORRECTED_SALE_MOVEMENT_IMMUTABLE' USING ERRCODE = 'P0001'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER validate_historical_sale_cost_correction_before_insert
  BEFORE INSERT ON public.historical_sale_cost_corrections
  FOR EACH ROW EXECUTE FUNCTION public.validate_historical_sale_cost_correction();
CREATE TRIGGER prevent_historical_sale_cost_change_before_mutation
  BEFORE UPDATE OR DELETE ON public.historical_sale_cost_corrections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_historical_sale_cost_change();
CREATE TRIGGER protect_corrected_sale_movement_before_mutation
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.protect_corrected_sale_movement();

ALTER TABLE public.historical_sale_cost_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY historical_sale_cost_finance_read
  ON public.historical_sale_cost_corrections FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'accountant'::public.app_role));
REVOKE ALL ON public.historical_sale_cost_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.historical_sale_cost_corrections TO authenticated, service_role;

CREATE VIEW public.inventory_movements_effective_cost
  WITH (security_invoker = true) AS
SELECT m.id, m.product_id, m.movement_type, m.quantity,
       CASE WHEN m.quantity <> 0 AND correction.delta_cost <> 0
         THEN (m.total_cost + correction.delta_cost) / abs(m.quantity)
         ELSE m.unit_cost END AS unit_cost,
       m.total_cost + correction.delta_cost AS total_cost,
       m.reference_id, m.reference_type, m.notes, m.movement_date,
       m.created_by, m.created_at, m.variance_operation_id,
       m.unit_cost AS original_unit_cost,
       m.total_cost AS original_total_cost,
       correction.delta_cost AS correction_cost
FROM public.inventory_movements m
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(c.delta_cost), 0) AS delta_cost
  FROM public.historical_sale_cost_corrections c WHERE c.movement_id = m.id
) correction ON true;
REVOKE ALL ON public.inventory_movements_effective_cost FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.inventory_movements_effective_cost TO authenticated, service_role;

COMMENT ON TABLE public.historical_sale_cost_corrections IS
  'Append-only, approved cost-only corrections linked to posted sales movements; no journal or quantity mutation.';
COMMENT ON VIEW public.inventory_movements_effective_cost IS
  'Finance-RLS-respecting cost read model; original cost and additive correction remain separately visible.';
COMMIT;
