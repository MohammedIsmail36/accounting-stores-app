\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'اختبار منفذ إعادة بناء بطاقة المنتج مخصص لقاعدة L3 المعزولة فقط';
  END IF;
  IF to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'REPAIR_EXECUTOR_FUNCTION_MISSING';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role')
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;

CREATE TEMP TABLE rebuild_contract_ids (name text PRIMARY KEY, id uuid NOT NULL);

DO $actors$
DECLARE
  v_admin uuid := '2c000000-0000-4000-8000-000000000001';
  v_accountant uuid := '2c000000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_admin), (v_accountant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES
    (v_admin, 'admin'), (v_accountant, 'accountant')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO rebuild_contract_ids(name, id) VALUES
    ('admin', v_admin), ('accountant', v_accountant);
END;
$actors$;

CREATE FUNCTION pg_temp.set_rebuild_actor(p_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO STRICT v_id FROM rebuild_contract_ids WHERE name = p_name;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_id)::text, true);
END;
$$;

CREATE FUNCTION pg_temp.add_rebuild_product(
  p_label text,
  p_card_quantity numeric DEFAULT 5,
  p_movement_quantity numeric DEFAULT 8,
  p_movement_value numeric DEFAULT 80
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_product uuid; v_invoice uuid;
BEGIN
  INSERT INTO public.products(
    code, name, purchase_price, selling_price, quantity_on_hand, is_active
  ) VALUES (
    '__2C_' || upper(p_label), '2C ' || p_label, 10, 15, p_card_quantity, true
  ) RETURNING id INTO v_product;

  INSERT INTO public.purchase_invoices(
    invoice_date, status, subtotal, discount, tax, total, paid_amount, notes
  ) VALUES (
    current_date, 'posted', p_movement_value, 0, 0, p_movement_value,
    p_movement_value, '__2C_' || p_label
  ) RETURNING id INTO v_invoice;

  INSERT INTO public.inventory_movements(
    product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, movement_date
  ) VALUES (
    v_product, 'purchase', p_movement_quantity,
    CASE WHEN p_movement_quantity = 0 THEN 0 ELSE p_movement_value / p_movement_quantity END,
    p_movement_value, v_invoice, 'purchase_invoice', current_date
  );
  RETURN v_product;
END;
$$;

CREATE FUNCTION pg_temp.rebuild_item(p_product uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_code text; v_row jsonb;
BEGIN
  SELECT code INTO STRICT v_code FROM public.products WHERE id = p_product;
  SELECT value INTO v_row
  FROM jsonb_array_elements(public.get_inventory_reconciliation_diagnostic(
    'products', true, v_code, 500, 0, NULL
  )->'rows')
  WHERE value->>'product_id' = p_product::text
  LIMIT 1;
  IF v_row IS NULL THEN RAISE EXCEPTION 'FIXTURE_PRODUCT_DIAGNOSTIC_MISSING'; END IF;
  RETURN jsonb_build_object(
    'axis', 'product',
    'issue_key', 'product:' || p_product::text,
    'classification', v_row->>'classification',
    'repair_type', 'rebuild_product_card',
    'product_id', p_product,
    'before_card_quantity', (v_row->>'card_quantity')::numeric,
    'before_movement_quantity', (v_row->>'movement_quantity')::numeric,
    'before_movement_book_value', (v_row->>'movement_book_value')::numeric,
    'proposed_card_quantity', (v_row->>'movement_quantity')::numeric,
    'before_state', v_row,
    'proposed_state', jsonb_build_object('card_quantity', (v_row->>'movement_quantity')::numeric)
  );
END;
$$;

CREATE FUNCTION pg_temp.prepare_approved_rebuild(p_product uuid, p_label text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_fingerprint text; v_result jsonb; v_repair uuid;
BEGIN
  PERFORM pg_temp.set_rebuild_actor('accountant');
  v_fingerprint := public.get_inventory_reconciliation_diagnostic(
    'summary', true, NULL, 100, 0, NULL
  )->>'fingerprint';
  v_result := public.create_inventory_reconciliation_repair(
    '2C ' || p_label,
    'إعادة بناء البطاقة من الحركات بعد تحقق العقد',
    v_fingerprint,
    statement_timestamp(),
    'all_recorded_stock_effects',
    jsonb_build_array(pg_temp.rebuild_item(p_product)),
    gen_random_uuid()
  );
  v_repair := (v_result->>'id')::uuid;
  PERFORM public.submit_inventory_reconciliation_repair(v_repair, 1, gen_random_uuid());
  PERFORM pg_temp.set_rebuild_actor('admin');
  PERFORM public.approve_inventory_reconciliation_repair(v_repair, 2, NULL, gen_random_uuid());
  RETURN v_repair;
END;
$$;

-- Scenario 01: نجاح إعادة بناء البطاقة من صافي الحركات وحده.
DO $scenario_01$
DECLARE v_product uuid; v_repair uuid; v_result jsonb; v_quantity numeric;
BEGIN
  v_product := pg_temp.add_rebuild_product('SUCCESS');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'نجاح');
  PERFORM pg_temp.set_rebuild_actor('admin');
  v_result := public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  SELECT quantity_on_hand INTO v_quantity FROM public.products WHERE id = v_product;
  IF v_result->>'status' <> 'executed' OR (v_result->>'version')::integer <> 4 OR v_quantity <> 8 THEN
    RAISE EXCEPTION 'REBUILD_SUCCESS_FAILED';
  END IF;
END;
$scenario_01$;

-- Scenario 02: رفض التنفيذ إذا أصبحت البطاقة مطابقة بعد المعاينة.
DO $scenario_02$
DECLARE v_product uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_product := pg_temp.add_rebuild_product('ALREADY_MATCHED');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'مطابق لاحقًا');
  UPDATE public.products SET quantity_on_hand = 8 WHERE id = v_product;
  PERFORM pg_temp.set_rebuild_actor('admin');
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_PRECONDITION_CHANGED%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'REBUILD_MATCHED_NOT_REJECTED'; END IF;
END;
$scenario_02$;

-- Scenario 03: رفض التنفيذ إذا تغيرت كمية البطاقة بعد المعاينة.
DO $scenario_03$
DECLARE v_product uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_product := pg_temp.add_rebuild_product('CARD_CHANGED');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'بطاقة تغيرت');
  UPDATE public.products SET quantity_on_hand = 6 WHERE id = v_product;
  PERFORM pg_temp.set_rebuild_actor('admin');
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_PRECONDITION_CHANGED%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'REBUILD_CARD_CHANGE_NOT_REJECTED'; END IF;
END;
$scenario_03$;

