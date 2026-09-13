\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore'
     OR current_user <> 'postgres'
  THEN
    RAISE EXCEPTION 'اختبار المطابقة مخصص لقاعدة L3 المعزولة فقط';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE code IN ('__RECON_TEST_ACTIVE__', '__RECON_TEST_INACTIVE__')
  ) THEN
    RAISE EXCEPTION 'بيانات اختبار المطابقة موجودة مسبقاً';
  END IF;
END;
$guard$;

-- نسخة L3 العامة تستبدل دوال Auth بدوال وهمية لا تقرأ JWT. نحاكي هنا
-- auth.role() الحقيقية داخل المعاملة فقط، ثم يعيد ROLLBACK الدالة الوهمية.
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  )
$$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

CREATE TEMP TABLE reconciliation_test_baseline AS
SELECT
  (payload->>'total_quantity')::numeric AS total_quantity,
  (payload->>'total_value')::numeric AS total_value,
  (payload->>'total_moves_value')::numeric AS total_moves_value,
  (payload->>'gl_balance')::numeric AS gl_balance
FROM (
  SELECT public.get_inventory_valuation(current_date) AS payload
) baseline;

DO $test$
DECLARE
  v_active_product uuid;
  v_inactive_product uuid;
  v_inventory_account uuid;
  v_offset_account uuid;
  v_posted_journal uuid;
  v_draft_journal uuid;
  v_payload jsonb;
  v_row jsonb;
  v_state record;
  v_baseline reconciliation_test_baseline%ROWTYPE;
BEGIN
  IF public.inventory_signed_quantity('opening_balance', -2) <> 2
     OR public.inventory_signed_quantity('purchase', -2) <> 2
     OR public.inventory_signed_quantity('sale_return', -2) <> 2
     OR public.inventory_signed_quantity('sale', -2) <> -2
     OR public.inventory_signed_quantity('purchase_return', -2) <> -2
     OR public.inventory_signed_quantity('adjustment', -2) <> -2
  THEN
    RAISE EXCEPTION 'قاعدة إشارات كميات الحركات تغيرت';
  END IF;

  SELECT id INTO STRICT v_inventory_account
  FROM public.accounts
  WHERE code = '1104';

  SELECT id INTO STRICT v_offset_account
  FROM public.accounts
  WHERE code = '3101';

  INSERT INTO public.products (
    code,
    name,
    purchase_price,
    selling_price,
    quantity_on_hand,
    is_active
  ) VALUES (
    '__RECON_TEST_ACTIVE__',
    'Isolated reconciliation active fixture',
    999,
    1,
    999,
    true
  ) RETURNING id INTO v_active_product;

  INSERT INTO public.products (
    code,
    name,
    purchase_price,
    selling_price,
    quantity_on_hand,
    is_active
  ) VALUES (
    '__RECON_TEST_INACTIVE__',
    'Isolated reconciliation inactive fixture',
    50,
    1,
    0,
    false
  ) RETURNING id INTO v_inactive_product;

  INSERT INTO public.inventory_movements (
    product_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    reference_type,
    movement_date
  ) VALUES
    (v_active_product, 'opening_balance', 10, 100, 1000, 'reconciliation_test', current_date),
    (v_active_product, 'purchase', 10, 140, 1400, 'reconciliation_test', current_date),
    (v_active_product, 'sale', 4, 120, 480, 'reconciliation_test', current_date),
    (v_active_product, 'sale_return', 1, 120, 120, 'reconciliation_test', current_date),
    (v_active_product, 'purchase_return', 2, 120, 240, 'reconciliation_test', current_date),
    (v_active_product, 'adjustment', -1, 120, 120, 'reconciliation_test', current_date),
    (v_inactive_product, 'adjustment', 3, 50, 150, 'reconciliation_test', current_date),
    (v_active_product, 'purchase', 100, 7, 700, 'reconciliation_test', current_date + 1);

  SELECT * INTO STRICT v_state
  FROM public.inventory_product_state(current_date)
  WHERE product_id = v_active_product;

  IF v_state.quantity <> 14
     OR v_state.moves_value <> 1680
     OR v_state.wac <> 120
     OR v_state.purchased_qty <> 20
     OR v_state.purchased_cost <> 2400
  THEN
    RAISE EXCEPTION 'حالة المنتج من الحركات تغيرت: %', row_to_json(v_state);
  END IF;

  INSERT INTO public.journal_entries (
    entry_date,
    description,
    status,
    total_debit,
    total_credit
  ) VALUES (
    current_date,
    'Isolated reconciliation posted fixture',
    'posted',
    1830,
    1830
  ) RETURNING id INTO v_posted_journal;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  ) VALUES
    (v_posted_journal, v_inventory_account, 1830, 0, 'Inventory fixture'),
    (v_posted_journal, v_offset_account, 0, 1830, 'Offset fixture');

  INSERT INTO public.journal_entries (
    entry_date,
    description,
    status,
    total_debit,
    total_credit
  ) VALUES (
    current_date,
    'Isolated reconciliation draft fixture',
    'draft',
    500,
    500
  ) RETURNING id INTO v_draft_journal;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  ) VALUES
    (v_draft_journal, v_inventory_account, 500, 0, 'Ignored draft inventory fixture'),
    (v_draft_journal, v_offset_account, 0, 500, 'Ignored draft offset fixture');

  SELECT * INTO STRICT v_baseline FROM reconciliation_test_baseline;
  v_payload := public.get_inventory_valuation(current_date);

  IF (v_payload->>'total_quantity')::numeric - v_baseline.total_quantity <> 17
     OR (v_payload->>'total_value')::numeric - v_baseline.total_value <> 1830
     OR (v_payload->>'total_moves_value')::numeric - v_baseline.total_moves_value <> 1830
     OR (v_payload->>'gl_balance')::numeric - v_baseline.gl_balance <> 1830
  THEN
    RAISE EXCEPTION 'إجماليات تقييم المخزون أو 1104 تغيرت: %', v_payload;
  END IF;

  SELECT value INTO STRICT v_row
  FROM jsonb_array_elements(v_payload->'rows')
  WHERE value->>'product_id' = v_active_product::text;

  IF (v_row->>'quantity')::numeric <> 14
     OR (v_row->>'unit_cost')::numeric <> 120
     OR (v_row->>'value')::numeric <> 1680
     OR (v_row->>'moves_value')::numeric <> 1680
  THEN
    RAISE EXCEPTION 'صف المنتج النشط في التقييم تغير: %', v_row;
  END IF;

  SELECT value INTO STRICT v_row
  FROM jsonb_array_elements(v_payload->'rows')
  WHERE value->>'product_id' = v_inactive_product::text;

  IF (v_row->>'is_active')::boolean IS DISTINCT FROM false
     OR (v_row->>'quantity')::numeric <> 3
     OR (v_row->>'unit_cost')::numeric <> 50
     OR (v_row->>'value')::numeric <> 150
     OR (v_row->>'moves_value')::numeric <> 150
  THEN
    RAISE EXCEPTION 'نطاق المنتج غير النشط أو تكلفة الرجوع تغيرا: %', v_row;
  END IF;
END;
$test$;

SELECT 'INVENTORY_RECONCILIATION_BASELINE_DB_TEST_OK' AS result;

ROLLBACK;
