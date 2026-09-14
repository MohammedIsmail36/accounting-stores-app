-- Stage 2C: first real inventory-reconciliation executor.
-- The only supported repair is rebuilding products.quantity_on_hand from the
-- signed quantity of the product's existing inventory movements.

CREATE OR REPLACE FUNCTION public.execute_inventory_reconciliation_repair(
  p_id uuid,
  p_expected_version integer,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_repair public.inventory_reconciliation_repairs%ROWTYPE;
  v_item public.inventory_reconciliation_repair_items%ROWTYPE;
  v_product_code text;
  v_diagnostic jsonb;
  v_current_row jsonb;
  v_after_row jsonb;
  v_current_hash text;
  v_result jsonb;
  v_replay jsonb;
  v_item_count integer;
BEGIN
  v_actor := public.inventory_reconciliation_repair_require_actor(true);
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'REPAIR_REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- A request identifier is the idempotency key. Replay is checked before the
  -- repair status so retrying a successful request returns the same result.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('inventory-repair-request:' || p_request_id::text, 0)
  );
  v_replay := public.inventory_reconciliation_repair_replay(
    p_request_id, 'executed', v_actor
  );
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  SELECT * INTO v_repair
  FROM public.inventory_reconciliation_repairs
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPAIR_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_repair.status <> 'approved' THEN
    RAISE EXCEPTION 'REPAIR_STATUS_INVALID' USING ERRCODE = '55000';
  END IF;
  IF v_repair.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'REPAIR_VERSION_CONFLICT' USING ERRCODE = '40001';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.inventory_reconciliation_repair_items
  WHERE repair_id = p_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'REPAIR_ITEMS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_reconciliation_repair_items i
    WHERE i.repair_id = p_id
      AND (
        i.axis <> 'product'
        OR i.classification <> 'product_balance'
        OR i.repair_type <> 'rebuild_product_card'
        OR i.product_id IS NULL
        OR i.result_status <> 'pending'
      )
  ) THEN
    RAISE EXCEPTION 'REPAIR_TYPE_NOT_ENABLED' USING ERRCODE = '0A000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_reconciliation_repair_effects e
    WHERE e.repair_id = p_id
  ) THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
  END IF;

  -- Lock target product rows in a deterministic order. Official inventory
  -- operations also update these rows, so they cannot race this repair.
  PERFORM p.id
  FROM public.products p
  JOIN public.inventory_reconciliation_repair_items i
    ON i.product_id = p.id
  WHERE i.repair_id = p_id
  ORDER BY p.id
  FOR UPDATE OF p;

  IF (
    SELECT count(*)
    FROM public.products p
    JOIN public.inventory_reconciliation_repair_items i
      ON i.product_id = p.id
    WHERE i.repair_id = p_id
  ) <> v_item_count THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.inventory_reconciliation_repair_items
    WHERE repair_id = p_id
    ORDER BY product_id, line_number
    FOR UPDATE
  LOOP
    SELECT code INTO STRICT v_product_code
    FROM public.products
    WHERE id = v_item.product_id;

    v_diagnostic := public.get_inventory_reconciliation_diagnostic(
      'products', false, v_product_code, 500, 0, NULL
    );
    v_current_row := NULL;
    SELECT value INTO v_current_row
    FROM jsonb_array_elements(v_diagnostic->'rows')
    WHERE value->>'product_id' = v_item.product_id::text
    LIMIT 1;

    IF v_current_row IS NULL
       OR v_current_row->>'classification' <> 'product_balance'
       OR COALESCE((v_current_row->>'can_prepare_repair')::boolean, false) IS NOT TRUE
       OR (v_current_row->>'card_quantity')::numeric
          IS DISTINCT FROM v_item.before_card_quantity
       OR (v_current_row->>'movement_quantity')::numeric
          IS DISTINCT FROM v_item.before_movement_quantity
       OR (v_current_row->>'movement_book_value')::numeric
          IS DISTINCT FROM v_item.before_movement_book_value
       OR v_item.proposed_card_quantity
          IS DISTINCT FROM (v_current_row->>'movement_quantity')::numeric
       OR (v_item.proposed_state->>'card_quantity')::numeric
          IS DISTINCT FROM v_item.proposed_card_quantity THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
    END IF;

    v_current_hash := md5(jsonb_build_object(
      'axis', v_item.axis,
      'issue_key', v_item.issue_key,
      'diagnostic', v_current_row,
      'repair_type', v_item.repair_type,
      'proposed_state', v_item.proposed_state
    )::text);
    IF v_current_hash IS DISTINCT FROM v_item.precondition_hash THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
    END IF;

    UPDATE public.products
    SET quantity_on_hand = v_item.proposed_card_quantity
    WHERE id = v_item.product_id;

    -- Recalculate from the authoritative diagnostic after the write. A
    -- mismatch raises inside the same transaction and rolls back everything.
    v_diagnostic := public.get_inventory_reconciliation_diagnostic(
      'products', false, v_product_code, 500, 0, NULL
    );
    v_after_row := NULL;
    SELECT value INTO v_after_row
    FROM jsonb_array_elements(v_diagnostic->'rows')
    WHERE value->>'product_id' = v_item.product_id::text
    LIMIT 1;

    IF v_after_row IS NULL
       OR v_after_row->>'classification' <> 'matched'
       OR (v_after_row->>'card_quantity')::numeric
          IS DISTINCT FROM v_item.proposed_card_quantity
       OR (v_after_row->>'movement_quantity')::numeric
          IS DISTINCT FROM v_item.before_movement_quantity
       OR (v_after_row->>'movement_book_value')::numeric
          IS DISTINCT FROM v_item.before_movement_book_value
       OR (v_after_row->>'quantity_difference')::numeric <> 0 THEN
      RAISE EXCEPTION 'REPAIR_POSTCHECK_FAILED' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.inventory_reconciliation_repair_effects (
      repair_id, repair_item_id, effect_type, table_name, record_id,
      before_data, after_data
    ) VALUES (
      p_id, v_item.id, 'product_card_rebuilt', 'products', v_item.product_id,
      jsonb_build_object(
        'card_quantity', v_item.before_card_quantity,
        'movement_quantity', v_item.before_movement_quantity,
        'movement_book_value', v_item.before_movement_book_value
      ),
      jsonb_build_object(
        'card_quantity', (v_after_row->>'card_quantity')::numeric,
        'movement_quantity', (v_after_row->>'movement_quantity')::numeric,
        'movement_book_value', (v_after_row->>'movement_book_value')::numeric
      )
    );

    UPDATE public.inventory_reconciliation_repair_items
    SET after_card_quantity = (v_after_row->>'card_quantity')::numeric,
        after_movement_quantity = (v_after_row->>'movement_quantity')::numeric,
        after_movement_book_value = (v_after_row->>'movement_book_value')::numeric,
        after_state = v_after_row,
        result_status = 'applied',
        result_message = 'أعيد بناء كمية بطاقة المنتج من صافي الحركات الموقعة',
        updated_at = statement_timestamp()
    WHERE id = v_item.id;
  END LOOP;

  UPDATE public.inventory_reconciliation_repairs
  SET status = 'executed',
      executed_by = v_actor,
      executed_at = statement_timestamp(),
      version = version + 1,
      updated_at = statement_timestamp()
  WHERE id = p_id;

  v_result := public.inventory_reconciliation_repair_result(p_id);
  INSERT INTO public.inventory_reconciliation_repair_events (
    repair_id, event_type, from_status, to_status, request_id, actor_id,
    event_data
  ) VALUES (
    p_id, 'executed', 'approved', 'executed', p_request_id, v_actor,
    jsonb_build_object(
      'result', v_result,
      'executor', 'rebuild_product_card',
      'applied_items', v_item_count
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  IS 'Stage 2C executor: atomically rebuilds product card quantity from signed inventory movements after local precondition and postcondition checks.';
