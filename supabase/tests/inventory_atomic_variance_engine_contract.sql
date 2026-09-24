-- The runner starts BEGIN after verifying the fixed offline L3 container.
DO $guard$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres'
     OR to_regprocedure('public.post_inventory_adjustment_atomic(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reverse_inventory_adjustment_atomic(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_ATOMIC_VARIANCE_TEST_ISOLATION_FAILED';
  END IF;
END $guard$;

-- Auth is a fixture in the public-only L3 restore. This replacement is local
-- to the outer transaction and disappears at ROLLBACK.
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
AS $auth$ SELECT 'service_role'::text $auth$;

-- Scenario 01: shortage, official number, repeat, reversal and preservation.
DO $scenario01$
DECLARE p uuid; q numeric; d uuid := gen_random_uuid(); req uuid := gen_random_uuid();
  r jsonb; j uuid; first_op uuid;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-497';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q,q-1,-1,'اختبار عجز');
  r := public.post_inventory_adjustment_atomic(d,req);
  j := (r->>'journal_entry_id')::uuid;
  first_op := (r->>'operation_id')::uuid;
  IF j IS NULL OR (SELECT posted_number FROM public.journal_entries WHERE id=j) IS NULL
     OR (SELECT quantity_on_hand FROM public.products WHERE id=p) <> q-1
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d) <> 'posted'
     OR (SELECT count(*) FROM public.inventory_movements WHERE variance_operation_id=first_op) <> 1
     OR (SELECT count(*) FROM public.journal_entry_lines WHERE journal_entry_id=j) <> 2
  THEN RAISE EXCEPTION 'SCENARIO_01_POST_FAILED'; END IF;
  r := public.post_inventory_adjustment_atomic(d,req);
  IF (r->>'repeated')::boolean IS NOT TRUE OR (r->>'operation_id')::uuid <> first_op
  THEN RAISE EXCEPTION 'SCENARIO_01_REPEAT_FAILED'; END IF;
  r := public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس اختبار');
  IF (SELECT quantity_on_hand FROM public.products WHERE id=p) <> q
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d) <> 'cancelled'
     OR (SELECT count(*) FROM public.inventory_movements WHERE reference_id=d) <> 2
     OR (SELECT count(*) FROM public.inventory_variance_operations WHERE source_id=d) <> 2
     OR (SELECT count(*) FROM public.journal_entry_lines
         WHERE journal_entry_id=(r->>'journal_entry_id')::uuid) <> 2
  THEN RAISE EXCEPTION 'SCENARIO_01_REVERSE_FAILED'; END IF;
  r := public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'تكرار العكس');
  IF (r->>'repeated')::boolean IS NOT TRUE
  THEN RAISE EXCEPTION 'SCENARIO_01_REVERSE_REPEAT_FAILED'; END IF;
END $scenario01$;

-- Scenario 02: mixed shortage/surplus must have four gross journal lines.
DO $scenario02$
DECLARE p1 uuid; p2 uuid; q1 numeric; q2 numeric; d uuid:=gen_random_uuid();
  r jsonb; j uuid;
BEGIN
  SELECT id,quantity_on_hand INTO p1,q1 FROM public.products WHERE code='PRD-497';
  SELECT id,quantity_on_hand INTO p2,q2 FROM public.products WHERE code='PRD-700';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES
    (d,p1,q1,q1-1,-1,'اختبار عجز مختلط'),
    (d,p2,q2,q2+1,1,'اختبار فائض مختلط');
  r:=public.post_inventory_adjustment_atomic(d,gen_random_uuid());
  j:=(r->>'journal_entry_id')::uuid;
  IF (SELECT count(*) FROM public.journal_entry_lines WHERE journal_entry_id=j)<>4
     OR (SELECT count(DISTINCT a.code) FROM public.journal_entry_lines l
         JOIN public.accounts a ON a.id=l.account_id
         WHERE l.journal_entry_id=j)<>3
  THEN RAISE EXCEPTION 'SCENARIO_02_GROSS_JOURNAL_FAILED'; END IF;
  r:=public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس مختلط');
  IF (SELECT count(*) FROM public.journal_entry_lines
      WHERE journal_entry_id=(r->>'journal_entry_id')::uuid)<>4
     OR (SELECT quantity_on_hand FROM public.products WHERE id=p1)<>q1
     OR (SELECT quantity_on_hand FROM public.products WHERE id=p2)<>q2
  THEN RAISE EXCEPTION 'SCENARIO_02_REVERSAL_FAILED'; END IF;
END $scenario02$;

-- Scenario 03: zero difference is posted idempotently without stock or GL effect.
DO $scenario03$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();r jsonb;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-497';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference
  ) VALUES(d,p,q,q,0);
  r:=public.post_inventory_adjustment_atomic(d,gen_random_uuid());
  IF r->>'journal_entry_id' IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE reference_id=d)
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'posted'
  THEN RAISE EXCEPTION 'SCENARIO_03_ZERO_FAILED'; END IF;
  r:=public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس مستند صفري');
  IF r->>'journal_entry_id' IS NOT NULL
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'cancelled'
  THEN RAISE EXCEPTION 'SCENARIO_03_ZERO_REVERSE_FAILED'; END IF;
