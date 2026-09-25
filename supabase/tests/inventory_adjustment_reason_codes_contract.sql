-- Phase 4C contract: run only after the additive reason-code migration.
DO $contract$
DECLARE
  v_save text;
  v_post text;
  v_constraint text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_adjustment_items'
      AND column_name = 'reason_code' AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_adjustment_items'
      AND column_name = 'reason_reference' AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASON_COLUMNS_MISSING';
  END IF;

  SELECT string_agg(pg_get_constraintdef(c.oid), ' ') INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.inventory_adjustment_items'::regclass
    AND c.contype = 'c';
  IF v_constraint IS NULL OR NOT (
    v_constraint LIKE '%damage%' AND v_constraint LIKE '%loss%'
    AND v_constraint LIKE '%found_stock%' AND v_constraint LIKE '%internal_use%'
    AND v_constraint LIKE '%sample%' AND v_constraint LIKE '%prior_entry_error%'
    AND v_constraint LIKE '%other%'
  ) THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASON_CODE_CHECK_MISSING';
  END IF;

  SELECT pg_get_functiondef(
    'public.save_inventory_adjustment_draft(uuid,timestamptz,date,text,jsonb)'::regprocedure
  ) INTO v_save;
  SELECT pg_get_functiondef(
    'public.post_inventory_adjustment_atomic(uuid,uuid)'::regprocedure
  ) INTO v_post;
  IF v_save NOT LIKE '%reason_code%'
     OR v_save NOT LIKE '%reason_reference%'
     OR v_post NOT LIKE '%reason_code%' THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASON_SERVER_VALIDATION_MISSING';
  END IF;
END $contract$;

SELECT 'INVENTORY_ADJUSTMENT_REASON_CONTRACT_OK';
