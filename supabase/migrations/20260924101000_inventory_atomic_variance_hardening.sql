-- Phase 3 hardening: lock source lines and preserve the original journal used
-- for reversal. Apply only together with the base engine and UI cutover gate.
DO $preflight$
BEGIN
  IF to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NULL
     OR to_regclass('public.inventory_variance_operations') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_HARDENING_BASELINE_MISMATCH';
  END IF;
END $preflight$;

ALTER TABLE public.inventory_variance_operations ADD COLUMN journal_signature text;

CREATE FUNCTION public.fn_capture_variance_journal_signature()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.operation_kind = 'post' AND NEW.journal_entry_id IS NOT NULL THEN
    SELECT md5(COALESCE(string_agg(
      concat_ws('|', account_id::text, debit::text, credit::text,
        COALESCE(description,'')), ';' ORDER BY id), ''))
    INTO NEW.journal_signature
    FROM public.journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_capture_variance_journal_signature
BEFORE UPDATE OF journal_entry_id ON public.inventory_variance_operations
FOR EACH ROW EXECUTE FUNCTION public.fn_capture_variance_journal_signature();

REVOKE ALL ON FUNCTION public.fn_capture_variance_journal_signature()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid)
  RENAME TO post_inventory_adjustment_atomic_base;
REVOKE ALL ON FUNCTION public.post_inventory_adjustment_atomic_base(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.post_inventory_adjustment_atomic(
  p_adjustment_id uuid, p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
BEGIN
  -- The document lock serializes competing requests; item locks prevent a
  -- concurrent editor from changing the source snapshot during calculation.
  PERFORM 1 FROM public.inventory_adjustments
  WHERE id = p_adjustment_id FOR UPDATE;
  PERFORM 1 FROM public.inventory_adjustment_items
  WHERE adjustment_id = p_adjustment_id ORDER BY product_id FOR UPDATE;
  RETURN public.post_inventory_adjustment_atomic_base(p_adjustment_id,p_request_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_inventory_adjustment_atomic(uuid,uuid)
  TO authenticated, service_role;

ALTER FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text)
  RENAME TO reverse_inventory_adjustment_atomic_base;
REVOKE ALL ON FUNCTION public.reverse_inventory_adjustment_atomic_base(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reverse_inventory_adjustment_atomic(
  p_adjustment_id uuid, p_request_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE
  v_doc_status text;
  v_original public.inventory_variance_operations%ROWTYPE;
  v_signature text;
  v_product_id uuid;
  v_card_quantity numeric;
  v_movement_quantity numeric;
BEGIN
  SELECT status INTO v_doc_status FROM public.inventory_adjustments
  WHERE id = p_adjustment_id FOR UPDATE;
  IF v_doc_status = 'posted' THEN
    SELECT * INTO v_original FROM public.inventory_variance_operations
    WHERE source_type = 'adjustment' AND source_id = p_adjustment_id
      AND operation_kind = 'post' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_ORIGINAL_INVALID'; END IF;

    IF v_original.journal_entry_id IS NOT NULL THEN
      PERFORM 1 FROM public.journal_entries
      WHERE id = v_original.journal_entry_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_JOURNAL_INVALID'; END IF;
      SELECT md5(COALESCE(string_agg(
        concat_ws('|', account_id::text, debit::text, credit::text,
          COALESCE(description,'')), ';' ORDER BY id), ''))
      INTO v_signature FROM public.journal_entry_lines
      WHERE journal_entry_id = v_original.journal_entry_id;
      IF v_original.journal_signature IS NULL
         OR v_signature IS DISTINCT FROM v_original.journal_signature THEN
        RAISE EXCEPTION 'INVENTORY_VARIANCE_ORIGINAL_JOURNAL_CHANGED';
      END IF;
    END IF;

    FOR v_product_id IN
      SELECT product_id FROM public.inventory_variance_operation_lines
      WHERE operation_id = v_original.id ORDER BY product_id
    LOOP
      SELECT quantity_on_hand INTO v_card_quantity FROM public.products
      WHERE id = v_product_id FOR UPDATE;
      SELECT COALESCE(sum(public.inventory_signed_quantity(
        m.movement_type::text,m.quantity)),0)
      INTO v_movement_quantity FROM public.inventory_movements m
      WHERE m.product_id = v_product_id;
      IF v_card_quantity IS DISTINCT FROM v_movement_quantity THEN
        RAISE EXCEPTION 'INVENTORY_VARIANCE_PRECONDITION_CHANGED';
      END IF;
    END LOOP;
  END IF;
  RETURN public.reverse_inventory_adjustment_atomic_base(
    p_adjustment_id,p_request_id,p_reason);
END;
$function$;
REVOKE ALL ON FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_adjustment_atomic(uuid,uuid,text)
  TO authenticated, service_role;
