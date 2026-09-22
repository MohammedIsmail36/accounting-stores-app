-- Stage 2D-C: server-side bridge between repair drafts and the immutable 2D plan.
-- Browser input may request an accounting date, but journal lines and the plan
-- fingerprint are always rebuilt and stored by the database.

DO $preflight$
BEGIN
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL
     OR to_regclass('public.inventory_reconciliation_repair_items') IS NULL
     OR to_regprocedure('public.fn_prepare_inventory_missing_journal_repair_item()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
         AND tgname = 'trg_prepare_inventory_missing_journal_repair_item'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_UI_BRIDGE_BASELINE_MISMATCH';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.fn_prepare_inventory_missing_journal_repair_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_header_date date;
  v_requested_date date;
  v_effective_date date;
  v_plan jsonb;
BEGIN
  IF NEW.axis <> 'source'
     OR NEW.classification <> 'movement_without_journal'
     OR NEW.repair_type <> 'create_missing_inventory_journal'
     OR NEW.result_status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT status, accounting_date
  INTO v_status, v_header_date
  FROM public.inventory_reconciliation_repairs
  WHERE id = NEW.repair_id
  FOR UPDATE;
  IF NOT FOUND OR v_status <> 'draft' THEN
    RAISE EXCEPTION 'REPAIR_STATUS_INVALID' USING ERRCODE = '55000';
  END IF;

  BEGIN
    v_requested_date := NULLIF(NEW.proposed_state->>'accounting_date', '')::date;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'REPAIR_ACCOUNTING_DATE_INVALID' USING ERRCODE = '22007';
  END;
  IF v_header_date IS NOT NULL
     AND v_requested_date IS NOT NULL
     AND v_header_date IS DISTINCT FROM v_requested_date THEN
    RAISE EXCEPTION 'REPAIR_ACCOUNTING_DATE_CONFLICT' USING ERRCODE = '22023';
  END IF;

  v_plan := public.get_inventory_reconciliation_journal_plan(
    NEW.source_type,
    NEW.source_id,
    COALESCE(v_requested_date, v_header_date)
  );
  IF v_plan->>'reason_code' = 'ACCOUNTING_DATE_REQUIRED' THEN
    RAISE EXCEPTION 'REPAIR_ACCOUNTING_DATE_REQUIRED'
      USING ERRCODE = '22023', DETAIL = v_plan::text;
  END IF;
  IF COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE
     OR v_plan->>'reason_code' <> 'READY'
     OR jsonb_typeof(v_plan->'correction_lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_plan->'correction_lines') = 0
     OR NULLIF(v_plan->>'plan_fingerprint', '') IS NULL
     OR v_plan->>'mode' NOT IN ('create_full_journal', 'post_delta_journal') THEN
    RAISE EXCEPTION 'REPAIR_JOURNAL_PLAN_INVALID'
      USING ERRCODE = '55000', DETAIL = v_plan::text;
  END IF;

  v_effective_date := (v_plan->>'accounting_date')::date;
  IF v_effective_date IS NULL THEN
    RAISE EXCEPTION 'REPAIR_ACCOUNTING_DATE_INVALID' USING ERRCODE = '22007';
  END IF;
  IF v_header_date IS NULL THEN
    UPDATE public.inventory_reconciliation_repairs
    SET accounting_date = v_effective_date,
        updated_at = statement_timestamp()
    WHERE id = NEW.repair_id AND status = 'draft' AND accounting_date IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
    END IF;
  ELSIF v_header_date IS DISTINCT FROM v_effective_date THEN
    RAISE EXCEPTION 'REPAIR_ACCOUNTING_DATE_CONFLICT' USING ERRCODE = '22023';
  END IF;

  NEW.proposed_state := jsonb_build_object(
    'plan_fingerprint', v_plan->>'plan_fingerprint',
    'mode', v_plan->>'mode',
    'accounting_date', v_plan->>'accounting_date',
    'correction_lines', v_plan->'correction_lines'
  );
  NEW.precondition_hash := md5(jsonb_build_object(
    'axis', NEW.axis,
    'issue_key', NEW.issue_key,
    'diagnostic', NEW.before_state,
    'repair_type', NEW.repair_type,
    'proposed_state', NEW.proposed_state
  )::text);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_prepare_inventory_missing_journal_repair_item()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_prepare_inventory_missing_journal_repair_item
BEFORE INSERT OR UPDATE OF axis, classification, repair_type, source_type,
  source_id, proposed_state, before_state
ON public.inventory_reconciliation_repair_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_prepare_inventory_missing_journal_repair_item();

COMMENT ON FUNCTION public.fn_prepare_inventory_missing_journal_repair_item()
IS 'Stage 2D-C internal trigger: stores a server-derived journal plan and accounting date for missing-journal repair drafts; never trusts browser journal lines.';

DO $postcheck$
BEGIN
  IF to_regprocedure('public.fn_prepare_inventory_missing_journal_repair_item()') IS NULL
     OR (SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'public.inventory_reconciliation_repair_items'::regclass
           AND tgname = 'trg_prepare_inventory_missing_journal_repair_item'
           AND NOT tgisinternal) <> 1
     OR has_function_privilege('anon',
          'public.fn_prepare_inventory_missing_journal_repair_item()', 'EXECUTE')
     OR has_function_privilege('authenticated',
          'public.fn_prepare_inventory_missing_journal_repair_item()', 'EXECUTE') THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_UI_BRIDGE_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
