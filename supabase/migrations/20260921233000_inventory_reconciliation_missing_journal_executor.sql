-- Stage 2D-B: atomic missing-inventory-journal executor.
-- Keeps the original posted journal immutable, creates an append-only full or
-- delta journal, and records the new journal in the repair audit trail.

DO $guard$
BEGIN
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NOT NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair(uuid,integer,uuid)') IS NULL
     OR to_regprocedure('public.execute_inventory_reconciliation_repair_rebuild_2c(uuid,integer,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'INVENTORY_MISSING_JOURNAL_EXECUTOR_BASELINE_MISMATCH';
  END IF;
END;
$guard$;

ALTER FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  RENAME TO get_inventory_reconciliation_journal_plan_base_2da;
REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(text, uuid, date)
  FROM PUBLIC, anon, authenticated;

-- Overlay the immutable correction journals recorded by an approved/executed
-- repair on top of the 2D-A plan. With no such effects, the original plan and
-- fingerprint are returned byte-for-byte.
CREATE FUNCTION public.get_inventory_reconciliation_journal_plan(
  p_source_type text,
  p_source_id uuid,
  p_accounting_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_base jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_remaining jsonb := '[]'::jsonb;
  v_applied_count integer := 0;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_result jsonb;
  v_core jsonb;
BEGIN
  v_base := public.get_inventory_reconciliation_journal_plan_base_2da(
    p_source_type, p_source_id, p_accounting_date
  );

  IF p_source_id IS NULL
     OR jsonb_typeof(v_base->'correction_lines') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_base->'correction_lines') = 0 THEN
    RETURN v_base;
  END IF;

  SELECT count(DISTINCT e.record_id)
  INTO v_applied_count
  FROM public.inventory_reconciliation_repair_items i
  JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
  JOIN public.inventory_reconciliation_repair_effects e
    ON e.repair_item_id = i.id
    AND e.effect_type = 'missing_inventory_journal_created'
    AND e.table_name = 'journal_entries'
  JOIN public.journal_entries j ON j.id = e.record_id AND j.status = 'posted'
  WHERE i.axis = 'source'
    AND i.repair_type = 'create_missing_inventory_journal'
    AND i.source_type = lower(btrim(COALESCE(p_source_type, '')))
    AND i.source_id = p_source_id
    AND r.status IN ('approved', 'executed');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_code', x.code,
    'debit', CASE WHEN x.net > 0 THEN x.net ELSE 0 END,
    'credit', CASE WHEN x.net < 0 THEN abs(x.net) ELSE 0 END
  ) ORDER BY x.code), '[]'::jsonb)
  INTO v_applied
  FROM (
    SELECT a.code, round(sum(l.debit - l.credit), 2) AS net
    FROM public.inventory_reconciliation_repair_items i
    JOIN public.inventory_reconciliation_repairs r ON r.id = i.repair_id
    JOIN public.inventory_reconciliation_repair_effects e
      ON e.repair_item_id = i.id
      AND e.effect_type = 'missing_inventory_journal_created'
      AND e.table_name = 'journal_entries'
    JOIN public.journal_entries j ON j.id = e.record_id AND j.status = 'posted'
    JOIN public.journal_entry_lines l ON l.journal_entry_id = j.id
    JOIN public.accounts a ON a.id = l.account_id
    WHERE i.axis = 'source'
      AND i.repair_type = 'create_missing_inventory_journal'
      AND i.source_type = lower(btrim(COALESCE(p_source_type, '')))
      AND i.source_id = p_source_id
      AND r.status IN ('approved', 'executed')
    GROUP BY a.code
  ) x
  WHERE x.net <> 0;

  IF v_applied_count = 0 THEN
    RETURN v_base;
  END IF;

  WITH planned AS (
    SELECT line->>'account_code' AS code,
      sum(COALESCE((line->>'debit')::numeric, 0)
        - COALESCE((line->>'credit')::numeric, 0)) AS net
    FROM jsonb_array_elements(v_base->'correction_lines') line
    GROUP BY line->>'account_code'
  ), applied AS (
    SELECT line->>'account_code' AS code,
      sum(COALESCE((line->>'debit')::numeric, 0)
        - COALESCE((line->>'credit')::numeric, 0)) AS net
    FROM jsonb_array_elements(v_applied) line
    GROUP BY line->>'account_code'
  ), residual AS (
    SELECT COALESCE(p.code, a.code) AS code,
      round(COALESCE(p.net, 0) - COALESCE(a.net, 0), 2) AS net
    FROM planned p FULL JOIN applied a USING (code)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_code', code,
    'debit', CASE WHEN net > 0 THEN net ELSE 0 END,
    'credit', CASE WHEN net < 0 THEN abs(net) ELSE 0 END
  ) ORDER BY code), '[]'::jsonb)
  INTO v_remaining
  FROM residual
  WHERE net <> 0;

  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_debit, v_credit
  FROM jsonb_array_elements(v_remaining) line;

  v_result := v_base || jsonb_build_object(
    'applied_correction_lines', v_applied,
    'applied_correction_journal_count', v_applied_count,
    'correction_lines', v_remaining,
    'eligible', v_debit = v_credit AND v_debit > 0,
    'reason_code', CASE
      WHEN jsonb_array_length(v_remaining) = 0 THEN 'NO_CORRECTION_REQUIRED'
      WHEN v_debit = v_credit AND v_debit > 0 THEN 'READY'
      ELSE 'POSTED_CORRECTION_MISMATCH'
    END
  );
  v_core := v_result - ARRAY['eligible', 'reason_code', 'plan_fingerprint'];
  RETURN jsonb_set(v_result, '{plan_fingerprint}', to_jsonb(md5(v_core::text)), true);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  IS 'Stage 2D-B planner overlay: includes append-only correction journals recorded by executed inventory reconciliation repairs.';

