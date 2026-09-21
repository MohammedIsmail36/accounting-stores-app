\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'عقد منفذ 2D-B مخصص لقاعدة L3 المعزولة فقط';
  END IF;
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL THEN
    RAISE EXCEPTION '2D_PLANNER_REQUIRED';
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

CREATE TEMP TABLE missing_journal_executor_ids (
  name text PRIMARY KEY,
  id uuid NOT NULL
);

DO $actors_and_tax$
DECLARE
  v_admin uuid := '2d0b0000-0000-4000-8000-000000000001';
  v_accountant uuid := '2d0b0000-0000-4000-8000-000000000002';
  v_sales_tax uuid;
  v_purchase_tax uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_admin), (v_accountant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES
    (v_admin, 'admin'), (v_accountant, 'accountant')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO missing_journal_executor_ids(name, id) VALUES
    ('admin', v_admin), ('accountant', v_accountant);

  SELECT id INTO STRICT v_sales_tax FROM public.accounts WHERE code = '2102';
  SELECT id INTO STRICT v_purchase_tax FROM public.accounts WHERE code = '1105';
  UPDATE public.company_settings
  SET enable_tax = true,
      sales_tax_account_id = v_sales_tax,
      purchase_tax_account_id = v_purchase_tax,
      locked_until_date = NULL;
END;
$actors_and_tax$;

CREATE FUNCTION pg_temp.set_2db_actor(p_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO STRICT v_id FROM missing_journal_executor_ids WHERE name = p_name;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_id)::text, true);
END;
$$;

