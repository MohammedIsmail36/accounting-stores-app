-- The runner executes this only inside an outer L3 transaction.
DO $isolation$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres'
     OR to_regprocedure('public.fn_guard_inventory_adjustment_document()') IS NULL
     OR has_function_privilege('authenticated',
       'public.adjust_product_quantity(uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_WRITE_GUARD_TEST_ISOLATION_FAILED';
  END IF;
END $isolation$;

-- Public-only L3 auth fixtures are changed transactionally and rolled back.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $auth$ SELECT 'af3af326-6875-4057-8870-de09dfd90fca'::uuid $auth$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
AS $auth$ SELECT 'authenticated'::text $auth$;

SELECT set_config('app.variance_guard_doc', gen_random_uuid()::text, true);
SELECT set_config('app.variance_guard_delete_doc', gen_random_uuid()::text, true);
INSERT INTO public.inventory_adjustments(id, adjustment_date, status, created_by)
VALUES
  (current_setting('app.variance_guard_doc')::uuid, CURRENT_DATE, 'draft',
    'af3af326-6875-4057-8870-de09dfd90fca'::uuid),
  (current_setting('app.variance_guard_delete_doc')::uuid, CURRENT_DATE, 'draft',
    'af3af326-6875-4057-8870-de09dfd90fca'::uuid);
INSERT INTO public.inventory_adjustment_items(
  adjustment_id, product_id, system_quantity, actual_quantity, difference, notes
)
SELECT current_setting('app.variance_guard_doc')::uuid, id,
  quantity_on_hand, quantity_on_hand - 1, -1, 'فرق تجريبي موثق'
FROM public.products WHERE code = 'PRD-497';
INSERT INTO public.inventory_adjustment_items(
  adjustment_id, product_id, system_quantity, actual_quantity, difference
)
SELECT current_setting('app.variance_guard_delete_doc')::uuid, id,
  quantity_on_hand, quantity_on_hand, 0
FROM public.products WHERE code = 'PRD-497';

SELECT set_config('app.variance_guard_diff_before', (
  (SELECT COALESCE(sum(CASE
    WHEN m.movement_type::text = 'adjustment' THEN sign(m.quantity) * abs(m.total_cost)
    WHEN m.movement_type::text IN ('sale', 'purchase_return') THEN -abs(m.total_cost)
    ELSE abs(m.total_cost) END), 0) FROM public.inventory_movements m)
  - (SELECT COALESCE(sum(l.debit - l.credit), 0)
     FROM public.journal_entry_lines l
     JOIN public.journal_entries j ON j.id = l.journal_entry_id
     JOIN public.accounts a ON a.id = l.account_id
     WHERE a.code = '1104' AND j.status = 'posted')
)::text, true);

SET LOCAL ROLE authenticated;
DO $direct$
DECLARE
  v_doc uuid := current_setting('app.variance_guard_doc')::uuid;
  v_product uuid;
  v_error text;
BEGIN
  UPDATE public.inventory_adjustments SET description = 'مسودة مسموحة' WHERE id = v_doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_EDIT_UNEXPECTEDLY_BLOCKED'; END IF;
  UPDATE public.inventory_adjustment_items SET notes = 'سبب عجز واضح'
  WHERE adjustment_id = v_doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_ITEM_EDIT_UNEXPECTEDLY_BLOCKED'; END IF;
  DELETE FROM public.inventory_adjustment_items
  WHERE adjustment_id = current_setting('app.variance_guard_delete_doc')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_ITEM_DELETE_UNEXPECTEDLY_BLOCKED'; END IF;
  DELETE FROM public.inventory_adjustments
  WHERE id = current_setting('app.variance_guard_delete_doc')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_DELETE_UNEXPECTEDLY_BLOCKED'; END IF;
  BEGIN
    UPDATE public.inventory_adjustments SET status = 'approved' WHERE id = v_doc;
    RAISE EXCEPTION 'LEGACY_STATUS_WRITE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED' THEN
      RAISE EXCEPTION 'WRONG_HEADER_GUARD_ERROR %', v_error;
    END IF;
  END;
  SELECT product_id INTO v_product FROM public.inventory_adjustment_items
  WHERE adjustment_id = v_doc;
  BEGIN
    INSERT INTO public.inventory_movements(
      product_id, movement_type, quantity, unit_cost, total_cost,
      reference_id, reference_type, movement_date
    ) VALUES (v_product, 'adjustment', -1, 1, 1, v_doc, 'adjustment', CURRENT_DATE);
    RAISE EXCEPTION 'LEGACY_MOVEMENT_WRITE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED' THEN
      RAISE EXCEPTION 'WRONG_MOVEMENT_GUARD_ERROR %', v_error;
    END IF;
  END;
END $direct$;

SELECT public.post_inventory_adjustment_atomic(
  current_setting('app.variance_guard_doc')::uuid, gen_random_uuid());
RESET ROLE;
DO $ledger_post$
DECLARE v_diff numeric;
BEGIN
  SELECT
    (SELECT COALESCE(sum(CASE
      WHEN m.movement_type::text = 'adjustment' THEN sign(m.quantity) * abs(m.total_cost)
      WHEN m.movement_type::text IN ('sale', 'purchase_return') THEN -abs(m.total_cost)
      ELSE abs(m.total_cost) END), 0) FROM public.inventory_movements m)
    - (SELECT COALESCE(sum(l.debit - l.credit), 0)
       FROM public.journal_entry_lines l
       JOIN public.journal_entries j ON j.id = l.journal_entry_id
       JOIN public.accounts a ON a.id = l.account_id
       WHERE a.code = '1104' AND j.status = 'posted') INTO v_diff;
  IF v_diff IS DISTINCT FROM current_setting('app.variance_guard_diff_before')::numeric THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_LEDGER_DRIFT_CREATED %', v_diff;
  END IF;
END $ledger_post$;
SET LOCAL ROLE authenticated;

DO $after_post$
DECLARE
  v_doc uuid := current_setting('app.variance_guard_doc')::uuid;
  v_error text;
BEGIN
  IF (SELECT status FROM public.inventory_adjustments WHERE id = v_doc) <> 'posted'
     OR (SELECT count(*) FROM public.inventory_movements
       WHERE reference_id = v_doc AND variance_operation_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'ATOMIC_GATEWAY_UNEXPECTEDLY_BLOCKED';
  END IF;
  BEGIN
    UPDATE public.inventory_adjustment_items SET notes = 'تلاعب بعد الترحيل'
    WHERE adjustment_id = v_doc;
    RAISE EXCEPTION 'POSTED_ITEM_WRITE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED' THEN
      RAISE EXCEPTION 'WRONG_POSTED_ITEM_GUARD_ERROR %', v_error;
    END IF;
  END;
  BEGIN
    DELETE FROM public.inventory_movements WHERE reference_id = v_doc;
    RAISE EXCEPTION 'POSTED_MOVEMENT_DELETE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'INVENTORY_VARIANCE_DIRECT_WRITE_DENIED' THEN
      RAISE EXCEPTION 'WRONG_POSTED_MOVEMENT_GUARD_ERROR %', v_error;
    END IF;
  END;
END $after_post$;

SELECT public.reverse_inventory_adjustment_atomic(
  current_setting('app.variance_guard_doc')::uuid, gen_random_uuid(),
  'اختبار العكس بعد إغلاق الكتابة المباشرة');
RESET ROLE;
DO $ledger_reverse$
DECLARE v_diff numeric;
BEGIN
  SELECT
    (SELECT COALESCE(sum(CASE
      WHEN m.movement_type::text = 'adjustment' THEN sign(m.quantity) * abs(m.total_cost)
      WHEN m.movement_type::text IN ('sale', 'purchase_return') THEN -abs(m.total_cost)
      ELSE abs(m.total_cost) END), 0) FROM public.inventory_movements m)
    - (SELECT COALESCE(sum(l.debit - l.credit), 0)
       FROM public.journal_entry_lines l
       JOIN public.journal_entries j ON j.id = l.journal_entry_id
       JOIN public.accounts a ON a.id = l.account_id
       WHERE a.code = '1104' AND j.status = 'posted') INTO v_diff;
  IF v_diff IS DISTINCT FROM current_setting('app.variance_guard_diff_before')::numeric THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_REVERSAL_LEDGER_DRIFT_CREATED %', v_diff;
  END IF;
END $ledger_reverse$;
SELECT 'INVENTORY_ATOMIC_VARIANCE_WRITE_GUARD_OK';
ROLLBACK;
