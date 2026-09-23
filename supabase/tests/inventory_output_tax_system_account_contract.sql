\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'عقد حساب ضريبة المخرجات مخصص لقاعدة L3 المعزولة فقط';
  END IF;
END;
$guard$;

-- Scenario 01: يوجد حساب ضريبة المخرجات الجديد مرة واحدة فقط.
DO $scenario_01$
BEGIN
  IF (SELECT count(*) FROM public.accounts WHERE code = '2104') <> 1 THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_NOT_UNIQUE';
  END IF;
END;
$scenario_01$;

-- Scenario 02: هوية 2104 نظامية وتفصيلية ونشطة وتحت أصل الخصوم.
DO $scenario_02$
DECLARE v_valid boolean;
BEGIN
  SELECT a.name = 'ضريبة القيمة المضافة للمخرجات'
    AND a.account_type = 'liability'
    AND a.is_system IS TRUE
    AND a.is_active IS TRUE
    AND a.is_parent IS FALSE
    AND p.code = '2'
  INTO v_valid
  FROM public.accounts a
  JOIN public.accounts p ON p.id = a.parent_id
  WHERE a.code = '2104';
  IF v_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_IDENTITY_INVALID';
  END IF;
END;
$scenario_02$;

-- Scenario 03: لا يعاد تفسير حساب القروض القديم 2102 كحساب ضريبة.
DO $scenario_03$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE code = '2102' AND name = 'قروض قصيرة الأجل'
      AND account_type = 'liability'
  ) THEN
    RAISE EXCEPTION 'LEGACY_LOAN_ACCOUNT_2102_WAS_REPURPOSED';
  END IF;
END;
$scenario_03$;

-- Scenario 04: حذف حساب ضريبة المخرجات محمي على مستوى قاعدة البيانات.
DO $scenario_04$
BEGIN
  BEGIN
    DELETE FROM public.accounts WHERE code = '2104';
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_DELETE_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN check_violation OR raise_exception THEN
    IF SQLERRM NOT LIKE '%SYSTEM_ACCOUNT_DELETE_FORBIDDEN%'
       AND SQLERRM NOT LIKE '%TAX_ACCOUNT_MAPPING_INVALID%' THEN
      RAISE;
    END IF;
  END;
END;
$scenario_04$;

-- Scenario 05: لا يمكن تغيير رمز أو نوع أو موقع أو صفة النظام للحساب.
DO $scenario_05$
BEGIN
  BEGIN
    UPDATE public.accounts SET code = '2199' WHERE code = '2104';
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_IDENTITY_UPDATE_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%لا يمكن تعديل رمز أو نوع أو موقع أو طبيعة حساب النظام%' THEN RAISE; END IF;
  END;
END;
$scenario_05$;

-- Scenario 06: ترتبط الإعدادات افتراضيًا بـ1105 و2104 دون تغيير التفعيل أو النسبة.
DO $scenario_06$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.company_settings s
    JOIN pg_temp.output_tax_settings_before b ON b.id = s.id
    JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    JOIN public.accounts v ON v.id = s.sales_tax_account_id
    WHERE p.code <> COALESCE(b.purchase_code, '1105')
       OR v.code <> COALESCE(b.sales_code, '2104')
       OR s.enable_tax IS DISTINCT FROM b.enable_tax
       OR s.tax_rate IS DISTINCT FROM b.tax_rate
  ) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_DEFAULT_MAPPING_OR_TAX_STATE_INVALID';
  END IF;
END;
$scenario_06$;

-- Scenario 07: لا يبدأ الحساب الجديد بأي قيود أو حسابات تابعة أو أنواع مصروفات.
DO $scenario_07$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO STRICT v_id FROM public.accounts WHERE code = '2104';
  IF EXISTS (SELECT 1 FROM public.journal_entry_lines WHERE account_id = v_id)
     OR EXISTS (SELECT 1 FROM public.accounts WHERE parent_id = v_id)
     OR EXISTS (SELECT 1 FROM public.expense_types WHERE account_id = v_id) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_HAS_UNEXPECTED_USAGE';
  END IF;
END;
$scenario_07$;

-- Scenario 08: تظل الحسابات البديلة القديمة 2102 و2103 بلا ربط ضريبي.
DO $scenario_08$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_settings s
    JOIN public.accounts a ON a.id IN (s.purchase_tax_account_id, s.sales_tax_account_id)
    WHERE a.code IN ('2102', '2103')
  ) THEN
    RAISE EXCEPTION 'LEGACY_LOAN_ACCOUNT_LINKED_AS_TAX';
  END IF;
END;
$scenario_08$;

SELECT 'INVENTORY_OUTPUT_TAX_SYSTEM_ACCOUNT_CONTRACT_OK';

ROLLBACK;
