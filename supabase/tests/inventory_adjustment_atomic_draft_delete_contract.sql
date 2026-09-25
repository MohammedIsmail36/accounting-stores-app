DO $contract$
DECLARE
  v_admin uuid;
  v_sales uuid;
  v_product uuid;
  v_quantity numeric;
  v_id uuid;
  v_version timestamptz;
  v_result jsonb;
  v_message text;
  v_items jsonb;
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres'
     OR has_table_privilege('authenticated','public.inventory_adjustments','DELETE')
     OR has_table_privilege('authenticated','public.inventory_adjustment_items','DELETE')
     OR has_function_privilege('anon', 'public.delete_inventory_adjustment_draft(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.delete_inventory_adjustment_draft(uuid,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.delete_inventory_adjustment_draft(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DRAFT_DELETE_ISOLATION_OR_ACL_FAILED';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT user_id INTO v_sales FROM public.user_roles WHERE role='sales' LIMIT 1;
  SELECT id, quantity_on_hand INTO v_product, v_quantity
  FROM public.products WHERE is_active ORDER BY id LIMIT 1;
  IF v_admin IS NULL OR v_sales IS NULL OR v_product IS NULL THEN
    RAISE EXCEPTION 'DRAFT_DELETE_FIXTURE_MISSING';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  v_items := jsonb_build_array(jsonb_build_object(
    'product_id',v_product,'system_quantity',v_quantity,
    'actual_quantity',v_quantity+1,'unit_cost',10,'notes','safe'));
  v_result := public.save_inventory_adjustment_draft(NULL,NULL,CURRENT_DATE,'delete test',v_items);
  v_id := (v_result->>'adjustment_id')::uuid;
  v_version := (v_result->>'updated_at')::timestamptz;

  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,v_version - interval '1 second');
    RAISE EXCEPTION 'DRAFT_DELETE_STALE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_DELETE_VERSION_CHANGED' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_sales::text,true);
  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,v_version);
    RAISE EXCEPTION 'DRAFT_DELETE_NON_ADMIN_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_DELETE_PERMISSION_DENIED' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  UPDATE public.inventory_adjustments SET status='posted' WHERE id=v_id;
  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,
      (SELECT updated_at FROM public.inventory_adjustments WHERE id=v_id));
    RAISE EXCEPTION 'DRAFT_DELETE_POSTED_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_DELETE_STATUS_CHANGED' THEN RAISE; END IF;
  END;
  UPDATE public.inventory_adjustments SET status='draft' WHERE id=v_id;
  INSERT INTO public.inventory_variance_operations(source_type,source_id)
  VALUES ('adjustment',v_id);
  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,
      (SELECT updated_at FROM public.inventory_adjustments WHERE id=v_id));
    RAISE EXCEPTION 'DRAFT_DELETE_OPERATION_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_DELETE_STATUS_CHANGED' THEN RAISE; END IF;
  END;
  DELETE FROM public.inventory_variance_operations
  WHERE source_type='adjustment' AND source_id=v_id;

  -- A failing child cascade must restore the parent as well.
  UPDATE public.inventory_adjustment_items SET notes='FORCE_DELETE_FAIL'
  WHERE adjustment_id=v_id;
  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,
      (SELECT updated_at FROM public.inventory_adjustments WHERE id=v_id));
    RAISE EXCEPTION 'DRAFT_DELETE_PARTIAL_FAILURE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'DRAFT_DELETE_INJECTED_CHILD_FAILURE' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE id=v_id)
     OR (SELECT count(*) FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) <> 1 THEN
    RAISE EXCEPTION 'DRAFT_DELETE_PARTIAL_WRITE_LEFT_BEHIND';
  END IF;
  UPDATE public.inventory_adjustment_items SET notes='safe' WHERE adjustment_id=v_id;
  v_result := public.delete_inventory_adjustment_draft(v_id,
    (SELECT updated_at FROM public.inventory_adjustments WHERE id=v_id));
  IF v_result->>'deleted' <> 'true'
     OR (v_result->>'adjustment_id')::uuid <> v_id
     OR EXISTS (SELECT 1 FROM public.inventory_adjustments WHERE id=v_id)
     OR EXISTS (SELECT 1 FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) THEN
    RAISE EXCEPTION 'DRAFT_DELETE_CASCADE_FAILED';
  END IF;
  BEGIN
    PERFORM public.delete_inventory_adjustment_draft(v_id,v_version);
    RAISE EXCEPTION 'DRAFT_DELETE_REPEAT_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_DELETE_NOT_FOUND' THEN RAISE; END IF;
  END;
END;
$contract$;
SELECT 'INVENTORY_DRAFT_DELETE_CONTRACT_OK';
