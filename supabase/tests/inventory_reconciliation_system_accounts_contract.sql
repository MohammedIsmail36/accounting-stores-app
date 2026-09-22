\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'عقد حسابات تسوية المخزون مخصص لقاعدة L3 المعزولة فقط';
  END IF;
END;
$guard$;

-- Scenario 01: حسابا فائض وعجز المخزون موجودان مرة واحدة فقط.
DO $scenario_01$
BEGIN
  IF (SELECT count(*) FROM public.accounts WHERE code = '4201') <> 1
     OR (SELECT count(*) FROM public.accounts WHERE code = '5201') <> 1 THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_ACCOUNTS_NOT_UNIQUE';
  END IF;
END;
$scenario_01$;

-- Scenario 02: هوية حساب الفائض ثابتة كنظام وإيراد تحت أصل الإيرادات.
DO $scenario_02$
DECLARE v_valid boolean;
BEGIN
  SELECT a.account_type = 'revenue'
    AND a.is_system IS TRUE
    AND a.is_active IS TRUE
    AND a.is_parent IS FALSE
    AND p.code = '4'
  INTO v_valid
  FROM public.accounts a
  JOIN public.accounts p ON p.id = a.parent_id
  WHERE a.code = '4201';
  IF v_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_GAIN_ACCOUNT_INVALID';
  END IF;
END;
$scenario_02$;

-- Scenario 03: هوية حساب العجز ثابتة كنظام ومصروف تحت أصل المصروفات.
DO $scenario_03$
DECLARE v_valid boolean;
BEGIN
  SELECT a.account_type = 'expense'
    AND a.is_system IS TRUE
    AND a.is_active IS TRUE
    AND a.is_parent IS FALSE
    AND p.code = '5'
  INTO v_valid
  FROM public.accounts a
  JOIN public.accounts p ON p.id = a.parent_id
  WHERE a.code = '5201';
  IF v_valid IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_LOSS_ACCOUNT_INVALID';
  END IF;
END;
$scenario_03$;

-- Scenario 04: الحماية عامة وتعمل داخل قاعدة البيانات قبل سياسات الواجهة.
DO $scenario_04$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.accounts'::regclass
      AND t.tgname = 'trg_guard_system_accounts_delete'
      AND p.proname = 'fn_guard_system_accounts_delete'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_DELETE_GUARD_MISSING';
  END IF;
END;
$scenario_04$;

-- Scenario 05: حذف حساب الفائض مرفوض بسبب كونه حساب نظام.
DO $scenario_05$
BEGIN
  BEGIN
    DELETE FROM public.accounts WHERE code = '4201';
    RAISE EXCEPTION 'SYSTEM_GAIN_ACCOUNT_DELETE_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%SYSTEM_ACCOUNT_DELETE_FORBIDDEN%' THEN RAISE; END IF;
  END;
END;
$scenario_05$;

-- Scenario 06: حذف حساب العجز مرفوض حتى قبل استخدامه في أي قيد.
DO $scenario_06$
BEGIN
  BEGIN
    DELETE FROM public.accounts WHERE code = '5201';
    RAISE EXCEPTION 'SYSTEM_LOSS_ACCOUNT_DELETE_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%SYSTEM_ACCOUNT_DELETE_FORBIDDEN%' THEN RAISE; END IF;
  END;
END;
$scenario_06$;

-- Scenario 07: رمز ونوع وموقع حساب التسوية لا يمكن تغييرها.
DO $scenario_07$
BEGIN
  BEGIN
    UPDATE public.accounts SET code = '5299' WHERE code = '5201';
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_IDENTITY_UPDATE_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%لا يمكن تعديل رمز أو نوع أو موقع أو طبيعة حساب النظام%' THEN RAISE; END IF;
  END;
END;
$scenario_07$;

-- Scenario 08: الحارس لا يمنع حذف حساب عادي غير مرتبط.
DO $scenario_08$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.accounts(code, name, account_type, parent_id, is_system, is_active)
  VALUES ('__2D_ACCOUNT_DELETE__', 'حساب عادي مؤقت', 'expense',
    (SELECT id FROM public.accounts WHERE code = '5'), false, true)
  RETURNING id INTO v_id;
  DELETE FROM public.accounts WHERE id = v_id;
  IF EXISTS (SELECT 1 FROM public.accounts WHERE id = v_id) THEN
    RAISE EXCEPTION 'NON_SYSTEM_ACCOUNT_DELETE_FAILED';
  END IF;
END;
$scenario_08$;

SELECT 'INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_CONTRACT_OK';

ROLLBACK;
