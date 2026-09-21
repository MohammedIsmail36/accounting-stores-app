\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'عقد مخطط 2D مخصص لقاعدة L3 المعزولة فقط';
  END IF;
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_JOURNAL_PLAN_MISSING';
  END IF;
END;
$guard$;

CREATE TEMP TABLE missing_journal_contract_ids (
  name text PRIMARY KEY,
  id uuid NOT NULL
);

DO $actors_and_tax$
DECLARE
  v_admin uuid := '2d000000-0000-4000-8000-000000000001';
  v_sales_tax uuid;
  v_purchase_tax uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_admin) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(user_id, role)
  VALUES (v_admin, 'admin') ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO missing_journal_contract_ids(name, id) VALUES ('admin', v_admin);

  SELECT id INTO STRICT v_sales_tax FROM public.accounts WHERE code = '2102';
  SELECT id INTO STRICT v_purchase_tax FROM public.accounts WHERE code = '1105';
  UPDATE public.company_settings
  SET enable_tax = true,
      sales_tax_account_id = v_sales_tax,
      purchase_tax_account_id = v_purchase_tax,
      locked_until_date = NULL;
END;
$actors_and_tax$;

CREATE FUNCTION pg_temp.set_2d_admin()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT id INTO STRICT v_admin FROM missing_journal_contract_ids WHERE name = 'admin';
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin)::text, true);
END;
$$;

