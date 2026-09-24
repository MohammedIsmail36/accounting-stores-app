-- Append after the base contract's final ROLLBACK has been removed by the
-- isolated runner. This entire file still executes in the same outer BEGIN.
DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore'
     OR to_regprocedure('public.post_inventory_adjustment_atomic_base(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic_base(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_HARDENING_TEST_ISOLATION_FAILED';
  END IF;
  IF has_function_privilege('anon',
       'public.post_inventory_adjustment_atomic(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.apply_inventory_variance_effects_internal(uuid,text,uuid,date,jsonb,jsonb,text,uuid)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.post_inventory_adjustment_atomic_base(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_HARDENING_PRIVILEGE_LEAK';
  END IF;
END $guard$;

-- A changed original journal cannot be reversed using today's altered lines.
DO $journal_tamper$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();r jsonb;j uuid;
  line_id uuid;old_description text;err text;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-497';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q,q-1,-1,'اختبار حراسة القيد');
  r:=public.post_inventory_adjustment_atomic(d,gen_random_uuid());
  j:=(r->>'journal_entry_id')::uuid;
  SELECT id,description INTO line_id,old_description FROM public.journal_entry_lines
    WHERE journal_entry_id=j ORDER BY id LIMIT 1;
  UPDATE public.journal_entry_lines SET description='قيد تغير بعد الترحيل'
    WHERE id=line_id;
  BEGIN
    PERFORM public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'محاولة عكس قيد متغير');
    RAISE EXCEPTION 'JOURNAL_TAMPER_REJECTION_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    IF err <> 'INVENTORY_VARIANCE_ORIGINAL_JOURNAL_CHANGED'
    THEN RAISE EXCEPTION 'JOURNAL_TAMPER_WRONG_ERROR %',err; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.inventory_variance_operations
      WHERE source_id=d AND operation_kind='reverse')
  THEN RAISE EXCEPTION 'JOURNAL_TAMPER_PARTIAL_REVERSAL'; END IF;
  UPDATE public.journal_entry_lines SET description=old_description WHERE id=line_id;
  PERFORM public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس بعد تصحيح القيد');
END $journal_tamper$;

-- Model a subsequent sale with a signed movement as well as a changed card.
-- The data are deliberately temporary and disappear at the outer ROLLBACK.
DO $later_sale$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();err text;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-700';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q,q+1,1,'اختبار استخدام لاحق');
  PERFORM public.post_inventory_adjustment_atomic(d,gen_random_uuid());
  INSERT INTO public.inventory_movements(
    product_id,movement_type,quantity,unit_cost,total_cost,
    reference_type,movement_date,notes
  ) VALUES(p,'sale',q+1,1,q+1,'staging_seed',CURRENT_DATE,'حركة اختبار لاحقة');
  UPDATE public.products SET quantity_on_hand=0 WHERE id=p;
  BEGIN
    PERFORM public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس غير آمن');
    RAISE EXCEPTION 'NEGATIVE_REVERSAL_REJECTION_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
    IF err <> 'INVENTORY_VARIANCE_REVERSAL_NEGATIVE_STOCK'
    THEN RAISE EXCEPTION 'NEGATIVE_REVERSAL_WRONG_ERROR %',err; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.inventory_variance_operations
      WHERE source_id=d AND operation_kind='reverse')
  THEN RAISE EXCEPTION 'NEGATIVE_REVERSAL_PARTIAL_EFFECT'; END IF;
END $later_sale$;

SELECT 'INVENTORY_ATOMIC_VARIANCE_HARDENING_OK';
ROLLBACK;