ALTER FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  RENAME TO execute_inventory_reconciliation_repair_rebuild_2c;
REVOKE ALL ON FUNCTION public.execute_inventory_reconciliation_repair_rebuild_2c(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.execute_inventory_reconciliation_repair(
  p_id uuid,
  p_expected_version integer,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_repair public.inventory_reconciliation_repairs%ROWTYPE;
  v_item public.inventory_reconciliation_repair_items%ROWTYPE;
  v_replay jsonb;
  v_result jsonb;
  v_item_count integer;
  v_rebuild_count integer;
  v_missing_count integer;
  v_diagnostic jsonb;
  v_current_row jsonb;
  v_current_hash text;
  v_plan jsonb;
  v_after_plan jsonb;
  v_lines jsonb;
  v_journal_id uuid;
  v_current_journal_id uuid;
  v_description text;
  v_linked integer;
BEGIN
  SELECT count(*),
    count(*) FILTER (WHERE repair_type = 'rebuild_product_card'),
    count(*) FILTER (WHERE repair_type = 'create_missing_inventory_journal')
  INTO v_item_count, v_rebuild_count, v_missing_count
  FROM public.inventory_reconciliation_repair_items
  WHERE repair_id = p_id;

  -- Preserve the already accepted 2C implementation without copying it.
  IF v_item_count = 0 OR v_rebuild_count = v_item_count THEN
    RETURN public.execute_inventory_reconciliation_repair_rebuild_2c(
      p_id, p_expected_version, p_request_id
    );
  END IF;
  IF v_missing_count <> v_item_count THEN
    RAISE EXCEPTION 'REPAIR_TYPE_NOT_ENABLED' USING ERRCODE = '0A000';
  END IF;

  v_actor := public.inventory_reconciliation_repair_require_actor(true);
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'REPAIR_REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('inventory-repair-request:' || p_request_id::text, 0));
  v_replay := public.inventory_reconciliation_repair_replay(
    p_request_id, 'executed', v_actor);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT * INTO v_repair
  FROM public.inventory_reconciliation_repairs
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_repair.status <> 'approved' THEN
    RAISE EXCEPTION 'REPAIR_STATUS_INVALID' USING ERRCODE = '55000';
  END IF;
  IF v_repair.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'REPAIR_VERSION_CONFLICT' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_reconciliation_repair_effects WHERE repair_id = p_id) THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_repair_items i
    WHERE i.repair_id = p_id AND (
      i.axis <> 'source'
      OR i.classification <> 'movement_without_journal'
      OR i.repair_type <> 'create_missing_inventory_journal'
      OR i.source_type NOT IN ('sales_invoice', 'sales_return', 'purchase_invoice', 'purchase_return', 'adjustment')
      OR i.source_id IS NULL
      OR i.result_status <> 'pending'
      OR NULLIF(i.proposed_state->>'plan_fingerprint', '') IS NULL
      OR jsonb_typeof(i.proposed_state->'correction_lines') IS DISTINCT FROM 'array'
    )
  ) THEN
    RAISE EXCEPTION 'REPAIR_TYPE_NOT_ENABLED' USING ERRCODE = '0A000';
  END IF;

  FOR v_item IN
    SELECT * FROM public.inventory_reconciliation_repair_items
    WHERE repair_id = p_id
    ORDER BY source_type, source_id, line_number
    FOR UPDATE
  LOOP
    -- Local source lock. Official document operations lock/update the same row.
    IF v_item.source_type = 'sales_invoice' THEN
      SELECT journal_entry_id INTO v_current_journal_id
      FROM public.sales_invoices WHERE id = v_item.source_id FOR UPDATE;
    ELSIF v_item.source_type = 'sales_return' THEN
      SELECT journal_entry_id INTO v_current_journal_id
      FROM public.sales_returns WHERE id = v_item.source_id FOR UPDATE;
    ELSIF v_item.source_type = 'purchase_invoice' THEN
      SELECT journal_entry_id INTO v_current_journal_id
      FROM public.purchase_invoices WHERE id = v_item.source_id FOR UPDATE;
    ELSIF v_item.source_type = 'purchase_return' THEN
      SELECT journal_entry_id INTO v_current_journal_id
      FROM public.purchase_returns WHERE id = v_item.source_id FOR UPDATE;
    ELSE
      SELECT journal_entry_id INTO v_current_journal_id
      FROM public.inventory_adjustments WHERE id = v_item.source_id FOR UPDATE;
    END IF;
    IF NOT FOUND OR v_current_journal_id IS DISTINCT FROM v_item.original_journal_entry_id THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
    END IF;

    v_diagnostic := public.get_inventory_reconciliation_diagnostic(
      'sources', false, v_item.source_id::text, 500, 0, NULL);
    v_current_row := NULL;
    SELECT value INTO v_current_row
    FROM jsonb_array_elements(v_diagnostic->'rows')
    WHERE value->>'source_type' = v_item.source_type
      AND value->>'source_id' = v_item.source_id::text
    LIMIT 1;
    v_current_hash := md5(jsonb_build_object(
      'axis', v_item.axis,
      'issue_key', v_item.issue_key,
      'diagnostic', v_current_row,
      'repair_type', v_item.repair_type,
      'proposed_state', v_item.proposed_state
    )::text);
    IF v_current_row IS NULL
       OR v_current_row->>'classification' <> 'movement_without_journal'
       OR v_current_hash IS DISTINCT FROM v_item.precondition_hash THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
    END IF;

    v_plan := public.get_inventory_reconciliation_journal_plan(
      v_item.source_type, v_item.source_id, v_repair.accounting_date);
    IF COALESCE((v_plan->>'eligible')::boolean, false) IS NOT TRUE
       OR v_plan->>'reason_code' <> 'READY'
       OR v_plan->>'plan_fingerprint' IS DISTINCT FROM v_item.proposed_state->>'plan_fingerprint'
       OR v_plan->>'mode' IS DISTINCT FROM v_item.proposed_state->>'mode'
       OR v_plan->'correction_lines' IS DISTINCT FROM v_item.proposed_state->'correction_lines'
       OR (v_plan->>'accounting_date')::date IS DISTINCT FROM v_repair.accounting_date THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED'
        USING ERRCODE = '40001', DETAIL = jsonb_build_object(
          'eligible', COALESCE((v_plan->>'eligible')::boolean, false),
          'reason_code', v_plan->>'reason_code',
          'fingerprint_matches', v_plan->>'plan_fingerprint'
            IS NOT DISTINCT FROM v_item.proposed_state->>'plan_fingerprint',
          'mode_matches', v_plan->>'mode'
            IS NOT DISTINCT FROM v_item.proposed_state->>'mode',
          'lines_match', v_plan->'correction_lines'
            IS NOT DISTINCT FROM v_item.proposed_state->'correction_lines',
          'accounting_date_matches', (v_plan->>'accounting_date')::date
            IS NOT DISTINCT FROM v_repair.accounting_date
        )::text;
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
      'account_id', a.id,
      'debit', (line->>'debit')::numeric,
      'credit', (line->>'credit')::numeric,
      'description', 'معالجة مطابقة المخزون ' || v_item.source_number
    ) ORDER BY line->>'account_code')
    INTO v_lines
    FROM jsonb_array_elements(v_plan->'correction_lines') line
    JOIN LATERAL (
      SELECT account.id
      FROM public.accounts account
      WHERE account.code = line->>'account_code'
      ORDER BY account.id
      LIMIT 1
    ) a ON true;
    IF v_lines IS NULL
       OR jsonb_array_length(v_lines) <> jsonb_array_length(v_plan->'correction_lines') THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
    END IF;

    v_description := 'قيد تصحيحي لمطابقة المخزون — '
      || v_item.source_type || ' ' || COALESCE(v_item.source_number, v_item.source_id::text)
      || ' — معالجة ' || v_repair.repair_number;
    v_journal_id := public.create_journal_entry(
      v_repair.accounting_date, v_description, v_lines, 'posted', NULL, 'regular');

    IF v_plan->>'mode' = 'create_full_journal' THEN
      IF v_item.source_type = 'sales_invoice' THEN
        UPDATE public.sales_invoices SET journal_entry_id = v_journal_id
        WHERE id = v_item.source_id AND journal_entry_id IS NULL;
      ELSIF v_item.source_type = 'sales_return' THEN
        UPDATE public.sales_returns SET journal_entry_id = v_journal_id
        WHERE id = v_item.source_id AND journal_entry_id IS NULL;
      ELSIF v_item.source_type = 'purchase_invoice' THEN
        UPDATE public.purchase_invoices SET journal_entry_id = v_journal_id
        WHERE id = v_item.source_id AND journal_entry_id IS NULL;
      ELSIF v_item.source_type = 'purchase_return' THEN
        UPDATE public.purchase_returns SET journal_entry_id = v_journal_id
        WHERE id = v_item.source_id AND journal_entry_id IS NULL;
      ELSE
        UPDATE public.inventory_adjustments SET journal_entry_id = v_journal_id
        WHERE id = v_item.source_id AND journal_entry_id IS NULL;
      END IF;
      GET DIAGNOSTICS v_linked = ROW_COUNT;
      IF v_linked <> 1 THEN
        RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
      END IF;
    ELSIF v_plan->>'mode' <> 'post_delta_journal' THEN
      RAISE EXCEPTION 'REPAIR_PRECONDITION_CHANGED' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.inventory_reconciliation_repair_effects(
      repair_id, repair_item_id, effect_type, table_name, record_id,
      before_data, after_data
    ) VALUES (
      p_id, v_item.id, 'missing_inventory_journal_created', 'journal_entries', v_journal_id,
      jsonb_build_object(
        'plan_fingerprint', v_plan->>'plan_fingerprint',
        'mode', v_plan->>'mode',
        'original_journal_entry_id', v_item.original_journal_entry_id,
        'correction_lines', v_plan->'correction_lines'
      ),
      jsonb_build_object(
        'journal_entry_id', v_journal_id,
        'status', 'posted',
        'accounting_date', v_repair.accounting_date
      )
    );

    v_after_plan := public.get_inventory_reconciliation_journal_plan(
      v_item.source_type, v_item.source_id, v_repair.accounting_date);
    IF v_after_plan->>'reason_code' <> 'NO_CORRECTION_REQUIRED'
       OR jsonb_array_length(COALESCE(v_after_plan->'correction_lines', '[]'::jsonb)) <> 0 THEN
      RAISE EXCEPTION 'REPAIR_POSTCHECK_FAILED' USING ERRCODE = '40001';
    END IF;

    UPDATE public.inventory_reconciliation_repair_items
    SET after_movement_quantity = before_movement_quantity,
        after_movement_book_value = before_movement_book_value,
        after_ledger_1104_value = (v_plan->>'target_ledger_1104_value')::numeric,
        after_state = jsonb_build_object(
          'journal_entry_id', v_journal_id,
          'plan', v_after_plan
        ),
        result_status = 'applied',
        result_message = 'أُنشئ قيد تصحيحي مرحل دون تعديل الحركة أو القيد الأصلي',
        updated_at = statement_timestamp()
    WHERE id = v_item.id;
  END LOOP;

  UPDATE public.inventory_reconciliation_repairs
  SET status = 'executed', executed_by = v_actor,
      executed_at = statement_timestamp(), version = version + 1,
      updated_at = statement_timestamp()
  WHERE id = p_id;

  v_result := public.inventory_reconciliation_repair_result(p_id);
  INSERT INTO public.inventory_reconciliation_repair_events(
    repair_id, event_type, from_status, to_status, request_id, actor_id, event_data
  ) VALUES (
    p_id, 'executed', 'approved', 'executed', p_request_id, v_actor,
    jsonb_build_object(
      'result', v_result,
      'executor', 'create_missing_inventory_journal',
      'applied_items', v_item_count
    )
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_inventory_reconciliation_repair(uuid, integer, uuid)
  IS 'Stage 2D-B dispatcher: preserves 2C product-card rebuilds and atomically creates append-only full or delta inventory correction journals.';