-- Scenario 04: رفض التنفيذ إذا أضيفت حركة للمنتج بعد المعاينة.
DO $scenario_04$
DECLARE v_product uuid; v_repair uuid; v_reference uuid; v_rejected boolean := false;
BEGIN
  v_product := pg_temp.add_rebuild_product('MOVEMENT_CHANGED');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'حركة تغيرت');
  SELECT reference_id INTO STRICT v_reference
  FROM public.inventory_movements WHERE product_id = v_product LIMIT 1;
  INSERT INTO public.inventory_movements(
    product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, movement_date
  ) VALUES (v_product, 'purchase', 1, 10, 10, v_reference, 'purchase_invoice', current_date);
  PERFORM pg_temp.set_rebuild_actor('admin');
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_PRECONDITION_CHANGED%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'REBUILD_MOVEMENT_CHANGE_NOT_REJECTED'; END IF;
END;
$scenario_04$;

-- Scenario 05: حركة منتج آخر لا تمنع تنفيذ المنتج المستهدف.
DO $scenario_05$
DECLARE v_product uuid; v_other uuid; v_repair uuid; v_reference uuid; v_result jsonb;
BEGIN
  v_product := pg_temp.add_rebuild_product('TARGET_LOCAL_LOCK');
  v_other := pg_temp.add_rebuild_product('UNRELATED', 2, 2, 20);
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'قفل موضعي');
  SELECT reference_id INTO STRICT v_reference
  FROM public.inventory_movements WHERE product_id = v_other LIMIT 1;
  INSERT INTO public.inventory_movements(
    product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, movement_date
  ) VALUES (v_other, 'purchase', 1, 10, 10, v_reference, 'purchase_invoice', current_date);
  PERFORM pg_temp.set_rebuild_actor('admin');
  v_result := public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  IF v_result->>'status' <> 'executed' THEN RAISE EXCEPTION 'UNRELATED_MOVEMENT_BLOCKED_TARGET'; END IF;
END;
$scenario_05$;

-- Scenario 06: نفس request_id يعيد النتيجة ولا يكرر الأثر، والطلب الجديد يرفض.
DO $scenario_06$
DECLARE
  v_product uuid; v_repair uuid;
  v_request uuid := '2c600000-0000-4000-8000-000000000001';
  v_first jsonb; v_second jsonb; v_rejected boolean := false;
BEGIN
  v_product := pg_temp.add_rebuild_product('IDEMPOTENT');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'منع التكرار');
  PERFORM pg_temp.set_rebuild_actor('admin');
  v_first := public.execute_inventory_reconciliation_repair(v_repair, 3, v_request);
  v_second := public.execute_inventory_reconciliation_repair(v_repair, 3, v_request);
  IF v_first IS DISTINCT FROM v_second
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_effects WHERE repair_id = v_repair) <> 1
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_events WHERE repair_id = v_repair AND event_type = 'executed') <> 1 THEN
    RAISE EXCEPTION 'REBUILD_IDEMPOTENCE_FAILED';
  END IF;
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 4, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_STATUS_INVALID%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'REBUILD_SECOND_EXECUTION_NOT_REJECTED'; END IF;
END;
$scenario_06$;

