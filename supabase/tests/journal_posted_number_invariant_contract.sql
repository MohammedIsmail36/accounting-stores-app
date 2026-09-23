\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'عقد ترقيم القيود المرحلة مخصص لقاعدة L3 المعزولة فقط';
  END IF;
  IF to_regprocedure('public.create_journal_entry(date,text,jsonb,text,integer,text)') IS NULL
     OR to_regprocedure('public.replace_journal_entry_lines(uuid,jsonb,date,text,text)') IS NULL THEN
    RAISE EXCEPTION 'JOURNAL_WRITER_GATEWAY_MISSING';
  END IF;
  IF to_regclass('pg_temp.journal_posted_number_legacy_fixture') IS NULL THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_LEGACY_FIXTURE_MISSING';
  END IF;
END;
$guard$;

-- Scenario 01: القيود القديمة المرحلة بلا رقم عولجت بالتتابع وفق رقمها الداخلي.
DO $scenario_01$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM (
    SELECT f.id,
      f.previous_max + row_number() OVER (ORDER BY f.entry_number, f.id) AS expected_number
    FROM pg_temp.journal_posted_number_legacy_fixture f
  ) expected
  JOIN public.journal_entries j ON j.id = expected.id
  WHERE j.status <> 'posted'
     OR j.posted_number IS DISTINCT FROM expected.expected_number;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_BACKFILL_INVALID';
  END IF;
END;
$scenario_01$;

-- Scenario 02: إنشاء قيد مرحل دون تمرير رقم يخصص الرقم التالي تلقائياً.
DO $scenario_02$
DECLARE
  v_cash uuid;
  v_equity uuid;
  v_before integer;
  v_entry uuid;
  v_number integer;
BEGIN
  SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  SELECT COALESCE(max(posted_number), 0) INTO v_before FROM public.journal_entries;
  v_entry := public.create_journal_entry(current_date, '__POSTED_NUMBER_AUTO_1__',
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'debit', 1, 'credit', 0),
      jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 1)
    ), 'posted', NULL, 'regular');
  SELECT posted_number INTO v_number FROM public.journal_entries WHERE id = v_entry;
  IF v_number IS DISTINCT FROM v_before + 1 THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_AUTO_ASSIGNMENT_FAILED';
  END IF;
END;
$scenario_02$;

-- Scenario 03: قيدان متتاليان يحصلان على رقمين مختلفين ومتتابعين.
DO $scenario_03$
DECLARE
  v_cash uuid;
  v_equity uuid;
  v_before integer;
  v_first uuid;
  v_second uuid;
  v_first_number integer;
  v_second_number integer;
  v_lines jsonb;
BEGIN
  SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_cash, 'debit', 2, 'credit', 0),
    jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 2));
  SELECT COALESCE(max(posted_number), 0) INTO v_before FROM public.journal_entries;
  v_first := public.create_journal_entry(current_date, '__POSTED_NUMBER_AUTO_2__', v_lines, 'posted', NULL, 'regular');
  v_second := public.create_journal_entry(current_date, '__POSTED_NUMBER_AUTO_3__', v_lines, 'posted', NULL, 'regular');
  SELECT posted_number INTO v_first_number FROM public.journal_entries WHERE id = v_first;
  SELECT posted_number INTO v_second_number FROM public.journal_entries WHERE id = v_second;
  IF v_first_number IS DISTINCT FROM v_before + 1
     OR v_second_number IS DISTINCT FROM v_before + 2
     OR v_first_number = v_second_number THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_SEQUENCE_INVALID';
  END IF;
END;
$scenario_03$;

-- Scenario 04: المسودة تبقى بلا رقم ترحيل.
DO $scenario_04$
DECLARE
  v_cash uuid;
  v_equity uuid;
  v_entry uuid;
  v_number integer;
BEGIN
  SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  v_entry := public.create_journal_entry(current_date, '__POSTED_NUMBER_DRAFT__',
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'debit', 3, 'credit', 0),
      jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 3)
    ), 'draft', NULL, 'regular');
  SELECT posted_number INTO v_number FROM public.journal_entries WHERE id = v_entry;
  IF v_number IS NOT NULL THEN
    RAISE EXCEPTION 'JOURNAL_DRAFT_UNEXPECTED_POSTED_NUMBER';
  END IF;
END;
$scenario_04$;

