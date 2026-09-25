DO $scenarios$
DECLARE
  v_admin uuid;
  v_sales uuid;
  v_product uuid;
  v_quantity numeric;
  v_id uuid;
  v_updated timestamptz;
  v_payload jsonb;
  v_result jsonb;
  v_message text;
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres'
     OR has_function_privilege('anon',
       'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)',
       'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.save_inventory_adjustment_draft_with_reasons(uuid,timestamptz,date,text,jsonb)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_TEST_ISOLATION_OR_GRANT_FAILED';
  END IF;
  SELECT user_id INTO v_admin FROM public.user_roles WHERE role='admin' LIMIT 1;
  SELECT user_id INTO v_sales FROM public.user_roles WHERE role='sales' LIMIT 1;
  SELECT id,quantity_on_hand INTO v_product,v_quantity
  FROM public.products WHERE is_active ORDER BY id LIMIT 1;
  IF v_admin IS NULL OR v_sales IS NULL OR v_product IS NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_FIXTURE_MISSING';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  v_payload := jsonb_build_array(jsonb_build_object(
    'product_id',v_product,'system_quantity',v_quantity,
    'actual_quantity',v_quantity+1,'unit_cost',10,
    'reason_code','found_stock','notes','كمية مثبتة'));
  v_result := public.save_inventory_adjustment_draft_with_reasons(
    NULL,NULL,CURRENT_DATE,'reason-test',v_payload);
  v_id := (v_result->>'adjustment_id')::uuid;
  v_updated := (v_result->>'updated_at')::timestamptz;
  IF v_id IS NULL OR v_updated IS NULL
     OR (SELECT reason_code FROM public.inventory_adjustment_items
       WHERE adjustment_id=v_id) <> 'found_stock'
     OR (SELECT reason_reference FROM public.inventory_adjustment_items
       WHERE adjustment_id=v_id) IS NOT NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_CREATE_FAILED';
  END IF;

  v_payload := jsonb_build_array(jsonb_build_object(
    'product_id',v_product,'system_quantity',v_quantity,
    'actual_quantity',v_quantity+2,'unit_cost',10,
    'reason_code','prior_entry_error','reason_reference','PUR-TEST-001',
    'notes','تصحيح إدخال سابق'));
  v_result := public.save_inventory_adjustment_draft_with_reasons(
    v_id,v_updated,CURRENT_DATE,'reason-edited',v_payload);
  v_updated := (v_result->>'updated_at')::timestamptz;
  IF (SELECT reason_code FROM public.inventory_adjustment_items
      WHERE adjustment_id=v_id) <> 'prior_entry_error'
     OR (SELECT reason_reference FROM public.inventory_adjustment_items
       WHERE adjustment_id=v_id) <> 'PUR-TEST-001'
     OR (SELECT count(*) FROM public.inventory_adjustment_items
       WHERE adjustment_id=v_id) <> 1 THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_EDIT_FAILED';
  END IF;

  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated - interval '1 second',CURRENT_DATE,'stale',v_payload);
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_STALE_VERSION_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_VERSION_CHANGED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated,CURRENT_DATE,'duplicate',v_payload || v_payload);
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_DUPLICATE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_DUPLICATE_PRODUCT' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated,CURRENT_DATE,'injected failure',jsonb_build_array(
        jsonb_set(v_payload->0,'{notes}','"FORCE_FAIL"'::jsonb)));
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_INJECTED_FAILURE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'DRAFT_SAVE_INJECTED_INSERT_FAILURE' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.inventory_adjustment_items SET reason_code='invented'
    WHERE adjustment_id=v_id;
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_DIRECT_INVALID_CODE_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated,CURRENT_DATE,'missing',jsonb_build_array(
        (v_payload->0) - 'reason_code'));
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_MISSING_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_REASON_REQUIRED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated,CURRENT_DATE,'invalid',jsonb_build_array(
        jsonb_set(v_payload->0,'{reason_code}','"invented"'::jsonb)));
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_INVALID_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_REASON_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated,CURRENT_DATE,'reference missing',jsonb_build_array(
        (v_payload->0) - 'reason_reference'));
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_REFERENCE_MISSING_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_REASON_REFERENCE_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated,CURRENT_DATE,'note missing',jsonb_build_array(
        (v_payload->0) - 'notes'));
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_NOTE_MISSING_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_REASON_REQUIRED' THEN RAISE; END IF;
  END;
  IF (SELECT description FROM public.inventory_adjustments WHERE id=v_id) <> 'reason-edited'
     OR (SELECT reason_code FROM public.inventory_adjustment_items
       WHERE adjustment_id=v_id) <> 'prior_entry_error' THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_REJECTION_LEFT_PARTIAL_WRITE';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_sales::text,true);
  BEGIN
    PERFORM public.save_inventory_adjustment_draft_with_reasons(
      v_id,v_updated,CURRENT_DATE,'unauthorized',v_payload);
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_UNAUTHORIZED_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_DRAFT_PERMISSION_DENIED' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  -- The old RPC may still save a legacy draft during the UI cutover, but it
  -- must not be postable until the user resaves it with a structured reason.
  v_result := public.save_inventory_adjustment_draft(
    v_id,v_updated,CURRENT_DATE,'legacy draft',jsonb_build_array(
      (v_payload->0) - 'reason_code' - 'reason_reference'));
  BEGIN
    UPDATE public.inventory_adjustments SET status='posted' WHERE id=v_id;
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_UNCATEGORIZED_POST_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVENTORY_VARIANCE_REASON_CODE_REQUIRED' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.inventory_adjustments WHERE id=v_id) <> 'draft' THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_POST_REJECTION_CHANGED_STATUS';
  END IF;
  v_result := public.save_inventory_adjustment_draft_with_reasons(
    v_id,(v_result->>'updated_at')::timestamptz,
    CURRENT_DATE,'categorized again',v_payload);
  UPDATE public.inventory_adjustments SET status='posted' WHERE id=v_id;
  IF (SELECT status FROM public.inventory_adjustments WHERE id=v_id) <> 'posted' THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_VALID_POST_REJECTED';
  END IF;
  DELETE FROM public.inventory_adjustments WHERE id=v_id;

  v_result := public.save_inventory_adjustment_draft_with_reasons(
    NULL,NULL,CURRENT_DATE,'zero difference',jsonb_build_array(
      jsonb_build_object('product_id',v_product,'system_quantity',v_quantity,
        'actual_quantity',v_quantity,'unit_cost',10,'notes','مطابقة')));
  v_id := (v_result->>'adjustment_id')::uuid;
  IF (SELECT reason_code FROM public.inventory_adjustment_items
      WHERE adjustment_id=v_id) IS NOT NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASONS_ZERO_DIFFERENCE_CATEGORIZED';
  END IF;
  UPDATE public.inventory_adjustments SET status='posted' WHERE id=v_id;
  DELETE FROM public.inventory_adjustments WHERE id=v_id;
END;
$scenarios$;

SELECT 'INVENTORY_ADJUSTMENT_REASON_SCENARIOS_OK';