END $scenario03$;

-- Scenario 04: stale quantity/snapshot must be rejected without effects.
DO $scenario04$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();err text;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-400';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q+1,q,-1,'لقطة قديمة');
  BEGIN
    PERFORM public.post_inventory_adjustment_atomic(d,gen_random_uuid());
    RAISE EXCEPTION 'SCENARIO_04_EXPECTED_REJECTION_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF err <> 'INVENTORY_VARIANCE_PRECONDITION_CHANGED'
    THEN RAISE EXCEPTION 'SCENARIO_04_WRONG_ERROR %',err; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.inventory_variance_operations WHERE source_id=d)
     OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE reference_id=d)
  THEN RAISE EXCEPTION 'SCENARIO_04_PARTIAL_EFFECT'; END IF;
END $scenario04$;

-- Scenario 05: locked accounting period refuses posting.
DO $scenario05$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();old_lock date;err text;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-400';
  SELECT locked_until_date INTO old_lock FROM public.company_settings LIMIT 1;
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q,q-1,-1,'فترة مقفلة');
  UPDATE public.company_settings SET locked_until_date=CURRENT_DATE;
  BEGIN
    PERFORM public.post_inventory_adjustment_atomic(d,gen_random_uuid());
    RAISE EXCEPTION 'SCENARIO_05_EXPECTED_REJECTION_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF err <> 'INVENTORY_VARIANCE_PERIOD_LOCKED'
    THEN RAISE EXCEPTION 'SCENARIO_05_WRONG_ERROR %',err; END IF;
  END;
  UPDATE public.company_settings SET locked_until_date=old_lock;
END $scenario05$;

-- Scenario 06: forced journal failure after quantity/movement must roll back all.
CREATE FUNCTION public.test_reject_variance_journal() RETURNS trigger LANGUAGE plpgsql
AS $reject$ BEGIN RAISE EXCEPTION 'INJECTED_JOURNAL_FAIL'; END $reject$;
CREATE TRIGGER test_reject_variance_journal BEFORE INSERT ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.test_reject_variance_journal();
DO $scenario06$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();err text;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-497';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q,q-1,-1,'فشل مقصود');
  BEGIN
    PERFORM public.post_inventory_adjustment_atomic(d,gen_random_uuid());
    RAISE EXCEPTION 'SCENARIO_06_EXPECTED_FAILURE_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF err <> 'INJECTED_JOURNAL_FAIL'
    THEN RAISE EXCEPTION 'SCENARIO_06_WRONG_ERROR %',err; END IF;
  END;
  IF (SELECT quantity_on_hand FROM public.products WHERE id=p)<>q
     OR (SELECT status FROM public.inventory_adjustments WHERE id=d)<>'draft'
     OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE reference_id=d)
     OR EXISTS(SELECT 1 FROM public.inventory_variance_operations WHERE source_id=d)
  THEN RAISE EXCEPTION 'SCENARIO_06_PARTIAL_POSTING'; END IF;
END $scenario06$;
DROP TRIGGER test_reject_variance_journal ON public.journal_entries;
DROP FUNCTION public.test_reject_variance_journal();

-- Scenario 07: do not reverse a surplus if later stock usage would go negative.
DO $scenario07$
DECLARE p uuid;q numeric;d uuid:=gen_random_uuid();err text;
BEGIN
  SELECT id,quantity_on_hand INTO p,q FROM public.products WHERE code='PRD-700';
  INSERT INTO public.inventory_adjustments(id,adjustment_date,status)
    VALUES(d,CURRENT_DATE,'draft');
  INSERT INTO public.inventory_adjustment_items(
    adjustment_id,product_id,system_quantity,actual_quantity,difference,notes
  ) VALUES(d,p,q,q+1,1,'فائض للاختبار');
  PERFORM public.post_inventory_adjustment_atomic(d,gen_random_uuid());
  UPDATE public.products SET quantity_on_hand=0 WHERE id=p;
  BEGIN
    PERFORM public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس مرفوض');
    RAISE EXCEPTION 'SCENARIO_07_EXPECTED_REJECTION_MISSING';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF err <> 'INVENTORY_VARIANCE_REVERSAL_NEGATIVE_STOCK'
    THEN RAISE EXCEPTION 'SCENARIO_07_WRONG_ERROR %',err; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.inventory_variance_operations
      WHERE source_id=d AND operation_kind='reverse')
  THEN RAISE EXCEPTION 'SCENARIO_07_PARTIAL_REVERSAL'; END IF;
  UPDATE public.products SET quantity_on_hand=q+1 WHERE id=p;
  PERFORM public.reverse_inventory_adjustment_atomic(d,gen_random_uuid(),'عكس بعد زوال المانع');
END $scenario07$;

SELECT 'INVENTORY_ATOMIC_VARIANCE_CONTRACT_OK';
ROLLBACK;
