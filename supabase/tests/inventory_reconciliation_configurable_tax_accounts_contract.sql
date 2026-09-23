\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'عقد حسابات ضريبة 2D مخصص لقاعدة L3 المعزولة فقط';
  END IF;
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_JOURNAL_PLAN_MISSING';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  )
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;

CREATE TEMP TABLE configurable_tax_contract_ids (
  name text PRIMARY KEY,
  id uuid NOT NULL
);

DO $fixtures$
DECLARE
  v_admin uuid := '2d7a0000-0000-4000-8000-000000000001';
  v_asset_parent uuid;
  v_liability_parent uuid;
  v_purchase_tax uuid;
  v_purchase_tax_alt uuid;
  v_sales_tax uuid;
  v_wrong_purchase uuid;
  v_wrong_sales uuid;
  v_inactive_purchase uuid;
  v_parent_purchase uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_admin) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(user_id, role)
  VALUES (v_admin, 'admin') ON CONFLICT (user_id, role) DO NOTHING;

  SELECT id INTO STRICT v_asset_parent FROM public.accounts WHERE code = '1';
  SELECT id INTO STRICT v_liability_parent FROM public.accounts WHERE code = '2';

  INSERT INTO public.accounts(
    code, name, account_type, parent_id, is_system, is_active, is_parent
  ) VALUES
    ('T2DPA', 'ضريبة مشتريات مخصصة — عقد 2D', 'asset',
      v_asset_parent, false, true, false),
    ('T2DPB', 'ضريبة مشتريات بديلة — عقد 2D', 'asset',
      v_asset_parent, false, true, false),
    ('T2DSA', 'ضريبة مبيعات مخصصة — عقد 2D', 'liability',
      v_liability_parent, false, true, false),
    ('T2DWP', 'حساب خصوم غير صالح لضريبة المشتريات', 'liability',
      v_liability_parent, false, true, false),
    ('T2DWS', 'حساب أصول غير صالح لضريبة المبيعات', 'asset',
      v_asset_parent, false, true, false),
    ('T2DPI', 'حساب ضريبة مشتريات غير نشط', 'asset',
      v_asset_parent, false, false, false),
    ('T2DPP', 'حساب ضريبة مشتريات تجميعي', 'asset',
      v_asset_parent, false, true, true);

  SELECT id INTO STRICT v_purchase_tax FROM public.accounts WHERE code = 'T2DPA';
  SELECT id INTO STRICT v_purchase_tax_alt FROM public.accounts WHERE code = 'T2DPB';
  SELECT id INTO STRICT v_sales_tax FROM public.accounts WHERE code = 'T2DSA';
  SELECT id INTO STRICT v_wrong_purchase FROM public.accounts WHERE code = 'T2DWP';
  SELECT id INTO STRICT v_wrong_sales FROM public.accounts WHERE code = 'T2DWS';
  SELECT id INTO STRICT v_inactive_purchase FROM public.accounts WHERE code = 'T2DPI';
  SELECT id INTO STRICT v_parent_purchase FROM public.accounts WHERE code = 'T2DPP';

  INSERT INTO configurable_tax_contract_ids(name, id) VALUES
    ('admin', v_admin),
    ('purchase_tax', v_purchase_tax),
    ('purchase_tax_alt', v_purchase_tax_alt),
    ('sales_tax', v_sales_tax),
    ('wrong_purchase', v_wrong_purchase),
    ('wrong_sales', v_wrong_sales),
    ('inactive_purchase', v_inactive_purchase),
    ('parent_purchase', v_parent_purchase);

  UPDATE public.company_settings
  SET enable_tax = true,
      purchase_tax_account_id = v_purchase_tax,
      sales_tax_account_id = v_sales_tax,
      locked_until_date = NULL;
END;
$fixtures$;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', (SELECT id FROM configurable_tax_contract_ids WHERE name = 'admin')
  )::text,
  true
);

