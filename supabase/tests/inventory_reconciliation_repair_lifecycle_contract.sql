\set ON_ERROR_STOP on

BEGIN;

DO $guard$
DECLARE
  v_table text;
  v_signature text;
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'اختبار دورة معالج المخزون مخصص لقاعدة L3 المعزولة فقط';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'inventory_reconciliation_repairs',
    'inventory_reconciliation_repair_items',
    'inventory_reconciliation_repair_effects',
    'inventory_reconciliation_repair_events'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'REPAIR_LIFECYCLE_TABLE_MISSING: %', v_table;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_inventory_reconciliation_repair(text,text,text,timestamptz,text,jsonb,uuid)',
    'public.update_inventory_reconciliation_repair(uuid,text,text,jsonb,integer,uuid)',
    'public.submit_inventory_reconciliation_repair(uuid,integer,uuid)',
    'public.approve_inventory_reconciliation_repair(uuid,integer,text,uuid)',
    'public.cancel_inventory_reconciliation_repair(uuid,text,integer,uuid)',
    'public.execute_inventory_reconciliation_repair(uuid,integer,uuid)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'REPAIR_LIFECYCLE_FUNCTION_MISSING: %', v_signature;
    END IF;
  END LOOP;
END;
$guard$;

-- تحاكي L3 هوية الطلب داخل المعاملة فقط، وتزول المحاكاة بالرجوع.
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role')
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;

CREATE TEMP TABLE repair_contract_ids (name text PRIMARY KEY, id uuid NOT NULL);

DO $actors$
DECLARE
  v_admin uuid := '20000000-0000-0000-0000-000000000001';
  v_accountant uuid := '20000000-0000-0000-0000-000000000002';
  v_seller uuid := '20000000-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_admin), (v_accountant), (v_seller)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES
    (v_admin, 'admin'), (v_accountant, 'accountant'), (v_seller, 'sales')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO repair_contract_ids(name, id) VALUES
    ('admin', v_admin), ('accountant', v_accountant), ('seller', v_seller);
END;
$actors$;

CREATE FUNCTION pg_temp.set_repair_actor(p_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO STRICT v_id FROM repair_contract_ids WHERE name = p_name;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_id)::text, true);
END;
$$;

CREATE FUNCTION pg_temp.product_item(
  p_product_id uuid,
  p_classification text DEFAULT 'product_balance',
  p_issue_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'axis', 'product',
    'issue_key', COALESCE(p_issue_key, 'product:' || p_product_id::text),
    'classification', p_classification,
    'repair_type', 'rebuild_product_card',
    'product_id', p_product_id,
    'before_card_quantity', COALESCE(p.quantity_on_hand, 0),
    'before_movement_quantity', 0,
    'before_movement_book_value', 0,
    'proposed_card_quantity', 0,
    'before_state', jsonb_build_object('card_quantity', COALESCE(p.quantity_on_hand, 0)),
    'proposed_state', jsonb_build_object('card_quantity', 0)
  )
  FROM public.products p WHERE p.id = p_product_id
$$;

DO $fixture$
DECLARE
  v_product uuid; v_matched uuid; v_idempotent uuid;
  v_duplicate uuid; v_parallel uuid;
