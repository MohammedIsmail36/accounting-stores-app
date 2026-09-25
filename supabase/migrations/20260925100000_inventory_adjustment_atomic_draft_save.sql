-- Phase 4A: one transaction for an inventory-adjustment draft and all its lines.
-- This is additive; the UI must be switched separately after isolated acceptance.
DO $preflight$
BEGIN
  IF to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamp with time zone,date,text,jsonb)') IS NOT NULL
     OR to_regclass('public.inventory_adjustments') IS NULL
     OR to_regclass('public.inventory_adjustment_items') IS NULL
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='inventory_adjustments'
         AND column_name='posted_number') THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_SAVE_BASELINE_MISMATCH';
  END IF;
END $preflight$;

CREATE FUNCTION public.save_inventory_adjustment_draft(
  p_adjustment_id uuid,
  p_expected_updated_at timestamptz,
  p_adjustment_date date,
  p_description text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_doc public.inventory_adjustments%ROWTYPE;
  v_id uuid;
  v_number integer;
  v_updated_at timestamptz;
  v_actor uuid := auth.uid();
  v_item jsonb;
  v_product_id uuid;
  v_product_ids uuid[] := '{}'::uuid[];
  v_system numeric;
  v_supplied_system numeric;
  v_actual numeric;
  v_unit_cost numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (public.has_role(v_actor, 'admin'::public.app_role)
       OR public.has_role(v_actor, 'accountant'::public.app_role)) THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_PERMISSION_DENIED';
  END IF;
  IF p_adjustment_date IS NULL OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_INPUT_INVALID';
  END IF;

  -- Lock the document before checking its version. A stale browser tab must
  -- never replace another editor's lines or race a posting operation.
  IF p_adjustment_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.inventory_adjustments
    WHERE id = p_adjustment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_DRAFT_NOT_FOUND'; END IF;
    IF v_doc.status <> 'draft' OR v_doc.journal_entry_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.inventory_variance_operations
         WHERE source_type = 'adjustment' AND source_id = p_adjustment_id) THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_STATUS_CHANGED';
    END IF;
    IF p_expected_updated_at IS NULL
       OR v_doc.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_VERSION_CHANGED';
    END IF;
  ELSIF p_expected_updated_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVENTORY_DRAFT_INPUT_INVALID';
  END IF;

  -- Validate the complete payload before changing any existing rows. Lock
  -- products in stable order, so the saved card snapshot cannot change mid-save.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR NULLIF(v_item->>'product_id', '') IS NULL
       OR NULLIF(v_item->>'system_quantity', '') IS NULL
       OR NULLIF(v_item->>'actual_quantity', '') IS NULL
       OR NULLIF(v_item->>'unit_cost', '') IS NULL THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_ITEM_INVALID';
    END IF;
    v_product_id := (v_item->>'product_id')::uuid;
    IF v_product_id = ANY(v_product_ids) THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_DUPLICATE_PRODUCT';
    END IF;
    v_product_ids := array_append(v_product_ids, v_product_id);
    v_supplied_system := (v_item->>'system_quantity')::numeric;
    v_actual := (v_item->>'actual_quantity')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    IF v_supplied_system IS NULL OR v_actual IS NULL OR v_unit_cost IS NULL
       OR v_supplied_system < 0 OR v_actual < 0 OR v_unit_cost < 0
       OR v_supplied_system > 1000000000 OR v_actual > 1000000000 THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_ITEM_INVALID';
    END IF;
  END LOOP;
  FOR v_product_id IN SELECT unnest(v_product_ids) ORDER BY 1 LOOP
    PERFORM 1 FROM public.products WHERE id = v_product_id AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_DRAFT_PRODUCT_UNAVAILABLE'; END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT quantity_on_hand INTO v_system FROM public.products
    WHERE id = (v_item->>'product_id')::uuid;
    IF v_system IS DISTINCT FROM (v_item->>'system_quantity')::numeric THEN
      RAISE EXCEPTION 'INVENTORY_DRAFT_STOCK_CHANGED';
    END IF;
  END LOOP;

  IF p_adjustment_id IS NULL THEN
    INSERT INTO public.inventory_adjustments(
      adjustment_date, description, status, created_by
    ) VALUES (p_adjustment_date, NULLIF(btrim(p_description), ''), 'draft', v_actor)
    RETURNING id, adjustment_number, updated_at INTO v_id, v_number, v_updated_at;
  ELSE
    v_id := p_adjustment_id;
    UPDATE public.inventory_adjustments
    SET adjustment_date = p_adjustment_date,
        description = NULLIF(btrim(p_description), '')
    WHERE id = v_id
    RETURNING adjustment_number, updated_at INTO v_number, v_updated_at;
    DELETE FROM public.inventory_adjustment_items WHERE adjustment_id = v_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_supplied_system := (v_item->>'system_quantity')::numeric;
    v_actual := (v_item->>'actual_quantity')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    INSERT INTO public.inventory_adjustment_items(
      adjustment_id, product_id, system_quantity, actual_quantity,
      difference, unit_cost, total_cost, notes
    ) VALUES (
      v_id, (v_item->>'product_id')::uuid, v_supplied_system, v_actual,
      v_actual - v_supplied_system, v_unit_cost,
      round(abs(v_actual - v_supplied_system) * v_unit_cost, 2),
      NULLIF(btrim(v_item->>'notes'), '')
    );
  END LOOP;

  RETURN jsonb_build_object('adjustment_id', v_id, 'adjustment_number', v_number,
    'updated_at', v_updated_at, 'status', 'draft');
END;
$function$;

REVOKE ALL ON FUNCTION public.save_inventory_adjustment_draft(
  uuid,timestamptz,date,text,jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_adjustment_draft(
  uuid,timestamptz,date,text,jsonb
) TO authenticated, service_role;