-- Scenario 05: تحويل المسودة إلى مرحل عبر بوابة الاستبدال يخصص رقماً ذرياً.
DO $scenario_05$
DECLARE
  v_cash uuid;
  v_equity uuid;
  v_before integer;
  v_entry uuid;
  v_number integer;
  v_lines jsonb;
BEGIN
  SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_cash, 'debit', 4, 'credit', 0),
    jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 4));
  v_entry := public.create_journal_entry(current_date, '__POSTED_NUMBER_DRAFT_TO_POSTED__', v_lines, 'draft', NULL, 'regular');
  SELECT COALESCE(max(posted_number), 0) INTO v_before FROM public.journal_entries;
  PERFORM public.replace_journal_entry_lines(v_entry, v_lines, NULL, NULL, 'posted');
  SELECT posted_number INTO v_number FROM public.journal_entries WHERE id = v_entry;
  IF v_number IS DISTINCT FROM v_before + 1 THEN
    RAISE EXCEPTION 'JOURNAL_DRAFT_POSTING_NUMBER_FAILED';
  END IF;
END;
$scenario_05$;

-- Scenario 06: الرقم الصريح الصالح يحفظ كما هو ولا تعاد صياغته كبادئة نصية.
DO $scenario_06$
DECLARE
  v_cash uuid;
  v_equity uuid;
  v_explicit integer;
  v_entry uuid;
  v_number integer;
BEGIN
  SELECT id INTO STRICT v_cash FROM public.accounts WHERE code = '1101';
  SELECT id INTO STRICT v_equity FROM public.accounts WHERE code = '3101';
  SELECT COALESCE(max(posted_number), 0) + 1000 INTO v_explicit FROM public.journal_entries;
  v_entry := public.create_journal_entry(current_date, '__POSTED_NUMBER_EXPLICIT__',
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'debit', 5, 'credit', 0),
      jsonb_build_object('account_id', v_equity, 'debit', 0, 'credit', 5)
    ), 'posted', v_explicit, 'regular');
  SELECT posted_number INTO v_number FROM public.journal_entries WHERE id = v_entry;
  IF v_number IS DISTINCT FROM v_explicit THEN
    RAISE EXCEPTION 'JOURNAL_EXPLICIT_POSTED_NUMBER_CHANGED';
  END IF;
END;
$scenario_06$;

-- Scenario 07: لا يمكن إدخال قيد مرحل بلا رقم حتى خارج البوابة.
DO $scenario_07$
BEGIN
  BEGIN
    INSERT INTO public.journal_entries(entry_date, description, status, total_debit, total_credit, posted_number)
    VALUES (current_date, '__POSTED_NUMBER_DIRECT_INVALID__', 'posted', 1, 1, NULL);
    RAISE EXCEPTION 'JOURNAL_POSTED_WITHOUT_NUMBER_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%journal_entries_posted_number_required%' THEN RAISE; END IF;
  END;
END;
$scenario_07$;

-- Scenario 08: الحماية رقمية وذرية ولا تحتوي بادئة عرض ثابتة.
DO $scenario_08$
DECLARE
  v_create_def text;
  v_replace_def text;
BEGIN
  SELECT pg_get_functiondef('public.create_journal_entry(date,text,jsonb,text,integer,text)'::regprocedure)
  INTO v_create_def;
  SELECT pg_get_functiondef('public.replace_journal_entry_lines(uuid,jsonb,date,text,text)'::regprocedure)
  INTO v_replace_def;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.journal_entries'::regclass
         AND conname = 'journal_entries_posted_number_required'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'journal_entries'
         AND indexname = 'journal_entries_posted_number_unique'
     )
     OR v_create_def NOT LIKE '%pg_advisory_xact_lock%journal_entries.posted_number%'
     OR v_replace_def NOT LIKE '%pg_advisory_xact_lock%journal_entries.posted_number%'
     OR v_create_def LIKE '%' || chr(74) || chr(86) || chr(45) || '%'
     OR v_replace_def LIKE '%' || chr(74) || chr(86) || chr(45) || '%' THEN
    RAISE EXCEPTION 'JOURNAL_POSTED_NUMBER_GUARDS_INVALID';
  END IF;
END;
$scenario_08$;

SELECT 'JOURNAL_POSTED_NUMBER_INVARIANT_CONTRACT_OK';

ROLLBACK;