CREATE FUNCTION pg_temp.add_2d_source(
  p_source_type text,
  p_journal_mode text DEFAULT 'none',
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
  v_customers uuid;
  v_revenue uuid;
  v_sales_tax uuid;
  v_cogs uuid;
  v_cash uuid;
BEGIN
  IF p_source_type NOT IN (
    'sales_invoice', 'sales_return', 'purchase_invoice',
    'purchase_return', 'adjustment'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_FIXTURE_SOURCE';
  END IF;
  IF p_journal_mode NOT IN ('none', 'posted_missing_inventory', 'draft', 'unexpected_delta') THEN
    RAISE EXCEPTION 'UNSUPPORTED_FIXTURE_JOURNAL_MODE';
  END IF;

  INSERT INTO public.products(
    code, name, purchase_price, selling_price, quantity_on_hand, is_active
  ) VALUES (
    '__2D_' || replace(gen_random_uuid()::text, '-', ''),
    'منتج عقد 2D', 40, 60, 20, true
  ) RETURNING id INTO v_product;

  IF p_source_type = 'sales_invoice' THEN
    INSERT INTO public.sales_invoices(
      invoice_date, status, subtotal, discount, tax, total, paid_amount, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, 0, '__2D_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'sale'; v_movement_value := 80; v_quantity := 2;
  ELSIF p_source_type = 'sales_return' THEN
    INSERT INTO public.sales_returns(
      return_date, status, subtotal, discount, tax, total, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, '__2D_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'sale_return'; v_movement_value := 80; v_quantity := 2;
  ELSIF p_source_type = 'purchase_invoice' THEN
    INSERT INTO public.purchase_invoices(
      invoice_date, status, subtotal, discount, tax, total, paid_amount, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, 0, '__2D_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'purchase'; v_movement_value := 100; v_quantity := 2;
  ELSIF p_source_type = 'purchase_return' THEN
    INSERT INTO public.purchase_returns(
      return_date, status, subtotal, discount, tax, total, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, '__2D_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'purchase_return'; v_movement_value := 80; v_quantity := 2;
  ELSE
    INSERT INTO public.inventory_adjustments(
      adjustment_date, status, description
    ) VALUES (current_date, 'posted', '__2D_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'adjustment'; v_movement_value := 30;
    v_quantity := CASE WHEN p_adjustment_sign < 0 THEN -3 ELSE 3 END;
  END IF;

  INSERT INTO public.inventory_movements(
    product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, movement_date
  ) VALUES (
    v_product, v_movement_type, v_quantity,
    v_movement_value / abs(v_quantity), v_movement_value,
    v_source, p_source_type, current_date
  );

  IF p_journal_mode <> 'none' THEN
    SELECT id INTO STRICT v_customers FROM public.accounts WHERE code = '1103';
    SELECT id INTO STRICT v_revenue FROM public.accounts WHERE code = '4101';
    SELECT id INTO STRICT v_sales_tax FROM public.accounts WHERE code = '2102';
    SELECT id INTO STRICT v_cogs FROM public.accounts WHERE code = '5101';
    SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';

    IF p_source_type <> 'sales_invoice' THEN
      RAISE EXCEPTION 'PARTIAL_JOURNAL_FIXTURE_ONLY_SUPPORTS_SALES_INVOICE';
    END IF;

    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_customers, 'debit', 120, 'credit', 0),
      jsonb_build_object('account_id', v_revenue, 'debit', 0, 'credit', 100),
      jsonb_build_object('account_id', v_sales_tax, 'debit', 0, 'credit', 20)
    );
    IF p_journal_mode = 'unexpected_delta' THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', v_cogs, 'debit', 80, 'credit', 0),
        jsonb_build_object('account_id', v_cash, 'debit', 0, 'credit', 80)
      );
    END IF;
    v_journal := public.create_journal_entry(
      current_date, '__2D_CONTRACT__', v_lines,
      CASE WHEN p_journal_mode = 'draft' THEN 'draft' ELSE 'posted' END,
      NULL, 'regular'
    );
    UPDATE public.sales_invoices SET journal_entry_id = v_journal WHERE id = v_source;
  END IF;

  RETURN v_source;
END;
$$;

CREATE FUNCTION pg_temp.plan_2d(
  p_source_type text,
  p_source_id uuid,
  p_accounting_date date DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.get_inventory_reconciliation_journal_plan(
    p_source_type, p_source_id, p_accounting_date
  )
$$;

CREATE FUNCTION pg_temp.plan_has_line(
  p_plan jsonb,
  p_code text,
  p_debit numeric,
  p_credit numeric
)
RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_plan->'correction_lines', '[]'::jsonb)) line
    WHERE line->>'account_code' = p_code
      AND round(COALESCE((line->>'debit')::numeric, 0), 2) = round(p_debit, 2)
      AND round(COALESCE((line->>'credit')::numeric, 0), 2) = round(p_credit, 2)
  )
$$;

-- Scenario 01: فاتورة بيع بلا قيد تنتج القيد الكامل المتوقع.
DO $scenario_01$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('sales_invoice');
  v_plan := pg_temp.plan_2d('sales_invoice', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE OR v_plan->>'mode' <> 'create_full_journal'
     OR NOT pg_temp.plan_has_line(v_plan, '1103', 120, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '4101', 0, 100)
     OR NOT pg_temp.plan_has_line(v_plan, '2102', 0, 20)
     OR NOT pg_temp.plan_has_line(v_plan, '5101', 80, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '1104', 0, 80) THEN
    RAISE EXCEPTION '2D_SALES_FULL_PLAN_FAILED';
  END IF;
END;
$scenario_01$;

-- Scenario 02: قيد بيع مرحل ينقصه زوج التكلفة ينتج فرق 5101/1104 فقط.
DO $scenario_02$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('sales_invoice', 'posted_missing_inventory');
  v_plan := pg_temp.plan_2d('sales_invoice', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE OR v_plan->>'mode' <> 'post_delta_journal'
     OR jsonb_array_length(v_plan->'correction_lines') <> 2
     OR NOT pg_temp.plan_has_line(v_plan, '5101', 80, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '1104', 0, 80) THEN
    RAISE EXCEPTION '2D_SALES_DELTA_PLAN_FAILED';
  END IF;
END;
$scenario_02$;

-- Scenario 03: مرتجع البيع يعكس 1104/5101 ويثبت أطراف الإيراد والضريبة.
DO $scenario_03$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('sales_return');
  v_plan := pg_temp.plan_2d('sales_return', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_line(v_plan, '4101', 100, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '2102', 20, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '1103', 0, 120)
     OR NOT pg_temp.plan_has_line(v_plan, '1104', 80, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '5101', 0, 80) THEN
    RAISE EXCEPTION '2D_SALES_RETURN_PLAN_FAILED';
  END IF;
END;
$scenario_03$;

-- Scenario 04: فاتورة الشراء تستخدم 1104/1105/2101 من المستند والحركة.
DO $scenario_04$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('purchase_invoice');
  v_plan := pg_temp.plan_2d('purchase_invoice', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_line(v_plan, '1104', 100, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '1105', 20, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '2101', 0, 120) THEN
    RAISE EXCEPTION '2D_PURCHASE_PLAN_FAILED';
  END IF;
END;
$scenario_04$;

-- Scenario 05: مرتجع الشراء يثبت WAC والضريبة وفرق السعر 5108.
DO $scenario_05$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('purchase_return');
  v_plan := pg_temp.plan_2d('purchase_return', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_line(v_plan, '2101', 120, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '1104', 0, 80)
     OR NOT pg_temp.plan_has_line(v_plan, '1105', 0, 20)
     OR NOT pg_temp.plan_has_line(v_plan, '5108', 0, 20) THEN
    RAISE EXCEPTION '2D_PURCHASE_RETURN_PLAN_FAILED';
  END IF;
END;
$scenario_05$;

-- Scenario 06: عجز التسوية ينتج 5201 مدين و1104 دائن.
DO $scenario_06$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('adjustment', 'none', -1);
  v_plan := pg_temp.plan_2d('adjustment', v_source);
  IF NOT pg_temp.plan_has_line(v_plan, '5201', 30, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '1104', 0, 30) THEN
    RAISE EXCEPTION '2D_ADJUSTMENT_SHORTAGE_PLAN_FAILED';
  END IF;
END;
$scenario_06$;

-- Scenario 07: فائض التسوية ينتج 1104 مدين و4201 دائن.
DO $scenario_07$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('adjustment', 'none', 1);
  v_plan := pg_temp.plan_2d('adjustment', v_source);
  IF NOT pg_temp.plan_has_line(v_plan, '1104', 30, 0)
     OR NOT pg_temp.plan_has_line(v_plan, '4201', 0, 30) THEN
    RAISE EXCEPTION '2D_ADJUSTMENT_SURPLUS_PLAN_FAILED';
  END IF;
END;
$scenario_07$;

-- Scenario 08: القيد المرتبط المسودة لا يصلح تلقائياً.
DO $scenario_08$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('sales_invoice', 'draft');
  v_plan := pg_temp.plan_2d('sales_invoice', v_source);
  IF COALESCE((v_plan->>'eligible')::boolean, false)
     OR v_plan->>'reason_code' <> 'JOURNAL_DRAFT_REQUIRES_REVIEW' THEN
    RAISE EXCEPTION '2D_DRAFT_JOURNAL_NOT_BLOCKED';
  END IF;
END;
$scenario_08$;

-- Scenario 09: دخول حساب غير متوقع في الفرق يمنع التنفيذ الآلي.
DO $scenario_09$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('sales_invoice', 'unexpected_delta');
  v_plan := pg_temp.plan_2d('sales_invoice', v_source);
  IF COALESCE((v_plan->>'eligible')::boolean, false)
     OR v_plan->>'reason_code' <> 'UNEXPECTED_ACCOUNT_DELTA' THEN
    RAISE EXCEPTION '2D_UNEXPECTED_ACCOUNT_NOT_BLOCKED';
  END IF;
END;
$scenario_09$;

-- Scenario 10: النوع غير المعتمد لا ينتج خطة تنفيذ.
DO $scenario_10$
DECLARE v_plan jsonb;
BEGIN
  v_plan := pg_temp.plan_2d('staging_seed', gen_random_uuid());
  IF COALESCE((v_plan->>'eligible')::boolean, false)
     OR v_plan->>'reason_code' <> 'SOURCE_TYPE_NOT_SUPPORTED' THEN
    RAISE EXCEPTION '2D_UNKNOWN_SOURCE_NOT_BLOCKED';
  END IF;
END;
$scenario_10$;

-- Scenario 11: تغير المستند يغير بصمة الخطة ويمنع استعمال الخطة القديمة.
DO $scenario_11$
DECLARE v_source uuid; v_before jsonb; v_after jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('sales_invoice');
  v_before := pg_temp.plan_2d('sales_invoice', v_source);
  UPDATE public.sales_invoices SET total = 121, subtotal = 101 WHERE id = v_source;
  v_after := pg_temp.plan_2d('sales_invoice', v_source);
  IF v_before->>'plan_fingerprint' = v_after->>'plan_fingerprint' THEN
    RAISE EXCEPTION '2D_PLAN_FINGERPRINT_DID_NOT_CHANGE';
  END IF;
END;
$scenario_11$;

-- Scenario 12: تاريخ مصدر مقفل بلا تاريخ معالجة مفتوح يرفض.
DO $scenario_12$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('purchase_invoice');
  UPDATE public.purchase_invoices SET invoice_date = current_date - 10 WHERE id = v_source;
  UPDATE public.inventory_movements SET movement_date = current_date - 10
  WHERE reference_type = 'purchase_invoice' AND reference_id = v_source;
  UPDATE public.company_settings SET locked_until_date = current_date - 1;
  v_plan := pg_temp.plan_2d('purchase_invoice', v_source, NULL);
  IF COALESCE((v_plan->>'eligible')::boolean, false)
     OR v_plan->>'reason_code' <> 'ACCOUNTING_DATE_REQUIRED' THEN
    RAISE EXCEPTION '2D_LOCKED_PERIOD_WITHOUT_DATE_NOT_BLOCKED';
  END IF;
  UPDATE public.company_settings SET locked_until_date = NULL;
END;
$scenario_12$;

-- Scenario 13: تاريخ معالجة بعد القفل يسمح بالخطة ويحفظ تاريخ المصدر منفصلاً.
DO $scenario_13$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('purchase_invoice');
  UPDATE public.purchase_invoices SET invoice_date = current_date - 10 WHERE id = v_source;
  UPDATE public.inventory_movements SET movement_date = current_date - 10
  WHERE reference_type = 'purchase_invoice' AND reference_id = v_source;
  UPDATE public.company_settings SET locked_until_date = current_date - 1;
  v_plan := pg_temp.plan_2d('purchase_invoice', v_source, current_date);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR (v_plan->>'source_date')::date <> current_date - 10
     OR (v_plan->>'accounting_date')::date <> current_date THEN
    RAISE EXCEPTION '2D_OPEN_ACCOUNTING_DATE_PLAN_FAILED';
  END IF;
  UPDATE public.company_settings SET locked_until_date = NULL;
END;
$scenario_13$;

-- Scenario 14: تكرار قراءة الخطة نفسها يعيد البصمة والسطور نفسها.
DO $scenario_14$
DECLARE v_source uuid; v_first jsonb; v_second jsonb;
BEGIN
  v_source := pg_temp.add_2d_source('sales_return');
  v_first := pg_temp.plan_2d('sales_return', v_source);
  v_second := pg_temp.plan_2d('sales_return', v_source);
  IF v_first->>'plan_fingerprint' IS DISTINCT FROM v_second->>'plan_fingerprint'
     OR v_first->'correction_lines' IS DISTINCT FROM v_second->'correction_lines' THEN
    RAISE EXCEPTION '2D_PLAN_NOT_DETERMINISTIC';
  END IF;
END;
$scenario_14$;

-- Scenario 15: مخطط القراءة لا يغير منتجاً أو حركة أو مستنداً أو قيداً.
DO $scenario_15$
DECLARE v_source uuid; v_before text; v_after text;
BEGIN
  v_source := pg_temp.add_2d_source('sales_invoice');
  SELECT md5(jsonb_build_object(
    'products', (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id)) FROM public.products p),
    'movements', (SELECT md5(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id)) FROM public.inventory_movements m),
    'documents', (SELECT md5(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id)) FROM public.sales_invoices i),
    'journals', (SELECT md5(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id)) FROM public.journal_entries j),
    'lines', (SELECT md5(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id)) FROM public.journal_entry_lines l)
  )::text) INTO v_before;
  PERFORM pg_temp.plan_2d('sales_invoice', v_source);
  SELECT md5(jsonb_build_object(
    'products', (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id)) FROM public.products p),
    'movements', (SELECT md5(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id)) FROM public.inventory_movements m),
    'documents', (SELECT md5(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id)) FROM public.sales_invoices i),
    'journals', (SELECT md5(string_agg(to_jsonb(j)::text, '|' ORDER BY j.id)) FROM public.journal_entries j),
    'lines', (SELECT md5(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id)) FROM public.journal_entry_lines l)
  )::text) INTO v_after;
  IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION '2D_PLAN_WROTE_BUSINESS_DATA'; END IF;
END;
$scenario_15$;

-- Scenario 16: لا يظهر في الخطة أي حساب خارج الخريطة المعتمدة أو حساب معلق.
DO $scenario_16$
DECLARE v_source uuid; v_plan jsonb; v_bad integer;
BEGIN
  v_source := pg_temp.add_2d_source('purchase_return');
  v_plan := pg_temp.plan_2d('purchase_return', v_source);
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(v_plan->'correction_lines') line
  WHERE line->>'account_code' NOT IN (
    '1103', '1104', '1105', '2101', '2102',
    '4101', '4201', '5101', '5108', '5201'
  );
  IF v_bad <> 0 OR (v_plan::text ~* 'suspense|معلق') THEN
    RAISE EXCEPTION '2D_SUSPENSE_OR_UNMAPPED_ACCOUNT_FOUND';
  END IF;
END;
$scenario_16$;

SELECT 'INVENTORY_RECONCILIATION_MISSING_JOURNAL_PLAN_CONTRACT_OK';

ROLLBACK;