CREATE FUNCTION pg_temp.add_configurable_tax_source(p_source_type text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_source uuid;
  v_product uuid;
  v_movement_type public.inventory_movement_type;
  v_movement_value numeric;
BEGIN
  IF p_source_type NOT IN (
    'sales_invoice', 'sales_return', 'purchase_invoice', 'purchase_return'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_CONFIGURABLE_TAX_SOURCE';
  END IF;

  INSERT INTO public.products(
    code, name, purchase_price, selling_price, quantity_on_hand, is_active
  ) VALUES (
    '__2D_TAX_' || replace(gen_random_uuid()::text, '-', ''),
    'منتج عقد حسابات الضريبة', 40, 60, 20, true
  ) RETURNING id INTO v_product;

  IF p_source_type = 'sales_invoice' THEN
    INSERT INTO public.sales_invoices(
      invoice_date, status, subtotal, discount, tax, total, paid_amount, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, 0, '__2D_TAX_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'sale';
    v_movement_value := 80;
  ELSIF p_source_type = 'sales_return' THEN
    INSERT INTO public.sales_returns(
      return_date, status, subtotal, discount, tax, total, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, '__2D_TAX_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'sale_return';
    v_movement_value := 80;
  ELSIF p_source_type = 'purchase_invoice' THEN
    INSERT INTO public.purchase_invoices(
      invoice_date, status, subtotal, discount, tax, total, paid_amount, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, 0, '__2D_TAX_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'purchase';
    v_movement_value := 100;
  ELSE
    INSERT INTO public.purchase_returns(
      return_date, status, subtotal, discount, tax, total, notes
    ) VALUES (current_date, 'posted', 100, 0, 20, 120, '__2D_TAX_CONTRACT__')
    RETURNING id INTO v_source;
    v_movement_type := 'purchase_return';
    v_movement_value := 80;
  END IF;

  INSERT INTO public.inventory_movements(
    product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, movement_date
  ) VALUES (
    v_product, v_movement_type, 2, v_movement_value / 2, v_movement_value,
    v_source, p_source_type, current_date
  );

  RETURN v_source;
END;
$$;

CREATE FUNCTION pg_temp.tax_plan(p_source_type text, p_source_id uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.get_inventory_reconciliation_journal_plan(
    p_source_type, p_source_id, NULL
  )
$$;

CREATE FUNCTION pg_temp.plan_has_tax_line(
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

-- Scenario 01: فاتورة الشراء تستخدم حساب ضريبة المشتريات المعد بدل رمز ثابت.
DO $scenario_01$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_configurable_tax_source('purchase_invoice');
  v_plan := pg_temp.tax_plan('purchase_invoice', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_tax_line(v_plan, 'T2DPA', 20, 0)
     OR pg_temp.plan_has_tax_line(v_plan, '1105', 20, 0) THEN
    RAISE EXCEPTION 'CONFIGURED_PURCHASE_TAX_ACCOUNT_NOT_USED';
  END IF;
END;
$scenario_01$;

-- Scenario 02: مرتجع الشراء يعكس حساب الضريبة المعد نفسه.
DO $scenario_02$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_configurable_tax_source('purchase_return');
  v_plan := pg_temp.tax_plan('purchase_return', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_tax_line(v_plan, 'T2DPA', 0, 20)
     OR pg_temp.plan_has_tax_line(v_plan, '1105', 0, 20) THEN
    RAISE EXCEPTION 'CONFIGURED_PURCHASE_RETURN_TAX_ACCOUNT_NOT_USED';
  END IF;
END;
$scenario_02$;

-- Scenario 03: فاتورة البيع تستخدم حساب ضريبة المبيعات المعد.
DO $scenario_03$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_configurable_tax_source('sales_invoice');
  v_plan := pg_temp.tax_plan('sales_invoice', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_tax_line(v_plan, 'T2DSA', 0, 20)
     OR pg_temp.plan_has_tax_line(v_plan, '2102', 0, 20) THEN
    RAISE EXCEPTION 'CONFIGURED_SALES_TAX_ACCOUNT_NOT_USED';
  END IF;
END;
$scenario_03$;

-- Scenario 04: مرتجع البيع يعكس حساب الضريبة المعد نفسه.
DO $scenario_04$
DECLARE v_source uuid; v_plan jsonb;
BEGIN
  v_source := pg_temp.add_configurable_tax_source('sales_return');
  v_plan := pg_temp.tax_plan('sales_return', v_source);
  IF (v_plan->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_tax_line(v_plan, 'T2DSA', 20, 0)
     OR pg_temp.plan_has_tax_line(v_plan, '2102', 20, 0) THEN
    RAISE EXCEPTION 'CONFIGURED_SALES_RETURN_TAX_ACCOUNT_NOT_USED';
  END IF;
END;
$scenario_04$;

-- Scenario 05: لا يقبل حساب خصوم كحساب ضريبة مشتريات.
DO $scenario_05$
BEGIN
  BEGIN
    UPDATE public.company_settings
    SET purchase_tax_account_id = (
      SELECT id FROM configurable_tax_contract_ids WHERE name = 'wrong_purchase'
    );
    RAISE EXCEPTION 'INVALID_PURCHASE_TAX_ACCOUNT_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%TAX_ACCOUNT_MAPPING_INVALID%' THEN RAISE; END IF;
  END;
END;
$scenario_05$;

-- Scenario 06: لا يقبل حساب ضريبة مشتريات غير نشط أو تجميعي.
DO $scenario_06$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['inactive_purchase', 'parent_purchase'] LOOP
    BEGIN
      UPDATE public.company_settings
      SET purchase_tax_account_id = (
        SELECT id FROM configurable_tax_contract_ids WHERE name = v_name
      );
      RAISE EXCEPTION 'INVALID_PURCHASE_TAX_SHAPE_UNEXPECTEDLY_ALLOWED';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE '%TAX_ACCOUNT_MAPPING_INVALID%' THEN RAISE; END IF;
    END;
  END LOOP;
END;
$scenario_06$;

-- Scenario 07: لا يقبل حساب أصول كحساب ضريبة مبيعات.
DO $scenario_07$
BEGIN
  BEGIN
    UPDATE public.company_settings
    SET sales_tax_account_id = (
      SELECT id FROM configurable_tax_contract_ids WHERE name = 'wrong_sales'
    );
    RAISE EXCEPTION 'INVALID_SALES_TAX_ACCOUNT_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%TAX_ACCOUNT_MAPPING_INVALID%' THEN RAISE; END IF;
  END;
END;
$scenario_07$;

-- Scenario 08: تغيير الحساب المعد الصالح يغير خطة القيد وبصمته بصورة حتمية.
DO $scenario_08$
DECLARE v_source uuid; v_before jsonb; v_after jsonb;
BEGIN
  UPDATE public.company_settings
  SET purchase_tax_account_id = (
    SELECT id FROM configurable_tax_contract_ids WHERE name = 'purchase_tax'
  );
  v_source := pg_temp.add_configurable_tax_source('purchase_invoice');
  v_before := pg_temp.tax_plan('purchase_invoice', v_source);

  UPDATE public.company_settings
  SET purchase_tax_account_id = (
    SELECT id FROM configurable_tax_contract_ids WHERE name = 'purchase_tax_alt'
  );
  v_after := pg_temp.tax_plan('purchase_invoice', v_source);

  IF (v_after->>'eligible')::boolean IS NOT TRUE
     OR NOT pg_temp.plan_has_tax_line(v_after, 'T2DPB', 20, 0)
     OR v_before->>'plan_fingerprint' IS NOT DISTINCT FROM v_after->>'plan_fingerprint'
     OR v_before->'correction_lines' IS NOT DISTINCT FROM v_after->'correction_lines' THEN
    RAISE EXCEPTION 'CONFIGURED_TAX_ACCOUNT_CHANGE_NOT_REFLECTED';
  END IF;
END;
$scenario_08$;

SELECT 'INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ACCOUNTS_CONTRACT_OK';

ROLLBACK;