CREATE FUNCTION pg_temp.add_2db_source(
  p_source_type text,
  p_partial_journal boolean DEFAULT false,
  p_adjustment_sign integer DEFAULT 1
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_source uuid;
  v_product uuid;
  v_journal uuid;
  v_movement_type public.inventory_movement_type;
  v_movement_value numeric;
  v_quantity numeric;
  v_lines jsonb;
  v_account uuid;
BEGIN
  INSERT INTO public.products(
    code, name, purchase_price, selling_price, quantity_on_hand, is_active
  ) VALUES (
    '__2DB_' || replace(gen_random_uuid()::text, '-', ''),
    'منتج عقد منفذ 2D', 40, 60, 20, true
  ) RETURNING id INTO v_product;

  IF p_source_type = 'sales_invoice' THEN
    INSERT INTO public.sales_invoices(
      invoice_date, status, subtotal, discount, tax, total, paid_amount, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, 0, '__2DB_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'sale'; v_movement_value := 80; v_quantity := 2;
  ELSIF p_source_type = 'sales_return' THEN
    INSERT INTO public.sales_returns(
      return_date, status, subtotal, discount, tax, total, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, '__2DB_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'sale_return'; v_movement_value := 80; v_quantity := 2;
  ELSIF p_source_type = 'purchase_invoice' THEN
    INSERT INTO public.purchase_invoices(
      invoice_date, status, subtotal, discount, tax, total, paid_amount, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, 0, '__2DB_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'purchase'; v_movement_value := 100; v_quantity := 2;
  ELSIF p_source_type = 'purchase_return' THEN
    INSERT INTO public.purchase_returns(
      return_date, status, subtotal, discount, tax, total, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, '__2DB_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'purchase_return'; v_movement_value := 80; v_quantity := 2;
  ELSIF p_source_type = 'adjustment' THEN
    INSERT INTO public.inventory_adjustments(
      adjustment_date, status, description
    ) VALUES (current_date, 'posted', '__2DB_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'adjustment'; v_movement_value := 30;
    v_quantity := CASE WHEN p_adjustment_sign < 0 THEN -3 ELSE 3 END;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_2DB_FIXTURE_SOURCE';
  END IF;

  INSERT INTO public.inventory_movements(
    product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, movement_date
  ) VALUES (
    v_product, v_movement_type, v_quantity,
    v_movement_value / abs(v_quantity), v_movement_value,
    v_source, p_source_type, current_date
  );

  IF p_partial_journal THEN
    IF p_source_type <> 'sales_invoice' THEN
      RAISE EXCEPTION 'PARTIAL_2DB_FIXTURE_ONLY_SUPPORTS_SALES';
    END IF;
    SELECT id INTO STRICT v_account FROM public.accounts WHERE code = '1103';
    v_lines := jsonb_build_array(jsonb_build_object(
      'account_id', v_account, 'debit', 120, 'credit', 0));
    SELECT id INTO STRICT v_account FROM public.accounts WHERE code = '4101';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_account, 'debit', 0, 'credit', 100));
    SELECT id INTO STRICT v_account FROM public.accounts WHERE code = '2102';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_account, 'debit', 0, 'credit', 20));
    v_journal := public.create_journal_entry(
      current_date, '__2DB_PARTIAL__', v_lines, 'posted', NULL, 'regular');
    UPDATE public.sales_invoices SET journal_entry_id = v_journal WHERE id = v_source;
  END IF;

  RETURN v_source;
END;
$$;

CREATE FUNCTION pg_temp.source_journal_id(p_source_type text, p_source_id uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  CASE p_source_type
    WHEN 'sales_invoice' THEN SELECT journal_entry_id INTO v_id FROM public.sales_invoices WHERE id = p_source_id;
    WHEN 'sales_return' THEN SELECT journal_entry_id INTO v_id FROM public.sales_returns WHERE id = p_source_id;
    WHEN 'purchase_invoice' THEN SELECT journal_entry_id INTO v_id FROM public.purchase_invoices WHERE id = p_source_id;
    WHEN 'purchase_return' THEN SELECT journal_entry_id INTO v_id FROM public.purchase_returns WHERE id = p_source_id;
    WHEN 'adjustment' THEN SELECT journal_entry_id INTO v_id FROM public.inventory_adjustments WHERE id = p_source_id;
    ELSE RAISE EXCEPTION 'UNSUPPORTED_2DB_SOURCE_LOOKUP';
  END CASE;
  RETURN v_id;
END;
$$;

CREATE FUNCTION pg_temp.prepare_2db_repair(
  p_source_type text,
  p_source_id uuid,
  p_accounting_date date DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_diagnostic jsonb;
  v_row jsonb;
  v_plan jsonb;
  v_result jsonb;
  v_repair uuid;
BEGIN
  PERFORM pg_temp.set_2db_actor('accountant');
  v_diagnostic := public.get_inventory_reconciliation_diagnostic(
    'sources', true, p_source_id::text, 500, 0, NULL);
  SELECT value INTO v_row
  FROM jsonb_array_elements(v_diagnostic->'rows')
  WHERE value->>'source_type' = p_source_type
    AND value->>'source_id' = p_source_id::text
  LIMIT 1;
  IF v_row IS NULL OR v_row->>'classification' <> 'movement_without_journal' THEN
    RAISE EXCEPTION '2DB_FIXTURE_DIAGNOSTIC_MISSING';
  END IF;

  v_plan := public.get_inventory_reconciliation_journal_plan(
    p_source_type, p_source_id, p_accounting_date);
  IF COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '2DB_FIXTURE_PLAN_NOT_ELIGIBLE: %', v_plan->>'reason_code';
  END IF;

  v_result := public.create_inventory_reconciliation_repair(
    '2D-B ' || COALESCE(v_row->>'source_number', p_source_id::text),
    'إنشاء قيد تصحيحي ذري من خطة محاسبية حتمية',
    v_diagnostic->>'fingerprint', statement_timestamp(),
    'all_recorded_stock_effects',
    jsonb_build_array(jsonb_build_object(
      'axis', 'source',
      'issue_key', v_row->>'source_key',
      'classification', 'movement_without_journal',
      'repair_type', 'create_missing_inventory_journal',
      'source_type', p_source_type,
      'source_id', p_source_id,
      'proposed_state', jsonb_build_object(
        'plan_fingerprint', v_plan->>'plan_fingerprint',
        'mode', v_plan->>'mode',
        'accounting_date', v_plan->>'accounting_date',
        'correction_lines', v_plan->'correction_lines'
      )
    )), gen_random_uuid());
  v_repair := (v_result->>'id')::uuid;
  UPDATE public.inventory_reconciliation_repairs
  SET accounting_date = (v_plan->>'accounting_date')::date
  WHERE id = v_repair;
  PERFORM public.submit_inventory_reconciliation_repair(v_repair, 1, gen_random_uuid());
  PERFORM pg_temp.set_2db_actor('admin');
  PERFORM public.approve_inventory_reconciliation_repair(v_repair, 2, NULL, gen_random_uuid());
  RETURN v_repair;
END;
$$;

-- Scenario 01: المصدر بلا قيد ينشئ قيداً كاملاً مرحلاً ويربطه بالمصدر.
DO $scenario_01$
DECLARE v_source uuid; v_repair uuid; v_result jsonb; v_journal uuid;
BEGIN
  v_source := pg_temp.add_2db_source('sales_invoice');
  v_repair := pg_temp.prepare_2db_repair('sales_invoice', v_source);
  v_result := public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  v_journal := pg_temp.source_journal_id('sales_invoice', v_source);
  IF v_result->>'status' <> 'executed' OR v_journal IS NULL
     OR (SELECT status FROM public.journal_entries WHERE id = v_journal) <> 'posted' THEN
    RAISE EXCEPTION '2DB_FULL_JOURNAL_EXECUTION_FAILED';
  END IF;
END;
$scenario_01$;

-- Scenario 02: القيد الأصلي الناقص يبقى كما هو ويُنشأ قيد فرق مستقل.
DO $scenario_02$
DECLARE v_source uuid; v_original uuid; v_repair uuid; v_effect uuid;
BEGIN
  v_source := pg_temp.add_2db_source('sales_invoice', true);
  v_original := pg_temp.source_journal_id('sales_invoice', v_source);
  v_repair := pg_temp.prepare_2db_repair('sales_invoice', v_source);
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  SELECT record_id INTO v_effect
  FROM public.inventory_reconciliation_repair_effects
  WHERE repair_id = v_repair AND effect_type = 'missing_inventory_journal_created';
  IF pg_temp.source_journal_id('sales_invoice', v_source) IS DISTINCT FROM v_original
     OR v_effect IS NULL OR v_effect = v_original THEN
    RAISE EXCEPTION '2DB_DELTA_JOURNAL_PRESERVATION_FAILED';
  END IF;
END;
$scenario_02$;

-- Scenario 03: سطور القيد المنشأ تطابق خطة الفرق تماماً وتظل متوازنة.
DO $scenario_03$
DECLARE v_source uuid; v_repair uuid; v_journal uuid; v_plan jsonb; v_actual jsonb;
BEGIN
  v_source := pg_temp.add_2db_source('purchase_return');
  v_plan := public.get_inventory_reconciliation_journal_plan('purchase_return', v_source, NULL);
  v_repair := pg_temp.prepare_2db_repair('purchase_return', v_source);
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  v_journal := pg_temp.source_journal_id('purchase_return', v_source);
  SELECT jsonb_agg(jsonb_build_object('account_code', a.code, 'debit', l.debit, 'credit', l.credit)
    ORDER BY a.code) INTO v_actual
  FROM public.journal_entry_lines l JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal;
  IF v_actual IS DISTINCT FROM (
      SELECT jsonb_agg(value ORDER BY value->>'account_code')
      FROM jsonb_array_elements(v_plan->'correction_lines'))
     OR (SELECT total_debit <> total_credit FROM public.journal_entries WHERE id = v_journal) THEN
    RAISE EXCEPTION '2DB_CREATED_LINES_MISMATCH';
  END IF;
END;
$scenario_03$;

-- Scenario 04: تغير المستند بعد الاعتماد يرفض الخطة القديمة بلا إنشاء قيد.
DO $scenario_04$
DECLARE v_source uuid; v_repair uuid; v_before bigint; v_rejected boolean := false;
BEGIN
  v_source := pg_temp.add_2db_source('sales_invoice');
  v_repair := pg_temp.prepare_2db_repair('sales_invoice', v_source);
  SELECT count(*) INTO v_before FROM public.journal_entries;
  UPDATE public.sales_invoices SET subtotal = 101, total = 121 WHERE id = v_source;
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_PRECONDITION_CHANGED%';
  END;
  IF NOT v_rejected OR (SELECT count(*) FROM public.journal_entries) <> v_before THEN
    RAISE EXCEPTION '2DB_STALE_DOCUMENT_NOT_REJECTED';
  END IF;
END;
$scenario_04$;

-- Scenario 05: تغير حركة المصدر بعد الاعتماد يرفض التنفيذ بلا أثر جزئي.
DO $scenario_05$
DECLARE v_source uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_source := pg_temp.add_2db_source('purchase_invoice');
  v_repair := pg_temp.prepare_2db_repair('purchase_invoice', v_source);
  UPDATE public.inventory_movements SET total_cost = total_cost + 1 WHERE reference_id = v_source;
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_PRECONDITION_CHANGED%';
  END;
  IF NOT v_rejected OR pg_temp.source_journal_id('purchase_invoice', v_source) IS NOT NULL THEN
    RAISE EXCEPTION '2DB_STALE_MOVEMENT_NOT_REJECTED';
  END IF;
END;
$scenario_05$;

-- Scenario 06: المحاسب لا يملك تنفيذ المعالجة المعتمدة؛ التنفيذ للمدير فقط.
DO $scenario_06$
DECLARE v_source uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_source := pg_temp.add_2db_source('sales_return');
  v_repair := pg_temp.prepare_2db_repair('sales_return', v_source);
  PERFORM pg_temp.set_2db_actor('accountant');
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_ACCESS_DENIED%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION '2DB_ACCOUNTANT_EXECUTION_NOT_REJECTED'; END IF;
END;
$scenario_06$;

-- Scenario 07: نفس request_id يعيد النتيجة نفسها ولا ينشئ قيداً ثانياً.
DO $scenario_07$
DECLARE
  v_source uuid; v_repair uuid; v_request uuid := '2d0b7000-0000-4000-8000-000000000001';
  v_first jsonb; v_second jsonb; v_before bigint; v_after bigint;
BEGIN
  v_source := pg_temp.add_2db_source('adjustment', false, -1);
  v_repair := pg_temp.prepare_2db_repair('adjustment', v_source);
  SELECT count(*) INTO v_before FROM public.journal_entries;
  v_first := public.execute_inventory_reconciliation_repair(v_repair, 3, v_request);
  v_second := public.execute_inventory_reconciliation_repair(v_repair, 3, v_request);
  SELECT count(*) INTO v_after FROM public.journal_entries;
  IF v_first IS DISTINCT FROM v_second OR v_after <> v_before + 1 THEN
    RAISE EXCEPTION '2DB_IDEMPOTENCY_FAILED';
  END IF;
END;
$scenario_07$;

-- Scenario 08: طلب جديد بعد التنفيذ لا يعيد القيد مرة أخرى.
DO $scenario_08$
DECLARE v_source uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_source := pg_temp.add_2db_source('adjustment', false, 1);
  v_repair := pg_temp.prepare_2db_repair('adjustment', v_source);
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 4, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_STATUS_INVALID%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION '2DB_SECOND_EXECUTION_NOT_REJECTED'; END IF;
END;
$scenario_08$;

-- Scenario 09: قفل الفترة بعد الاعتماد يرفض التنفيذ ما لم يبق تاريخ المعالجة مفتوحاً.
DO $scenario_09$
DECLARE v_source uuid; v_repair uuid; v_rejected boolean := false;
BEGIN
  v_source := pg_temp.add_2db_source('purchase_invoice');
  v_repair := pg_temp.prepare_2db_repair('purchase_invoice', v_source);
  UPDATE public.company_settings SET locked_until_date = current_date;
  BEGIN
    PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_rejected := SQLERRM LIKE '%REPAIR_PRECONDITION_CHANGED%';
  END;
  UPDATE public.company_settings SET locked_until_date = NULL;
  IF NOT v_rejected THEN RAISE EXCEPTION '2DB_NEW_PERIOD_LOCK_NOT_REJECTED'; END IF;
END;
$scenario_09$;

-- Scenario 10: تغيير مصدر آخر لا يبطل بصمة المصدر المستهدف.
DO $scenario_10$
DECLARE v_target uuid; v_other uuid; v_repair uuid; v_result jsonb;
BEGIN
  v_target := pg_temp.add_2db_source('sales_invoice');
  v_other := pg_temp.add_2db_source('purchase_invoice');
  v_repair := pg_temp.prepare_2db_repair('sales_invoice', v_target);
  UPDATE public.purchase_invoices SET notes = '__2DB_UNRELATED_CHANGED__' WHERE id = v_other;
  v_result := public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  IF v_result->>'status' <> 'executed' THEN RAISE EXCEPTION '2DB_UNRELATED_CHANGE_BLOCKED'; END IF;
END;
$scenario_10$;

-- Scenario 11: التنفيذ لا يغير المنتجات أو الحركات ولا يعيد كتابة القيد الأصلي.
DO $scenario_11$
DECLARE v_source uuid; v_original uuid; v_repair uuid; v_before text; v_after text;
BEGIN
  v_source := pg_temp.add_2db_source('sales_invoice', true);
  v_original := pg_temp.source_journal_id('sales_invoice', v_source);
  v_repair := pg_temp.prepare_2db_repair('sales_invoice', v_source);
  SELECT md5(jsonb_build_object(
    'products', (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id)) FROM public.products p),
    'movements', (SELECT md5(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id)) FROM public.inventory_movements m),
    'original', (SELECT jsonb_build_object('header', to_jsonb(j), 'lines',
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.journal_entry_lines l WHERE l.journal_entry_id = j.id))
      FROM public.journal_entries j WHERE j.id = v_original)
  )::text) INTO v_before;
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  SELECT md5(jsonb_build_object(
    'products', (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id)) FROM public.products p),
    'movements', (SELECT md5(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id)) FROM public.inventory_movements m),
    'original', (SELECT jsonb_build_object('header', to_jsonb(j), 'lines',
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.journal_entry_lines l WHERE l.journal_entry_id = j.id))
      FROM public.journal_entries j WHERE j.id = v_original)
  )::text) INTO v_after;
  IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION '2DB_IMMUTABLE_DATA_CHANGED'; END IF;
