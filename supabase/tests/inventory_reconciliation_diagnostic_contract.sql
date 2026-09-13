\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore'
     OR current_user <> 'postgres'
  THEN
    RAISE EXCEPTION 'اختبار عقد التشخيص مخصص لقاعدة L3 المعزولة فقط';
  END IF;
  IF to_regprocedure('public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'RECONCILIATION_DIAGNOSTIC_FUNCTION_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE code LIKE '__RECON_V2__%') THEN
    RAISE EXCEPTION 'بيانات اختبار عقد التشخيص موجودة مسبقاً';
  END IF;
END;
$guard$;

-- نسخة L3 العامة لا تحتوي Auth الحقيقي؛ المحاكاة داخل المعاملة وتزول بالرجوع.
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

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

CREATE TEMP TABLE recon_ids (
  name text PRIMARY KEY,
  id uuid NOT NULL
);

CREATE TEMP TABLE recon_before AS
SELECT public.get_inventory_reconciliation_diagnostic(
  p_section => 'summary',
  p_only_issues => true,
  p_search => NULL,
  p_limit => 100,
  p_offset => 0,
  p_expected_fingerprint => NULL
) AS payload;

CREATE FUNCTION pg_temp.recon_product(
  p_label text,
  p_card_quantity numeric,
  p_purchase_price numeric,
  p_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.products (
    code, name, purchase_price, selling_price, quantity_on_hand, is_active
  ) VALUES (
    '__RECON_V2__' || p_label,
    'Reconciliation contract ' || p_label,
    p_purchase_price,
    1,
    p_card_quantity,
    p_active
  ) RETURNING id INTO v_id;
  INSERT INTO recon_ids(name, id) VALUES ('product_' || p_label, v_id);
  RETURN v_id;
END;
$$;

CREATE FUNCTION pg_temp.recon_journal(
  p_label text,
  p_inventory_value numeric,
  p_status text DEFAULT 'posted',
  p_entry_type text DEFAULT 'regular'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_inventory_account uuid;
  v_offset_account uuid;
BEGIN
  SELECT id INTO STRICT v_inventory_account FROM public.accounts WHERE code = '1104';
  SELECT id INTO STRICT v_offset_account FROM public.accounts WHERE code = '3101';
  IF p_inventory_value = 0 THEN
    RAISE EXCEPTION 'قيمة قيد الاختبار لا يمكن أن تكون صفراً';
  END IF;

  INSERT INTO public.journal_entries (
    entry_date, description, status, total_debit, total_credit, entry_type
  ) VALUES (
    current_date,
    '__RECON_V2__' || p_label,
    p_status,
    abs(p_inventory_value),
    abs(p_inventory_value),
    p_entry_type
  ) RETURNING id INTO v_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  ) VALUES
    (
      v_id,
      v_inventory_account,
      CASE WHEN p_inventory_value > 0 THEN p_inventory_value ELSE 0 END,
      CASE WHEN p_inventory_value < 0 THEN abs(p_inventory_value) ELSE 0 END,
      '__RECON_V2__ inventory ' || p_label
    ),
    (
      v_id,
      v_offset_account,
      CASE WHEN p_inventory_value < 0 THEN abs(p_inventory_value) ELSE 0 END,
      CASE WHEN p_inventory_value > 0 THEN p_inventory_value ELSE 0 END,
      '__RECON_V2__ offset ' || p_label
    );

  INSERT INTO recon_ids(name, id) VALUES ('journal_' || p_label, v_id);
  RETURN v_id;
END;
$$;

CREATE FUNCTION pg_temp.recon_purchase_source(
  p_label text,
  p_journal_id uuid DEFAULT NULL,
  p_status text DEFAULT 'posted'
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.purchase_invoices (
    invoice_date, status, subtotal, discount, tax, total, paid_amount,
    journal_entry_id, notes
  ) VALUES (
    current_date, p_status, 1, 0, 0, 1, 0,
    p_journal_id, '__RECON_V2__' || p_label
  ) RETURNING id INTO v_id;
  INSERT INTO recon_ids(name, id) VALUES ('source_' || p_label, v_id);
  RETURN v_id;
END;
$$;

CREATE FUNCTION pg_temp.recon_movement(
  p_label text,
  p_product_id uuid,
  p_movement_type public.inventory_movement_type,
  p_quantity numeric,
  p_total_cost numeric,
  p_reference_id uuid,
  p_reference_type text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.inventory_movements (
    product_id, movement_type, quantity, unit_cost, total_cost,
    reference_id, reference_type, movement_date
  ) VALUES (
    p_product_id,
    p_movement_type,
    p_quantity,
    CASE WHEN p_quantity = 0 THEN 0 ELSE round(p_total_cost / abs(p_quantity), 2) END,
    p_total_cost,
    p_reference_id,
    p_reference_type,
    current_date
  ) RETURNING id INTO v_id;
  INSERT INTO recon_ids(name, id) VALUES ('movement_' || p_label, v_id);
  RETURN v_id;
END;
$$;

-- Scenario 01: منتج ومستند مطابقان بالكامل.
DO $scenario_01$
DECLARE p uuid; j uuid; s uuid;
BEGIN
  p := pg_temp.recon_product('MATCHED', 10, 10);
  j := pg_temp.recon_journal('MATCHED', 100);
  s := pg_temp.recon_purchase_source('MATCHED', j);
  PERFORM pg_temp.recon_movement('MATCHED', p, 'purchase', 10, 100, s, 'purchase_invoice');
END;
$scenario_01$;

-- Scenario 02: كمية بطاقة بلا حركة.
SELECT pg_temp.recon_product('CARD_ONLY', 5, 10);

-- Scenario 03: حركة صحيحة لم تُطبق على بطاقة المنتج.
DO $scenario_03$
DECLARE p uuid; j uuid; s uuid;
BEGIN
  p := pg_temp.recon_product('MOVEMENT_NOT_APPLIED', 0, 10);
  j := pg_temp.recon_journal('MOVEMENT_NOT_APPLIED', 20);
  s := pg_temp.recon_purchase_source('MOVEMENT_NOT_APPLIED', j);
  PERFORM pg_temp.recon_movement('MOVEMENT_NOT_APPLIED', p, 'purchase', 2, 20, s, 'purchase_invoice');
END;
$scenario_03$;

-- Scenario 04: حركة مصدر معروف بلا قيد.
DO $scenario_04$
DECLARE p uuid; s uuid;
BEGIN
  p := pg_temp.recon_product('MOVEMENT_NO_JOURNAL', 1, 10);
  s := pg_temp.recon_purchase_source('MOVEMENT_NO_JOURNAL', NULL);
  PERFORM pg_temp.recon_movement('MOVEMENT_NO_JOURNAL', p, 'purchase', 1, 10, s, 'purchase_invoice');
END;
$scenario_04$;

-- Scenario 05: قيد 1104 مرتبط بمستند بلا حركة.
DO $scenario_05$
DECLARE j uuid;
BEGIN
  j := pg_temp.recon_journal('JOURNAL_NO_MOVEMENT', 30);
  PERFORM pg_temp.recon_purchase_source('JOURNAL_NO_MOVEMENT', j);
END;
$scenario_05$;

-- Scenario 06: حركة وقيد موجودان مع اختلاف أكبر من سنت.
DO $scenario_06$
DECLARE p uuid; j uuid; s uuid;
BEGIN
  p := pg_temp.recon_product('VALUE_MISMATCH', 4, 10);
  j := pg_temp.recon_journal('VALUE_MISMATCH', 42);
  s := pg_temp.recon_purchase_source('VALUE_MISMATCH', j);
  PERFORM pg_temp.recon_movement('VALUE_MISMATCH', p, 'purchase', 4, 40, s, 'purchase_invoice');
END;
$scenario_06$;

-- Scenario 07: فرق سنت واحد موثق كباقي تقريب وليس مطابقاً.
DO $scenario_07$
DECLARE p uuid; j uuid; s uuid;
BEGIN
  p := pg_temp.recon_product('ROUNDING', 5, 10);
  j := pg_temp.recon_journal('ROUNDING', 50.01);
  s := pg_temp.recon_purchase_source('ROUNDING', j);
  PERFORM pg_temp.recon_movement('ROUNDING', p, 'purchase', 5, 50, s, 'purchase_invoice');
END;
$scenario_07$;

-- Scenario 08: حركة بلا reference_id.
DO $scenario_08$
DECLARE p uuid;
BEGIN
  p := pg_temp.recon_product('MISSING_REFERENCE', 1, 15);
  PERFORM pg_temp.recon_movement('MISSING_REFERENCE', p, 'opening_balance', 1, 15, NULL, 'opening_balance');
END;
$scenario_08$;

-- Scenario 09: نوع مرجع مجهول.
DO $scenario_09$
DECLARE p uuid; unknown_id uuid := gen_random_uuid();
BEGIN
  p := pg_temp.recon_product('UNKNOWN_REFERENCE', 1, 12);
  INSERT INTO recon_ids(name, id) VALUES ('unknown_reference', unknown_id);
  PERFORM pg_temp.recon_movement('UNKNOWN_REFERENCE', p, 'purchase', 1, 12, unknown_id, '__unknown_reference__');
END;
$scenario_09$;

-- Scenario 10: مستند ملغي وقيده العكسي مرتبطان بصورة صحيحة.
DO $scenario_10$
DECLARE original_journal uuid; reversal_journal uuid; source_id uuid;
BEGIN
  original_journal := pg_temp.recon_journal('CANCELLED_ORIGINAL', -100);
  reversal_journal := pg_temp.recon_journal('CANCELLED_REVERSAL', 100, 'posted', 'reversal');
  INSERT INTO public.sales_invoices (
    invoice_date, status, subtotal, discount, tax, total, paid_amount,
    journal_entry_id, notes
  ) VALUES (
    current_date, 'cancelled', 100, 0, 0, 100, 0,
    original_journal, '__RECON_V2__CANCELLED'
  ) RETURNING id INTO source_id;
  INSERT INTO recon_ids(name, id) VALUES ('source_CANCELLED', source_id);
  INSERT INTO public.audit_log (
    table_name, record_id, action, old_data, new_data
  ) VALUES (
    'sales_invoices', source_id::text, 'cancel',
    jsonb_build_object('status', 'posted', 'journal_entry_id', original_journal),
    jsonb_build_object('status', 'cancelled', 'reversal_journal_entry_id', reversal_journal)
  );
END;
$scenario_10$;

-- Scenario 11: قيد عكسي غير مرتبط بمصدر.
SELECT pg_temp.recon_journal('UNLINKED_REVERSAL', 60, 'posted', 'reversal');

-- Scenario 12: قيمة بلا كمية، وكمية بلا قيمة.
DO $scenario_12$
DECLARE p_zero_qty uuid; p_zero_value uuid; j_in uuid; j_out uuid; s_in uuid; s_out uuid; s_zero uuid;
BEGIN
  p_zero_qty := pg_temp.recon_product('ZERO_QTY_VALUE', 0, 10);
  j_in := pg_temp.recon_journal('ZERO_QTY_VALUE_IN', 10);
  s_in := pg_temp.recon_purchase_source('ZERO_QTY_VALUE_IN', j_in);
  PERFORM pg_temp.recon_movement('ZERO_QTY_VALUE_IN', p_zero_qty, 'purchase', 1, 10, s_in, 'purchase_invoice');
  j_out := pg_temp.recon_journal('ZERO_QTY_VALUE_OUT', -5);
  INSERT INTO public.sales_invoices (
    invoice_date, status, subtotal, discount, tax, total, paid_amount,
    journal_entry_id, notes
  ) VALUES (current_date, 'posted', 5, 0, 0, 5, 0, j_out, '__RECON_V2__ZERO_QTY_VALUE_OUT')
  RETURNING id INTO s_out;
  INSERT INTO recon_ids(name, id) VALUES ('source_ZERO_QTY_VALUE_OUT', s_out);
  PERFORM pg_temp.recon_movement('ZERO_QTY_VALUE_OUT', p_zero_qty, 'sale', 1, 5, s_out, 'sales_invoice');

  p_zero_value := pg_temp.recon_product('NONZERO_QTY_ZERO_VALUE', 2, 0);
  s_zero := pg_temp.recon_purchase_source('NONZERO_QTY_ZERO_VALUE', NULL);
  PERFORM pg_temp.recon_movement('NONZERO_QTY_ZERO_VALUE', p_zero_value, 'purchase', 2, 0, s_zero, 'purchase_invoice');
END;
$scenario_12$;

-- Scenario 13: منتج غير نشط له رصيد مطابق ويجب ألا يختفي.
DO $scenario_13$
DECLARE p uuid; j uuid; s uuid;
BEGIN
  p := pg_temp.recon_product('INACTIVE', 1, 5, false);
  j := pg_temp.recon_journal('INACTIVE', 5);
  s := pg_temp.recon_purchase_source('INACTIVE', j);
  PERFORM pg_temp.recon_movement('INACTIVE', p, 'purchase', 1, 5, s, 'purchase_invoice');
END;
$scenario_13$;

CREATE TEMP TABLE recon_after AS
SELECT public.get_inventory_reconciliation_diagnostic(
  p_section => 'summary',
  p_only_issues => true,
  p_search => NULL,
  p_limit => 100,
  p_offset => 0,
  p_expected_fingerprint => NULL
) AS payload;

-- Scenario 14: تغير البيانات يجب أن يجعل البصمة السابقة قديمة.
DO $scenario_14$
DECLARE old_fingerprint text; stale_rejected boolean := false;
BEGIN
  SELECT payload->>'fingerprint' INTO old_fingerprint FROM recon_before;
  BEGIN
    PERFORM public.get_inventory_reconciliation_diagnostic(
      p_section => 'summary',
      p_only_issues => true,
      p_search => NULL,
      p_limit => 100,
      p_offset => 0,
      p_expected_fingerprint => old_fingerprint
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%RECONCILIATION_SNAPSHOT_STALE%' THEN
      stale_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT stale_rejected THEN
    RAISE EXCEPTION 'البصمة القديمة لم تُرفض';
  END IF;
END;
$scenario_14$;

-- Scenario 15: البائع مرفوض، والمدير والمحاسب مسموح لهما.
DO $scenario_15$
DECLARE
  admin_id uuid := '10000000-0000-0000-0000-000000000001';
  accountant_id uuid := '10000000-0000-0000-0000-000000000002';
  seller_id uuid := '10000000-0000-0000-0000-000000000003';
  seller_rejected boolean := false;
BEGIN
  INSERT INTO auth.users(id) VALUES (admin_id), (accountant_id), (seller_id)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES
    (admin_id, 'admin'), (accountant_id, 'accountant'), (seller_id, 'sales')
  ON CONFLICT (user_id, role) DO NOTHING;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', seller_id)::text, true);
  BEGIN
    PERFORM public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    seller_rejected := true;
  END;
  IF NOT seller_rejected THEN RAISE EXCEPTION 'وصول البائع لم يُرفض'; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', accountant_id)::text, true);
  PERFORM public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', admin_id)::text, true);
  PERFORM public.get_inventory_reconciliation_diagnostic('summary', true, NULL, 100, 0, NULL);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
END;
$scenario_15$;

-- Scenario 16: الملخص والبحث والصفحات لا تغير الأرقام.
DO $scenario_16$
DECLARE
  before_payload jsonb;
  after_payload jsonb;
  product_page jsonb;
  first_page jsonb;
  source_page jsonb;
  current_fingerprint text;
  card_sum numeric;
  movement_sum numeric;
  value_sum numeric;
  row_data jsonb;
  source_data jsonb;
  source_id uuid;
  movement_id uuid;
  journal_id uuid;
BEGIN
  SELECT payload INTO before_payload FROM recon_before;
  SELECT payload INTO after_payload FROM recon_after;
  current_fingerprint := after_payload->>'fingerprint';

  IF (after_payload#>>'{totals,card_quantity}')::numeric
       - (before_payload#>>'{totals,card_quantity}')::numeric <> 30
     OR (after_payload#>>'{totals,movement_quantity}')::numeric
       - (before_payload#>>'{totals,movement_quantity}')::numeric <> 27
     OR (after_payload#>>'{totals,quantity_difference}')::numeric
       - (before_payload#>>'{totals,quantity_difference}')::numeric <> 3
     OR (after_payload#>>'{totals,movement_book_value}')::numeric
       - (before_payload#>>'{totals,movement_book_value}')::numeric <> 257
     OR (after_payload#>>'{totals,ledger_1104_balance}')::numeric
       - (before_payload#>>'{totals,ledger_1104_balance}')::numeric <> 312.01
  THEN
    RAISE EXCEPTION 'إجماليات عقد التشخيص لا تطابق عينة الاختبار';
  END IF;

  product_page := public.get_inventory_reconciliation_diagnostic(
    'products', false, '__RECON_V2__', 500, 0, current_fingerprint
  );
  first_page := public.get_inventory_reconciliation_diagnostic(
    'products', false, '__RECON_V2__', 1, 0, current_fingerprint
  );
  IF (product_page#>>'{page,total_count}')::integer <> 11
     OR jsonb_array_length(product_page->'rows') <> 11
     OR (first_page#>>'{page,total_count}')::integer <> 11
     OR jsonb_array_length(first_page->'rows') <> 1
  THEN
    RAISE EXCEPTION 'البحث أو ترقيم صفحات المنتجات غير صحيح';
  END IF;

  SELECT
    sum((value->>'card_quantity')::numeric),
    sum((value->>'movement_quantity')::numeric),
    sum((value->>'movement_book_value')::numeric)
  INTO card_sum, movement_sum, value_sum
  FROM jsonb_array_elements(product_page->'rows');
  IF card_sum <> 30 OR movement_sum <> 27 OR value_sum <> 257 THEN
    RAISE EXCEPTION 'جمع صفحات المنتجات لا يطابق الملخص';
  END IF;

  SELECT value INTO STRICT row_data FROM jsonb_array_elements(product_page->'rows')
  WHERE value->>'code' = '__RECON_V2__CARD_ONLY';
  IF row_data->>'classification' <> 'product_balance'
     OR NOT (row_data->'reason_codes' ? 'card_without_movements') THEN
    RAISE EXCEPTION 'تصنيف كمية البطاقة بلا حركة غير صحيح';
  END IF;

  SELECT value INTO STRICT row_data FROM jsonb_array_elements(product_page->'rows')
  WHERE value->>'code' = '__RECON_V2__MOVEMENT_NOT_APPLIED';
  IF row_data->>'classification' <> 'product_balance'
     OR NOT (row_data->'reason_codes' ? 'movements_not_applied_to_card') THEN
    RAISE EXCEPTION 'تصنيف الحركة غير المطبقة على البطاقة غير صحيح';
  END IF;

  SELECT value INTO STRICT row_data FROM jsonb_array_elements(product_page->'rows')
  WHERE value->>'code' = '__RECON_V2__ZERO_QTY_VALUE';
  IF NOT (row_data->'reason_codes' ? 'zero_quantity_nonzero_value') THEN
    RAISE EXCEPTION 'لم يُكشف وجود قيمة بلا كمية';
  END IF;

  SELECT value INTO STRICT row_data FROM jsonb_array_elements(product_page->'rows')
  WHERE value->>'code' = '__RECON_V2__NONZERO_QTY_ZERO_VALUE';
  IF NOT (row_data->'reason_codes' ? 'nonzero_quantity_zero_value') THEN
    RAISE EXCEPTION 'لم تُكشف كمية بلا قيمة';
  END IF;

  SELECT value INTO STRICT row_data FROM jsonb_array_elements(product_page->'rows')
  WHERE value->>'code' = '__RECON_V2__INACTIVE';
  IF (row_data->>'is_active')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'المنتج غير النشط ذو الرصيد اختفى من التقرير';
  END IF;

  source_page := public.get_inventory_reconciliation_diagnostic(
    'sources', false, NULL, 500, 0, current_fingerprint
  );

  SELECT id INTO source_id FROM recon_ids WHERE name = 'source_MOVEMENT_NO_JOURNAL';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'purchase_invoice:' || source_id::text;
  IF source_data->>'classification' <> 'movement_without_journal'
     OR NOT (source_data->'reason_codes' ? 'missing_journal_entry') THEN
    RAISE EXCEPTION 'تصنيف الحركة بلا قيد غير صحيح';
  END IF;

  SELECT id INTO source_id FROM recon_ids WHERE name = 'source_JOURNAL_NO_MOVEMENT';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'purchase_invoice:' || source_id::text;
  IF source_data->>'classification' <> 'journal_without_movement'
     OR NOT (source_data->'reason_codes' ? 'posted_source_without_movements') THEN
    RAISE EXCEPTION 'تصنيف القيد بلا حركة غير صحيح';
  END IF;

  SELECT id INTO source_id FROM recon_ids WHERE name = 'source_VALUE_MISMATCH';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'purchase_invoice:' || source_id::text;
  IF source_data->>'classification' <> 'undocumented_effect'
     OR NOT (source_data->'reason_codes' ? 'source_value_mismatch') THEN
    RAISE EXCEPTION 'تصنيف اختلاف القيمة غير صحيح';
  END IF;

  SELECT id INTO source_id FROM recon_ids WHERE name = 'source_ROUNDING';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'purchase_invoice:' || source_id::text;
  IF source_data->>'classification' <> 'rounding'
     OR (source_data->>'is_rounding_only')::boolean IS DISTINCT FROM true
     OR NOT (source_data->'reason_codes' ? 'traceable_rounding_residual') THEN
    RAISE EXCEPTION 'تصنيف باقي التقريب غير صحيح';
  END IF;

  SELECT id INTO movement_id FROM recon_ids WHERE name = 'movement_MISSING_REFERENCE';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'movement:' || movement_id::text;
  IF source_data->>'classification' <> 'undocumented_effect'
     OR NOT (source_data->'reason_codes' ? 'missing_reference_id') THEN
    RAISE EXCEPTION 'تصنيف الحركة بلا مرجع غير صحيح';
  END IF;

  SELECT id INTO movement_id FROM recon_ids WHERE name = 'movement_UNKNOWN_REFERENCE';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'movement:' || movement_id::text;
  IF source_data->>'classification' <> 'undocumented_effect'
     OR NOT (source_data->'reason_codes' ? 'unknown_reference_type') THEN
    RAISE EXCEPTION 'تصنيف نوع المرجع المجهول غير صحيح';
  END IF;

  SELECT id INTO source_id FROM recon_ids WHERE name = 'source_CANCELLED';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'sales_invoice:' || source_id::text;
  IF source_data->>'classification' IS DISTINCT FROM 'matched'
     OR (source_data->>'ledger_1104_value')::numeric <> 0 THEN
    RAISE EXCEPTION 'المستند الملغي ذو العكس الصحيح صُنّف خطأ';
  END IF;

  SELECT id INTO journal_id FROM recon_ids WHERE name = 'journal_UNLINKED_REVERSAL';
  SELECT value INTO STRICT source_data FROM jsonb_array_elements(source_page->'rows')
  WHERE value->>'source_key' = 'journal:' || journal_id::text;
  IF source_data->>'classification' <> 'journal_without_movement'
     OR NOT (source_data->'reason_codes' ? 'unlinked_reversal') THEN
    RAISE EXCEPTION 'تصنيف القيد العكسي غير المرتبط غير صحيح';
  END IF;
END;
$scenario_16$;

SELECT 'INVENTORY_RECONCILIATION_DIAGNOSTIC_CONTRACT_OK' AS result;

ROLLBACK;
