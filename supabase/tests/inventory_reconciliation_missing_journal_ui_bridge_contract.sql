-- Contract for the server-side bridge between repair drafts and the 2D journal plan.
DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'عقد جسر واجهة 2D مخصص لقاعدة L3 المعزولة فقط';
  END IF;
  IF to_regprocedure('public.fn_prepare_inventory_missing_journal_repair_item()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
         AND tgname = 'trg_prepare_inventory_missing_journal_repair_item'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION '2D_UI_BRIDGE_MISSING';
  END IF;
END;
$guard$;

CREATE FUNCTION pg_temp.create_2d_ui_draft(
  p_source_type text,
  p_source_id uuid,
  p_proposed_state jsonb DEFAULT '{}'::jsonb,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_diagnostic jsonb;
  v_row jsonb;
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
    RAISE EXCEPTION '2D_UI_FIXTURE_DIAGNOSTIC_MISSING';
  END IF;
  RETURN public.create_inventory_reconciliation_repair(
    'مسودة واجهة 2D',
    'اختبار تثبيت خطة القيد من الخادم',
    v_diagnostic->>'fingerprint',
    statement_timestamp(),
    'all_recorded_stock_effects',
    jsonb_build_array(jsonb_build_object(
      'axis', 'source',
      'issue_key', v_row->>'source_key',
      'classification', 'movement_without_journal',
      'repair_type', 'create_missing_inventory_journal',
      'source_type', p_source_type,
      'source_id', p_source_id,
      'proposed_state', p_proposed_state
    )),
    p_request_id
  );
END;
$$;

-- Scenario 01: الجسر داخلي ومحمي ويعمل بواسطة Trigger واحد فقط.
DO $scenario_01$
BEGIN
  IF has_function_privilege('anon',
       'public.fn_prepare_inventory_missing_journal_repair_item()', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.fn_prepare_inventory_missing_journal_repair_item()', 'EXECUTE')
     OR (SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
           AND tgname = 'trg_prepare_inventory_missing_journal_repair_item'
           AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION '2D_UI_BRIDGE_SECURITY_INVALID';
  END IF;
END;
$scenario_01$;

-- Scenario 02: مسودة الواجهة الفارغة تحصل على خطة خادمية وتاريخ محاسبي ولا تنشئ قيداً.
DO $scenario_02$
DECLARE v_source uuid; v_result jsonb; v_repair uuid; v_state jsonb; v_date date; v_before bigint;
BEGIN
  v_source := pg_temp.add_2db_source('sales_invoice');
  SELECT count(*) INTO v_before FROM public.journal_entries;
  v_result := pg_temp.create_2d_ui_draft('sales_invoice', v_source);
  v_repair := (v_result->>'id')::uuid;
  SELECT proposed_state INTO v_state FROM public.inventory_reconciliation_repair_items
  WHERE repair_id = v_repair;
  SELECT accounting_date INTO v_date FROM public.inventory_reconciliation_repairs WHERE id = v_repair;
  IF NULLIF(v_state->>'plan_fingerprint', '') IS NULL
     OR v_state->>'mode' <> 'create_full_journal'
     OR jsonb_typeof(v_state->'correction_lines') <> 'array'
     OR jsonb_array_length(v_state->'correction_lines') = 0
     OR v_date IS NULL
     OR (SELECT count(*) FROM public.journal_entries) <> v_before THEN
    RAISE EXCEPTION '2D_UI_SERVER_PLAN_NOT_STORED';
  END IF;
END;
$scenario_02$;

-- Scenario 03: سطور قيد يرسلها العميل تُهمل وتستبدل بالخطة الخادمية الحية.
DO $scenario_03$
DECLARE v_source uuid; v_result jsonb; v_repair uuid; v_state jsonb; v_live jsonb;
BEGIN
  v_source := pg_temp.add_2db_source('purchase_invoice');
  v_result := pg_temp.create_2d_ui_draft('purchase_invoice', v_source,
    jsonb_build_object(
      'accounting_date', current_date,
      'plan_fingerprint', 'مزور',
      'mode', 'post_delta_journal',
      'correction_lines', jsonb_build_array(jsonb_build_object(
        'account_code', '9999', 'debit', 999999, 'credit', 0))
    ));
  v_repair := (v_result->>'id')::uuid;
  SELECT proposed_state INTO v_state FROM public.inventory_reconciliation_repair_items
  WHERE repair_id = v_repair;
  v_live := public.get_inventory_reconciliation_journal_plan(
    'purchase_invoice', v_source, (v_state->>'accounting_date')::date);
  IF v_state->>'plan_fingerprint' IS DISTINCT FROM v_live->>'plan_fingerprint'
     OR v_state->>'mode' IS DISTINCT FROM v_live->>'mode'
     OR v_state->'correction_lines' IS DISTINCT FROM v_live->'correction_lines'
     OR v_state::text LIKE '%9999%' THEN
    RAISE EXCEPTION '2D_UI_CLIENT_PLAN_WAS_TRUSTED';
  END IF;
END;
$scenario_03$;

-- Scenario 04: الفترة المقفلة ترفض المسودة دون تاريخ محاسبي مفتوح.
DO $scenario_04$
DECLARE v_source uuid; v_rejected boolean := false;
BEGIN
  v_source := pg_temp.add_2db_source('sales_return');
  UPDATE public.company_settings SET locked_until_date = current_date;
  BEGIN
    PERFORM pg_temp.create_2d_ui_draft('sales_return', v_source);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%REPAIR_ACCOUNTING_DATE_REQUIRED%';
  END;
  UPDATE public.company_settings SET locked_until_date = NULL;
  IF NOT v_rejected THEN RAISE EXCEPTION '2D_UI_LOCKED_PERIOD_WITHOUT_DATE_ALLOWED'; END IF;
END;
$scenario_04$;

-- Scenario 05: التاريخ المفتوح الذي يختاره المستخدم يثبت في الرأس والخطة.
DO $scenario_05$
DECLARE v_source uuid; v_result jsonb; v_repair uuid; v_date date; v_state jsonb;
BEGIN
  v_source := pg_temp.add_2db_source('purchase_return');
  UPDATE public.company_settings SET locked_until_date = current_date;
  v_result := pg_temp.create_2d_ui_draft('purchase_return', v_source,
    jsonb_build_object('accounting_date', current_date + 1));
  v_repair := (v_result->>'id')::uuid;
  SELECT accounting_date INTO v_date FROM public.inventory_reconciliation_repairs WHERE id = v_repair;
  SELECT proposed_state INTO v_state FROM public.inventory_reconciliation_repair_items WHERE repair_id = v_repair;
  UPDATE public.company_settings SET locked_until_date = NULL;
  IF v_date <> current_date + 1 OR (v_state->>'accounting_date')::date <> current_date + 1 THEN
    RAISE EXCEPTION '2D_UI_ACCOUNTING_DATE_NOT_STORED';
  END IF;
END;
$scenario_05$;

-- Scenario 06: تعديل المسودة يعيد اشتقاق الخطة من الخادم ويتجاهل بصمة العميل القديمة.
DO $scenario_06$
DECLARE v_source uuid; v_result jsonb; v_repair uuid; v_issue_key text; v_state jsonb; v_live jsonb; v_hash text;
BEGIN
  v_source := pg_temp.add_2db_source('adjustment');
  v_result := pg_temp.create_2d_ui_draft('adjustment', v_source);
  v_repair := (v_result->>'id')::uuid;
  SELECT issue_key INTO v_issue_key FROM public.inventory_reconciliation_repair_items
  WHERE repair_id = v_repair;
  PERFORM public.update_inventory_reconciliation_repair(
    v_repair, 'مسودة واجهة 2D محدثة', 'إعادة اشتقاق خطة الخادم',
    jsonb_build_array(jsonb_build_object(
      'axis', 'source', 'issue_key', v_issue_key,
      'classification', 'movement_without_journal',
      'repair_type', 'create_missing_inventory_journal',
      'source_type', 'adjustment', 'source_id', v_source,
      'proposed_state', jsonb_build_object('plan_fingerprint', 'قديم')
    )), 1, gen_random_uuid());
  SELECT proposed_state, precondition_hash INTO v_state, v_hash
  FROM public.inventory_reconciliation_repair_items
  WHERE repair_id = v_repair;
  v_live := public.get_inventory_reconciliation_journal_plan(
    'adjustment', v_source, (v_state->>'accounting_date')::date);
  IF v_hash IS NULL
     OR v_state->>'plan_fingerprint' = 'قديم'
     OR v_state->>'plan_fingerprint' IS DISTINCT FROM v_live->>'plan_fingerprint' THEN
    RAISE EXCEPTION '2D_UI_DRAFT_PLAN_NOT_REFRESHED';
  END IF;
END;
$scenario_06$;

-- Scenario 07: المسودة المنشأة بمسار الواجهة تكمل الاعتماد والتنفيذ الذري بنجاح.
DO $scenario_07$
DECLARE v_source uuid; v_result jsonb; v_repair uuid; v_execute jsonb;
BEGIN
  v_source := pg_temp.add_2db_source('sales_invoice');
  v_result := pg_temp.create_2d_ui_draft('sales_invoice', v_source);
  v_repair := (v_result->>'id')::uuid;
  PERFORM public.submit_inventory_reconciliation_repair(v_repair, 1, gen_random_uuid());
  PERFORM pg_temp.set_2db_actor('admin');
  PERFORM public.approve_inventory_reconciliation_repair(v_repair, 2, NULL, gen_random_uuid());
  v_execute := public.execute_inventory_reconciliation_repair(v_repair, 3, gen_random_uuid());
  IF v_execute->>'status' <> 'executed'
     OR pg_temp.source_journal_id('sales_invoice', v_source) IS NULL
     OR (SELECT count(*) FROM public.inventory_reconciliation_repair_effects
         WHERE repair_id = v_repair AND effect_type = 'missing_inventory_journal_created') <> 1 THEN
    RAISE EXCEPTION '2D_UI_DRAFT_EXECUTION_FAILED';
  END IF;
END;
$scenario_07$;

SELECT 'INVENTORY_RECONCILIATION_MISSING_JOURNAL_UI_BRIDGE_CONTRACT_OK';

ROLLBACK;