BEGIN
  INSERT INTO public.products(code, name, purchase_price, selling_price, quantity_on_hand, is_active)
  VALUES ('__REPAIR_2B_MISMATCH', 'Repair lifecycle mismatch', 10, 15, 5, true)
  RETURNING id INTO v_product;
  INSERT INTO repair_contract_ids(name, id) VALUES ('mismatch_product', v_product);

  INSERT INTO public.products(code, name, purchase_price, selling_price, quantity_on_hand, is_active)
  VALUES ('__REPAIR_2B_MATCHED', 'Repair lifecycle matched', 10, 15, 0, true)
  RETURNING id INTO v_matched;
  INSERT INTO repair_contract_ids(name, id) VALUES ('matched_product', v_matched);

  INSERT INTO public.products(code, name, purchase_price, selling_price, quantity_on_hand, is_active)
  VALUES ('__REPAIR_2B_IDEMPOTENT', 'Repair lifecycle idempotent', 10, 15, 3, true)
  RETURNING id INTO v_idempotent;
  INSERT INTO repair_contract_ids(name, id) VALUES ('idempotent_product', v_idempotent);

  INSERT INTO public.products(code, name, purchase_price, selling_price, quantity_on_hand, is_active)
  VALUES ('__REPAIR_2B_DUPLICATE', 'Repair lifecycle duplicate', 10, 15, 4, true)
  RETURNING id INTO v_duplicate;
  INSERT INTO repair_contract_ids(name, id) VALUES ('duplicate_product', v_duplicate);

  INSERT INTO public.products(code, name, purchase_price, selling_price, quantity_on_hand, is_active)
  VALUES ('__REPAIR_2B_PARALLEL', 'Repair lifecycle parallel', 10, 15, 6, true)
  RETURNING id INTO v_parallel;
  INSERT INTO repair_contract_ids(name, id) VALUES ('parallel_product', v_parallel);
END;
$fixture$;

-- Scenario 01: البائع مرفوض من إنشاء عملية معالجة.
DO $scenario_01$
DECLARE v_product uuid; v_fingerprint text; v_rejected boolean := false;
BEGIN
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'mismatch_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  PERFORM pg_temp.set_repair_actor('seller');
  BEGIN
    PERFORM public.create_inventory_reconciliation_repair(
      'رفض البائع', 'اختبار صلاحية البائع', v_fingerprint, statement_timestamp(),
      'all_recorded_stock_effects', jsonb_build_array(pg_temp.product_item(v_product)), gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'البائع استطاع إنشاء معالجة'; END IF;
END;
$scenario_01$;

-- Scenario 02: المحاسب ينشئ مسودة صحيحة مع بند وأثر إنشاء واحد.
DO $scenario_02$
DECLARE v_product uuid; v_fingerprint text; v_result jsonb; v_repair uuid;
BEGIN
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'mismatch_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  v_result := public.create_inventory_reconciliation_repair(
    'إعادة بناء بطاقة اختبار', 'الحركات صحيحة والبطاقة وحدها مختلفة', v_fingerprint,
    statement_timestamp(), 'all_recorded_stock_effects',
    jsonb_build_array(pg_temp.product_item(v_product)),
    '21000000-0000-0000-0000-000000000001');
  v_repair := (v_result->>'id')::uuid;
  IF v_result->>'status' <> 'draft' OR (v_result->>'version')::integer <> 1 THEN
    RAISE EXCEPTION 'نتيجة إنشاء المسودة غير صحيحة';
  END IF;
  IF (SELECT count(*) FROM public.inventory_reconciliation_repair_items WHERE repair_id = v_repair) <> 1
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_events WHERE repair_id = v_repair AND event_type = 'created') <> 1 THEN
    RAISE EXCEPTION 'لم تحفظ المسودة وبندها وحدثها بصورة صحيحة';
  END IF;
  INSERT INTO repair_contract_ids(name, id) VALUES ('primary_repair', v_repair);
END;
$scenario_02$;

-- Scenario 03: المحاسب يعدل المسودة بالقفل المتفائل.
DO $scenario_03$
DECLARE v_repair uuid; v_product uuid; v_result jsonb;
BEGIN
  SELECT id INTO v_repair FROM repair_contract_ids WHERE name = 'primary_repair';
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'mismatch_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  v_result := public.update_inventory_reconciliation_repair(
    v_repair, 'عنوان محدث', 'تفسير محدث قابل للمراجعة',
    jsonb_build_array(pg_temp.product_item(v_product)), 1,
    '21000000-0000-0000-0000-000000000002');
  IF (v_result->>'version')::integer <> 2 THEN RAISE EXCEPTION 'لم يزد إصدار المسودة'; END IF;
END;
$scenario_03$;

