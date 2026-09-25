DO $contract$
DECLARE
  v_admin uuid;
  v_sales uuid;
  v_ids uuid[];
  v_quantities numeric[];
  v_items jsonb;
  v_result jsonb;
  v_id uuid;
  v_timestamp timestamptz;
  v_message text;
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres'
     OR to_regprocedure('public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)') IS NULL
     OR has_function_privilege('anon', 'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DRAFT_SAVE_TEST_ISOLATION_OR_GRANT_FAILED';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role = 'admin' LIMIT 1;
  SELECT user_id INTO v_sales FROM public.user_roles WHERE role = 'sales' LIMIT 1;
  SELECT array_agg(id ORDER BY id), array_agg(quantity_on_hand ORDER BY id)
  INTO v_ids, v_quantities FROM (
    SELECT id, quantity_on_hand FROM public.products WHERE is_active ORDER BY id LIMIT 2
  ) p;
  IF v_admin IS NULL OR v_sales IS NULL OR array_length(v_ids,1) <> 2 THEN
    RAISE EXCEPTION 'DRAFT_SAVE_TEST_FIXTURE_MISSING';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  v_items := jsonb_build_array(
    jsonb_build_object('product_id',v_ids[1],'system_quantity',v_quantities[1],
      'actual_quantity',v_quantities[1]+1,'unit_cost',10,'notes','فائض تجريبي'),
    jsonb_build_object('product_id',v_ids[2],'system_quantity',v_quantities[2],
      'actual_quantity',v_quantities[2],'unit_cost',10,'notes','مطابق')
  );
  v_result := public.save_inventory_adjustment_draft(NULL,NULL,CURRENT_DATE,'new',v_items);
  v_id := (v_result->>'adjustment_id')::uuid;
  v_timestamp := (v_result->>'updated_at')::timestamptz;
  IF v_id IS NULL OR v_timestamp IS NULL OR v_result->>'status' <> 'draft'
     OR (SELECT count(*) FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) <> 2
     OR (SELECT created_by FROM public.inventory_adjustments WHERE id=v_id) <> v_admin
     OR (SELECT posted_number FROM public.inventory_adjustments WHERE id=v_id) IS NOT NULL THEN
    RAISE EXCEPTION 'DRAFT_SAVE_CREATE_FAILED';
  END IF;

  v_items := jsonb_build_array(jsonb_build_object(
    'product_id',v_ids[1],'system_quantity',v_quantities[1],
    'actual_quantity',v_quantities[1]+2,'unit_cost',10,'notes','تعديل تجريبي'));
  v_result := public.save_inventory_adjustment_draft(v_id,v_timestamp,CURRENT_DATE,'edited',v_items);
  IF (SELECT description FROM public.inventory_adjustments WHERE id=v_id) <> 'edited'
     OR (SELECT count(*) FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) <> 1
     OR (SELECT difference FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) <> 2
     OR (SELECT total_cost FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) <> 20 THEN
    RAISE EXCEPTION 'DRAFT_SAVE_REPLACE_FAILED';
  END IF;

  BEGIN
    PERFORM public.save_inventory_adjustment_draft(v_id,v_timestamp - interval '1 second',
      CURRENT_DATE,'stale',v_items);
    RAISE EXCEPTION 'DRAFT_SAVE_STALE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_VERSION_CHANGED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft(v_id,(v_result->>'updated_at')::timestamptz,
      CURRENT_DATE,'duplicate',v_items || v_items);
    RAISE EXCEPTION 'DRAFT_SAVE_DUPLICATE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_DUPLICATE_PRODUCT' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft(v_id,(v_result->>'updated_at')::timestamptz,
      CURRENT_DATE,'changed stock',jsonb_build_array(jsonb_build_object(
        'product_id',v_ids[1],'system_quantity',v_quantities[1]+1,
        'actual_quantity',v_quantities[1]+2,'unit_cost',10)));
    RAISE EXCEPTION 'DRAFT_SAVE_STOCK_CHANGE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_STOCK_CHANGED' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.save_inventory_adjustment_draft(v_id,(v_result->>'updated_at')::timestamptz,
      CURRENT_DATE,'should rollback',jsonb_build_array(jsonb_build_object(
        'product_id',v_ids[1],'system_quantity',v_quantities[1],
        'actual_quantity',v_quantities[1]+3,'unit_cost',10,'notes','FORCE_FAIL')));
    RAISE EXCEPTION 'DRAFT_SAVE_INSERT_FAILURE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'DRAFT_SAVE_INJECTED_INSERT_FAILURE' THEN RAISE; END IF;
  END;
  IF (SELECT description FROM public.inventory_adjustments WHERE id=v_id) <> 'edited'
     OR (SELECT count(*) FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) <> 1
     OR (SELECT notes FROM public.inventory_adjustment_items WHERE adjustment_id=v_id) <> 'تعديل تجريبي' THEN
    RAISE EXCEPTION 'DRAFT_SAVE_PARTIAL_WRITE_LEFT_BEHIND';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_sales::text,true);
  BEGIN
    PERFORM public.save_inventory_adjustment_draft(v_id,(v_result->>'updated_at')::timestamptz,
      CURRENT_DATE,'unauthorized',v_items);
    RAISE EXCEPTION 'DRAFT_SAVE_UNAUTHORIZED_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_PERMISSION_DENIED' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  UPDATE public.inventory_adjustments SET status='posted' WHERE id=v_id;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft(v_id,
      (SELECT updated_at FROM public.inventory_adjustments WHERE id=v_id),
      CURRENT_DATE,'posted edited',v_items);
    RAISE EXCEPTION 'DRAFT_SAVE_POSTED_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_STATUS_CHANGED' THEN RAISE; END IF;
  END;
END;
$contract$;

SELECT 'INVENTORY_DRAFT_SAVE_CONTRACT_OK';