END;
$scenario_11$;

-- Scenario 12: كل تنفيذ يسجل أثراً وحدثاً واحداً قابلين للتتبع.
DO $scenario_12$
DECLARE v_source uuid; v_repair uuid;
BEGIN
  v_source := pg_temp.add_2db_source('sales_return');
  v_repair := pg_temp.prepare_2db_repair('sales_return', v_source);
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  IF (SELECT count(*) FROM public.inventory_reconciliation_repair_effects
      WHERE repair_id = v_repair AND effect_type = 'missing_inventory_journal_created') <> 1
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_events
      WHERE repair_id = v_repair AND event_type = 'executed'
        AND event_data->>'executor' = 'create_missing_inventory_journal') <> 1 THEN
    RAISE EXCEPTION '2DB_AUDIT_TRAIL_FAILED';
  END IF;
END;
$scenario_12$;

-- Scenario 13: التشخيص والمخطط يضمان قيد الفرق فيصبح المصدر بلا فرق متبقٍ.
DO $scenario_13$
DECLARE v_source uuid; v_repair uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2db_source('sales_invoice', true);
  v_repair := pg_temp.prepare_2db_repair('sales_invoice', v_source);
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  v_plan := public.get_inventory_reconciliation_journal_plan('sales_invoice', v_source, NULL);
  IF v_plan->>'reason_code' <> 'NO_CORRECTION_REQUIRED'
     OR jsonb_array_length(COALESCE(v_plan->'correction_lines', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION '2DB_POSTCHECK_STILL_HAS_DIFFERENCE';
  END IF;
END;
$scenario_13$;

-- Scenario 14: القيد التصحيحي لا يستخدم حساباً خارج خريطة المصدر أو حساباً معلقاً.
DO $scenario_14$
DECLARE v_source uuid; v_repair uuid; v_journal uuid; v_bad integer;
BEGIN
  v_source := pg_temp.add_2db_source('purchase_return');
  v_repair := pg_temp.prepare_2db_repair('purchase_return', v_source);
  PERFORM public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  v_journal := pg_temp.source_journal_id('purchase_return', v_source);
  SELECT count(*) INTO v_bad
  FROM public.journal_entry_lines l JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal
    AND (a.code NOT IN ('1103','1104','1105','2101','2102','4101','4201','5101','5108','5201')
      OR lower(a.name) LIKE '%suspense%' OR a.name LIKE '%معلق%');
  IF v_bad <> 0 THEN RAISE EXCEPTION '2DB_SUSPENSE_OR_UNMAPPED_ACCOUNT_USED'; END IF;
END;
$scenario_14$;

SELECT 'INVENTORY_RECONCILIATION_MISSING_JOURNAL_EXECUTOR_CONTRACT_OK';

ROLLBACK;