-- Scenario 04: رفض مصدر UUID غير موجود أو لا يطابق نوعه.
DO $scenario_04$
DECLARE v_fingerprint text; v_rejected boolean := false;
BEGIN
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  BEGIN
    PERFORM public.create_inventory_reconciliation_repair(
      'مصدر غير موجود', 'يجب رفض المرجع', v_fingerprint, statement_timestamp(),
      'all_recorded_stock_effects', jsonb_build_array(jsonb_build_object(
        'axis','source','issue_key','purchase_invoice:missing','classification','movement_without_journal',
        'repair_type','create_missing_inventory_journal','source_type','purchase_invoice',
        'source_id',gen_random_uuid(),'before_state','{}'::jsonb,'proposed_state','{}'::jsonb)), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'قُبل مصدر غير موجود'; END IF;
END;
$scenario_04$;

-- Scenario 05: رفض منتج مطابق لا يحمل انحرافاً حالياً.
DO $scenario_05$
DECLARE v_product uuid; v_fingerprint text; v_rejected boolean := false;
BEGIN
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'matched_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  BEGIN
    PERFORM public.create_inventory_reconciliation_repair(
      'منتج مطابق', 'يجب رفضه', v_fingerprint, statement_timestamp(),
      'all_recorded_stock_effects', jsonb_build_array(pg_temp.product_item(v_product, 'matched')), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'قُبل منتج مطابق'; END IF;
END;
$scenario_05$;

-- Scenario 06: فرق WAC التحليلي وحده لا ينشئ بند معالجة.
DO $scenario_06$
DECLARE v_product uuid; v_fingerprint text; v_rejected boolean := false;
BEGIN
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'matched_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  BEGIN
    PERFORM public.create_inventory_reconciliation_repair(
      'فرق WAC', 'فرق تحليلي فقط', v_fingerprint, statement_timestamp(),
      'all_recorded_stock_effects', jsonb_build_array(
        pg_temp.product_item(v_product, 'matched') || jsonb_build_object('wac_to_movement_difference', 25)), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'قُبل فرق WAC كبند إصلاح'; END IF;
END;
$scenario_06$;

-- Scenario 07: رفض issue_key المكرر داخل العملية ورفض عملية نشطة موازية للانحراف نفسه.
DO $scenario_07$
DECLARE
  v_duplicate uuid; v_parallel uuid; v_fingerprint text; v_item jsonb;
  v_duplicate_rejected boolean := false; v_parallel_rejected boolean := false;
BEGIN
  SELECT id INTO v_duplicate FROM repair_contract_ids WHERE name = 'duplicate_product';
  SELECT id INTO v_parallel FROM repair_contract_ids WHERE name = 'parallel_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  v_item := pg_temp.product_item(v_duplicate);
  BEGIN
    PERFORM public.create_inventory_reconciliation_repair(
      'تكرار', 'يجب رفض البند المكرر', v_fingerprint, statement_timestamp(),
      'all_recorded_stock_effects', jsonb_build_array(v_item, v_item), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_duplicate_rejected := SQLERRM LIKE '%REPAIR_DUPLICATE_ISSUE%';
  END;
  IF NOT v_duplicate_rejected THEN RAISE EXCEPTION 'قُبل issue_key مكرر أو أعيد خطأ غير محدد'; END IF;

  v_item := pg_temp.product_item(v_parallel);
  PERFORM public.create_inventory_reconciliation_repair(
    'عملية نشطة أولى', 'حجز الانحراف للمعالجة', v_fingerprint, statement_timestamp(),
    'all_recorded_stock_effects', jsonb_build_array(v_item), gen_random_uuid());
  BEGIN
    PERFORM public.create_inventory_reconciliation_repair(
      'عملية نشطة ثانية', 'يجب رفض المعالجة المتوازية', v_fingerprint, statement_timestamp(),
      'all_recorded_stock_effects', jsonb_build_array(v_item), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_parallel_rejected := SQLERRM LIKE '%REPAIR_ISSUE_ACTIVE%';
  END;
  IF NOT v_parallel_rejected THEN
    RAISE EXCEPTION 'قُبلت عمليتان نشطتان للانحراف نفسه أو أعيد خطأ غير محدد';
  END IF;
END;
$scenario_07$;

-- Scenario 08: إرسال المسودة للمراجعة يقفل البنود ويزيد الإصدار.
DO $scenario_08$
DECLARE v_repair uuid; v_result jsonb;
BEGIN
  SELECT id INTO v_repair FROM repair_contract_ids WHERE name = 'primary_repair';
  PERFORM pg_temp.set_repair_actor('accountant');
  v_result := public.submit_inventory_reconciliation_repair(
    v_repair, 2, '21000000-0000-0000-0000-000000000003');
  IF v_result->>'status' <> 'ready_for_review' OR (v_result->>'version')::integer <> 3 THEN
    RAISE EXCEPTION 'إرسال المراجعة غير صحيح';
  END IF;
END;
$scenario_08$;

-- Scenario 09: لا يمكن تعديل البنود بعد الإرسال للمراجعة.
DO $scenario_09$
DECLARE v_repair uuid; v_product uuid; v_rejected boolean := false;
BEGIN
  SELECT id INTO v_repair FROM repair_contract_ids WHERE name = 'primary_repair';
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'mismatch_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  BEGIN
    PERFORM public.update_inventory_reconciliation_repair(
      v_repair, 'تعديل ممنوع', 'بعد الإرسال', jsonb_build_array(pg_temp.product_item(v_product)),
      3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_STATUS%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'عُدلت عملية بعد الإرسال'; END IF;
END;
$scenario_09$;

-- Scenario 10: المحاسب لا يستطيع اعتماد العملية.
DO $scenario_10$
DECLARE v_repair uuid; v_rejected boolean := false;
BEGIN
  SELECT id INTO v_repair FROM repair_contract_ids WHERE name = 'primary_repair';
  PERFORM pg_temp.set_repair_actor('accountant');
  BEGIN
    PERFORM public.approve_inventory_reconciliation_repair(v_repair, 3, NULL, gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'المحاسب استطاع الاعتماد'; END IF;
END;
$scenario_10$;

-- Scenario 11: المدير يعتمد نسخة المراجعة الصحيحة.
DO $scenario_11$
DECLARE v_repair uuid; v_result jsonb;
BEGIN
  SELECT id INTO v_repair FROM repair_contract_ids WHERE name = 'primary_repair';
  PERFORM pg_temp.set_repair_actor('admin');
  v_result := public.approve_inventory_reconciliation_repair(
    v_repair, 3, NULL,
    '21000000-0000-0000-0000-000000000004');
  IF v_result->>'status' <> 'approved' OR (v_result->>'version')::integer <> 4 THEN
    RAISE EXCEPTION 'اعتماد المدير غير صحيح';
  END IF;
END;
$scenario_11$;

-- Scenario 12: رفض أمر يعتمد على version قديم.
DO $scenario_12$
DECLARE v_repair uuid; v_rejected boolean := false;
BEGIN
  SELECT id INTO v_repair FROM repair_contract_ids WHERE name = 'primary_repair';
  PERFORM pg_temp.set_repair_actor('admin');
  BEGIN
    PERFORM public.cancel_inventory_reconciliation_repair(v_repair, 'إصدار قديم', 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_VERSION_CONFLICT%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'لم يُرفض الإصدار القديم'; END IF;
END;
$scenario_12$;

-- Scenario 13: request_id نفسه يعيد نتيجة الإنشاء والإرسال بلا عملية أو حدث إضافي.
DO $scenario_13$
DECLARE
  v_product uuid; v_fingerprint text; v_first_create jsonb; v_second_create jsonb;
  v_first_submit jsonb; v_second_submit jsonb; v_repair uuid;
BEGIN
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'idempotent_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  v_first_create := public.create_inventory_reconciliation_repair(
    'اختبار التكرار', 'إعادة إرسال آمنة', v_fingerprint, statement_timestamp(),
    'all_recorded_stock_effects', jsonb_build_array(pg_temp.product_item(v_product)),
    '21000000-0000-0000-0000-000000000005');
  v_second_create := public.create_inventory_reconciliation_repair(
    'اختبار التكرار', 'إعادة إرسال آمنة', v_fingerprint, statement_timestamp(),
    'all_recorded_stock_effects', jsonb_build_array(pg_temp.product_item(v_product)),
    '21000000-0000-0000-0000-000000000005');
  v_repair := (v_first_create->>'id')::uuid;
  IF v_first_create IS DISTINCT FROM v_second_create
     OR (SELECT count(*) FROM public.inventory_reconciliation_repairs WHERE id = v_repair) <> 1
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_events
         WHERE request_id = '21000000-0000-0000-0000-000000000005') <> 1 THEN
    RAISE EXCEPTION 'إعادة إنشاء request_id ليست آمنة';
  END IF;
  v_first_submit := public.submit_inventory_reconciliation_repair(
    v_repair, 1, '21000000-0000-0000-0000-000000000006');
  v_second_submit := public.submit_inventory_reconciliation_repair(
    v_repair, 1, '21000000-0000-0000-0000-000000000006');
  IF v_first_submit IS DISTINCT FROM v_second_submit
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_events
         WHERE request_id = '21000000-0000-0000-0000-000000000006') <> 1 THEN
    RAISE EXCEPTION 'إعادة إرسال request_id ليست آمنة';
  END IF;
END;
$scenario_13$;

-- Scenario 14: منفذ الإصلاح محجوب في 2B ولا يغير بيانات الأعمال.
DO $scenario_14$
DECLARE v_repair uuid; v_before numeric; v_after numeric; v_rejected boolean := false;
BEGIN
  SELECT id INTO v_repair FROM repair_contract_ids WHERE name = 'primary_repair';
  SELECT sum(quantity_on_hand) INTO v_before FROM public.products;
  PERFORM pg_temp.set_repair_actor('admin');
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 4, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_TYPE_NOT_ENABLED%';
  END;
  SELECT sum(quantity_on_hand) INTO v_after FROM public.products;
  IF NOT v_rejected OR v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'منفذ 2B غير محجوب أو غيّر بيانات الأعمال';
  END IF;
END;
$scenario_14$;

-- Scenario 15: إلغاء المسودة يحفظها ولا يحذفها.
DO $scenario_15$
DECLARE v_product uuid; v_fingerprint text; v_created jsonb; v_result jsonb; v_repair uuid;
BEGIN
  SELECT id INTO v_product FROM repair_contract_ids WHERE name = 'mismatch_product';
  PERFORM pg_temp.set_repair_actor('accountant');
  SELECT public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL)->>'fingerprint'
  INTO v_fingerprint;
  v_created := public.create_inventory_reconciliation_repair(
    'مسودة للإلغاء', 'اختبار عدم الحذف', v_fingerprint, statement_timestamp(),
    'all_recorded_stock_effects', jsonb_build_array(pg_temp.product_item(v_product)), gen_random_uuid());
  v_repair := (v_created->>'id')::uuid;
  v_result := public.cancel_inventory_reconciliation_repair(
    v_repair, 'لم تعد مطلوبة', 1, gen_random_uuid());
  IF v_result->>'status' <> 'cancelled'
     OR NOT EXISTS (SELECT 1 FROM public.inventory_reconciliation_repairs WHERE id = v_repair) THEN
    RAISE EXCEPTION 'إلغاء المسودة حذف السجل أو لم يغير الحالة';
  END IF;
END;
$scenario_15$;

-- Scenario 16: RLS والمنح تمنع DML المباشر وتبقى جداول الأعمال بلا آثار إصلاح.
DO $scenario_16$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'inventory_reconciliation_repairs', 'inventory_reconciliation_repair_items',
    'inventory_reconciliation_repair_effects', 'inventory_reconciliation_repair_events'
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_table)::regclass) THEN
      RAISE EXCEPTION 'RLS غير مفعلة على %', v_table;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'يوجد DML مباشر غير مسموح على %', v_table;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects) THEN
    RAISE EXCEPTION 'أنشأت مرحلة 2B آثار أعمال رغم أن التنفيذ محجوب';
  END IF;
END;
$scenario_16$;

SELECT 'INVENTORY_RECONCILIATION_REPAIR_LIFECYCLE_CONTRACT_OK' AS result;

ROLLBACK;
