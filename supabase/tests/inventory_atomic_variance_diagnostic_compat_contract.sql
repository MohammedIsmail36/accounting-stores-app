-- Executed only inside a fixed offline L3 transaction after all migrations.
DO $isolation$
BEGIN
  IF current_database() <> 'l3_public_restore' OR current_user <> 'postgres'
     OR to_regprocedure('public.get_inventory_reconciliation_diagnostic(text,boolean,text,integer,integer,text)') IS NULL
     OR to_regclass('public.inventory_variance_operations') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_VARIANCE_DIAGNOSTIC_TEST_ISOLATION_FAILED';
  END IF;
END $isolation$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
AS $auth$ SELECT 'service_role'::text $auth$;

SELECT set_config('app.variance_diag_doc', gen_random_uuid()::text, true);
SELECT set_config('app.variance_diag_before',
  (public.get_inventory_reconciliation_diagnostic('summary')->'issue_counts')::text,
  true);
INSERT INTO public.inventory_adjustments(id, adjustment_date, status)
VALUES (current_setting('app.variance_diag_doc')::uuid, CURRENT_DATE, 'draft');
INSERT INTO public.inventory_adjustment_items(
  adjustment_id, product_id, system_quantity, actual_quantity, difference, notes
)
SELECT current_setting('app.variance_diag_doc')::uuid, id,
  quantity_on_hand, quantity_on_hand - 1, -1, 'اختبار عكس قابل للتتبع'
FROM public.products WHERE code = 'PRD-497';

SELECT public.post_inventory_adjustment_atomic(
  current_setting('app.variance_diag_doc')::uuid, gen_random_uuid());
SELECT public.reverse_inventory_adjustment_atomic(
  current_setting('app.variance_diag_doc')::uuid, gen_random_uuid(),
  'اختبار توافق التشخيص مع العكس الذري');

DO $matched$
DECLARE
  v_doc uuid := current_setting('app.variance_diag_doc')::uuid;
  v_row jsonb;
  v_after jsonb;
BEGIN
  SELECT value INTO v_row FROM jsonb_array_elements(
    public.get_inventory_reconciliation_diagnostic('sources', false, v_doc::text, 100)->'rows'
  ) WHERE value->>'source_key' = 'adjustment:' || v_doc::text;
  IF v_row IS NULL OR v_row->>'classification' <> 'matched'
     OR (v_row->>'movement_count')::integer <> 2
     OR (v_row->>'movement_quantity')::numeric <> 0
     OR (v_row->>'movement_book_value')::numeric <> 0
     OR (v_row->>'ledger_1104_value')::numeric <> 0
     OR v_row->>'reversal_journal_entry_id' IS NULL
     OR v_row->'reason_codes' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'ATOMIC_REVERSAL_FALSE_DIAGNOSTIC_ISSUE %', v_row;
  END IF;
  v_after := public.get_inventory_reconciliation_diagnostic('summary');
  IF v_after->'issue_counts' IS DISTINCT FROM
       current_setting('app.variance_diag_before')::jsonb THEN
    RAISE EXCEPTION 'ATOMIC_REVERSAL_CHANGED_DIAGNOSTIC_COUNTS';
  END IF;
END $matched$;

-- An unrelated movement on the same source must not be hidden as a valid reverse.
SAVEPOINT extra_movement;
INSERT INTO public.inventory_movements(
  product_id, movement_type, quantity, unit_cost, total_cost,
  reference_id, reference_type, movement_date
)
SELECT product_id, 'adjustment', 1, 1, 1,
  current_setting('app.variance_diag_doc')::uuid, 'adjustment', CURRENT_DATE
FROM public.inventory_adjustment_items
WHERE adjustment_id = current_setting('app.variance_diag_doc')::uuid;
DO $tamper$
DECLARE
  v_doc uuid := current_setting('app.variance_diag_doc')::uuid;
  v_row jsonb;
BEGIN
  SELECT value INTO v_row FROM jsonb_array_elements(
    public.get_inventory_reconciliation_diagnostic('sources', false, v_doc::text, 100)->'rows'
  ) WHERE value->>'source_key' = 'adjustment:' || v_doc::text;
  IF v_row->>'classification' <> 'undocumented_effect' THEN
    RAISE EXCEPTION 'UNLINKED_MOVEMENT_WAS_HIDDEN %', v_row;
  END IF;
END $tamper$;
ROLLBACK TO SAVEPOINT extra_movement;

SELECT 'INVENTORY_ATOMIC_VARIANCE_DIAGNOSTIC_COMPAT_OK';
ROLLBACK;