-- Scenario 07: التنفيذ للمدير فقط.
DO $scenario_07$
DECLARE v_product uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_product := pg_temp.add_rebuild_product('ADMIN_ONLY');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'صلاحية المدير');
  PERFORM pg_temp.set_rebuild_actor('accountant');
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'ACCOUNTANT_EXECUTED_REBUILD'; END IF;
END;
$scenario_07$;

-- Scenario 08: يحفظ الأثر والحالة بعد الفحص ولا يترك البند معلقًا.
DO $scenario_08$
DECLARE v_product uuid; v_repair uuid; v_effect record; v_item record;
BEGIN
  v_product := pg_temp.add_rebuild_product('AUDIT_EFFECT');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'أثر التدقيق');
  PERFORM pg_temp.set_rebuild_actor('admin');
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  SELECT * INTO STRICT v_effect FROM public.inventory_reconciliation_repair_effects WHERE repair_id = v_repair;
  SELECT * INTO STRICT v_item FROM public.inventory_reconciliation_repair_items WHERE repair_id = v_repair;
  IF v_effect.effect_type <> 'product_card_rebuilt' OR v_effect.table_name <> 'products'
     OR v_effect.record_id <> v_product
     OR (v_effect.before_data->>'card_quantity')::numeric <> 5
     OR (v_effect.after_data->>'card_quantity')::numeric <> 8
     OR v_item.result_status <> 'applied'
     OR v_item.after_card_quantity <> 8
     OR v_item.after_movement_quantity <> 8 THEN
    RAISE EXCEPTION 'REBUILD_EFFECT_AUDIT_INVALID';
  END IF;
END;
$scenario_08$;

-- Scenario 09: لا ينشئ حركة أو قيدًا ولا يغير تكلفة المنتج أو الحركات.
DO $scenario_09$
DECLARE
  v_product uuid; v_repair uuid; v_movement_count bigint; v_journal_count bigint;
  v_movement_signature text; v_price numeric;
BEGIN
  v_product := pg_temp.add_rebuild_product('NO_SIDE_EFFECTS');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'دون آثار جانبية');
  SELECT count(*), md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), ''))
    INTO v_movement_count, v_movement_signature FROM public.inventory_movements m;
  SELECT count(*) INTO v_journal_count FROM public.journal_entries;
  SELECT purchase_price INTO v_price FROM public.products WHERE id = v_product;
  PERFORM pg_temp.set_rebuild_actor('admin');
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  IF (SELECT count(*) FROM public.inventory_movements) <> v_movement_count
     OR (SELECT md5(COALESCE(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.inventory_movements m) <> v_movement_signature
     OR (SELECT count(*) FROM public.journal_entries) <> v_journal_count
     OR (SELECT purchase_price FROM public.products WHERE id = v_product) <> v_price THEN
    RAISE EXCEPTION 'REBUILD_CREATED_UNEXPECTED_BUSINESS_EFFECT';
  END IF;
END;
$scenario_09$;

CREATE FUNCTION pg_temp.corrupt_rebuild_result()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code = '__2C_ATOMIC_ROLLBACK' THEN
    NEW.quantity_on_hand := NEW.quantity_on_hand + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zz_rebuild_contract_corrupt
BEFORE UPDATE OF quantity_on_hand ON public.products
FOR EACH ROW EXECUTE FUNCTION pg_temp.corrupt_rebuild_result();

-- Scenario 10: فشل الفحص اللاحق يرجع تحديث المنتج والأثر والحالة ذريًا.
DO $scenario_10$
DECLARE v_product uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_product := pg_temp.add_rebuild_product('ATOMIC_ROLLBACK');
  v_repair := pg_temp.prepare_approved_rebuild(v_product, 'رجوع ذري');
  PERFORM pg_temp.set_rebuild_actor('admin');
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_POSTCHECK_FAILED%';
  END;
  IF NOT v_rejected
     OR (SELECT quantity_on_hand FROM public.products WHERE id = v_product) <> 5
     OR (SELECT status FROM public.inventory_reconciliation_repairs WHERE id = v_repair) <> 'approved'
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects WHERE repair_id = v_repair)
     OR EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_events WHERE repair_id = v_repair AND event_type = 'executed') THEN
    RAISE EXCEPTION 'REBUILD_ATOMIC_ROLLBACK_FAILED';
  END IF;
END;
$scenario_10$;

SELECT 'INVENTORY_RECONCILIATION_REBUILD_PRODUCT_CARD_CONTRACT_OK';

ROLLBACK;
