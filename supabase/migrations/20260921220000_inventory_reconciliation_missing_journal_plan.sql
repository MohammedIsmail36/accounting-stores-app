-- Stage 2D-A: read-only accounting plan for a recorded inventory movement
-- whose source has no complete posted journal effect. This migration creates
-- no journals and changes no business data.

CREATE OR REPLACE FUNCTION public.get_inventory_reconciliation_journal_plan(
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
  v_source_type text := lower(btrim(COALESCE(p_source_type, '')));
  v_source_status text;
  v_source_date date;
  v_source_number text;
  v_journal_id uuid;
  v_journal_status text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_net numeric := 0;
  v_movement_count integer := 0;
  v_movement_book_value numeric := 0;
  v_movement_types_valid boolean := false;
  v_locked_until date;
  v_effective_date date;
  v_sales_tax_account uuid;
  v_purchase_tax_account uuid;
  v_expected jsonb := '[]'::jsonb;
  v_actual jsonb := '[]'::jsonb;
  v_correction jsonb := '[]'::jsonb;
  v_allowed_codes text[];
  v_required_codes text[] := ARRAY[]::text[];
  v_missing_codes text[];
  v_unexpected_codes text[];
  v_expected_debit numeric := 0;
  v_expected_credit numeric := 0;
  v_actual_debit numeric := 0;
  v_actual_credit numeric := 0;
  v_correction_debit numeric := 0;
  v_correction_credit numeric := 0;
  v_variance numeric := 0;
  v_mode text;
  v_reason text := 'READY';
  v_eligible boolean := true;
  v_plan_core jsonb;
  v_plan_fingerprint text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'accountant'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'غير مصرح بالوصول إلى مخطط القيد التصحيحي'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_id IS NULL OR v_source_type NOT IN (
    'sales_invoice', 'sales_return', 'purchase_invoice',
    'purchase_return', 'adjustment'
  ) THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'SOURCE_TYPE_NOT_SUPPORTED',
      'source_type', NULLIF(v_source_type, ''),
      'source_id', p_source_id
    );
  END IF;

  IF v_source_type = 'sales_invoice' THEN
    SELECT status, invoice_date,
      COALESCE(posted_number, invoice_number)::text,
      journal_entry_id, subtotal, discount, tax, total
    INTO v_source_status, v_source_date, v_source_number, v_journal_id,
      v_subtotal, v_discount, v_tax, v_total
    FROM public.sales_invoices WHERE id = p_source_id;
  ELSIF v_source_type = 'sales_return' THEN
    SELECT status, return_date,
      COALESCE(posted_number, return_number)::text,
      journal_entry_id, subtotal, discount, tax, total
    INTO v_source_status, v_source_date, v_source_number, v_journal_id,
      v_subtotal, v_discount, v_tax, v_total
    FROM public.sales_returns WHERE id = p_source_id;
  ELSIF v_source_type = 'purchase_invoice' THEN
    SELECT status, invoice_date,
      COALESCE(posted_number, invoice_number)::text,
      journal_entry_id, subtotal, discount, tax, total
    INTO v_source_status, v_source_date, v_source_number, v_journal_id,
      v_subtotal, v_discount, v_tax, v_total
    FROM public.purchase_invoices WHERE id = p_source_id;
  ELSIF v_source_type = 'purchase_return' THEN
    SELECT status, return_date,
      COALESCE(posted_number, return_number)::text,
      journal_entry_id, subtotal, discount, tax, total
    INTO v_source_status, v_source_date, v_source_number, v_journal_id,
      v_subtotal, v_discount, v_tax, v_total
    FROM public.purchase_returns WHERE id = p_source_id;
  ELSE
    SELECT status, adjustment_date, adjustment_number::text, journal_entry_id
    INTO v_source_status, v_source_date, v_source_number, v_journal_id
    FROM public.inventory_adjustments WHERE id = p_source_id;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'SOURCE_NOT_FOUND',
      'source_type', v_source_type,
      'source_id', p_source_id
    );
  END IF;

  IF v_source_status IS DISTINCT FROM 'posted' THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'SOURCE_NOT_POSTED',
      'source_type', v_source_type,
      'source_id', p_source_id,
      'source_status', v_source_status
    );
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum(CASE
      WHEN m.movement_type::text = 'adjustment'
        THEN sign(COALESCE(m.quantity, 0)) * abs(COALESCE(m.total_cost, 0))
      WHEN m.movement_type::text IN ('sale', 'purchase_return')
        THEN -abs(COALESCE(m.total_cost, 0))
      ELSE abs(COALESCE(m.total_cost, 0))
    END), 0),
    COALESCE(bool_and(m.movement_type::text = CASE v_source_type
      WHEN 'sales_invoice' THEN 'sale'
      WHEN 'sales_return' THEN 'sale_return'
      WHEN 'purchase_invoice' THEN 'purchase'
      WHEN 'purchase_return' THEN 'purchase_return'
      ELSE 'adjustment'
    END), false)
  INTO v_movement_count, v_movement_book_value, v_movement_types_valid
  FROM public.inventory_movements m
  WHERE m.reference_id = p_source_id
    AND CASE WHEN m.reference_type = 'inventory_adjustment' THEN 'adjustment'
      ELSE m.reference_type END = v_source_type;

  v_movement_book_value := round(v_movement_book_value, 2);
  IF v_movement_count = 0 OR NOT v_movement_types_valid OR v_movement_book_value = 0 THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'MOVEMENT_EVIDENCE_INVALID',
      'source_type', v_source_type,
      'source_id', p_source_id,
      'movement_count', v_movement_count,
      'movement_book_value', v_movement_book_value
    );
  END IF;

  SELECT locked_until_date, sales_tax_account_id, purchase_tax_account_id
  INTO v_locked_until, v_sales_tax_account, v_purchase_tax_account
  FROM public.company_settings
  ORDER BY created_at
  LIMIT 1;

  IF v_locked_until IS NOT NULL AND v_source_date <= v_locked_until
     AND p_accounting_date IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'ACCOUNTING_DATE_REQUIRED',
      'source_type', v_source_type,
      'source_id', p_source_id,
      'source_date', v_source_date,
      'locked_until_date', v_locked_until
    );
  END IF;

  v_effective_date := COALESCE(p_accounting_date, v_source_date);
  IF v_effective_date IS NULL
     OR (v_locked_until IS NOT NULL AND v_effective_date <= v_locked_until) THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'ACCOUNTING_DATE_LOCKED',
      'source_type', v_source_type,
      'source_id', p_source_id,
      'source_date', v_source_date,
      'accounting_date', v_effective_date,
      'locked_until_date', v_locked_until
    );
  END IF;

  IF v_journal_id IS NOT NULL THEN
    SELECT status INTO v_journal_status
    FROM public.journal_entries WHERE id = v_journal_id;
    IF NOT FOUND OR v_journal_status IS DISTINCT FROM 'posted' THEN
      RETURN jsonb_build_object(
        'eligible', false,
        'reason_code', 'JOURNAL_DRAFT_REQUIRES_REVIEW',
        'source_type', v_source_type,
        'source_id', p_source_id,
        'original_journal_entry_id', v_journal_id,
        'journal_status', v_journal_status
      );
    END IF;
  END IF;

  v_tax := round(COALESCE(v_tax, 0), 2);
  v_total := round(COALESCE(v_total, 0), 2);
  v_net := round(v_total - v_tax, 2);
  IF v_source_type <> 'adjustment' AND (v_total <= 0 OR v_net < 0) THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'SOURCE_TOTALS_INVALID',
      'source_type', v_source_type,
      'source_id', p_source_id
    );
  END IF;

  IF v_source_type IN ('sales_invoice', 'sales_return') THEN
    v_required_codes := ARRAY['1103', '4101', '5101', '1104'];
    v_allowed_codes := ARRAY['1103', '4101', '5101', '1104', '2102'];
    IF v_tax > 0 THEN
      IF v_sales_tax_account IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = v_sales_tax_account AND code = '2102'
      ) THEN
        RETURN jsonb_build_object('eligible', false, 'reason_code', 'TAX_ACCOUNT_MAPPING_INVALID',
          'source_type', v_source_type, 'source_id', p_source_id);
      END IF;
      v_required_codes := array_append(v_required_codes, '2102');
    END IF;
  ELSIF v_source_type = 'purchase_invoice' THEN
    v_required_codes := ARRAY['1104', '2101'];
    v_allowed_codes := ARRAY['1104', '1105', '2101'];
    IF v_tax > 0 THEN
      IF v_purchase_tax_account IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = v_purchase_tax_account AND code = '1105'
      ) THEN
        RETURN jsonb_build_object('eligible', false, 'reason_code', 'TAX_ACCOUNT_MAPPING_INVALID',
          'source_type', v_source_type, 'source_id', p_source_id);
      END IF;
      v_required_codes := array_append(v_required_codes, '1105');
    END IF;
  ELSIF v_source_type = 'purchase_return' THEN
    v_required_codes := ARRAY['1104', '2101'];
    v_allowed_codes := ARRAY['1104', '1105', '2101', '5108'];
    IF v_tax > 0 THEN
      IF v_purchase_tax_account IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = v_purchase_tax_account AND code = '1105'
      ) THEN
        RETURN jsonb_build_object('eligible', false, 'reason_code', 'TAX_ACCOUNT_MAPPING_INVALID',
          'source_type', v_source_type, 'source_id', p_source_id);
      END IF;
      v_required_codes := array_append(v_required_codes, '1105');
    END IF;
    IF round(v_net - abs(v_movement_book_value), 2) <> 0 THEN
      v_required_codes := array_append(v_required_codes, '5108');
    END IF;
  ELSIF v_movement_book_value < 0 THEN
    v_required_codes := ARRAY['5201', '1104'];
    v_allowed_codes := ARRAY['5201', '1104'];
  ELSE
    v_required_codes := ARRAY['1104', '4201'];
    v_allowed_codes := ARRAY['1104', '4201'];
  END IF;

  SELECT array_agg(code ORDER BY code) INTO v_missing_codes
  FROM unnest(v_required_codes) code
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.code = code);
  IF COALESCE(array_length(v_missing_codes, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'ACCOUNT_MAPPING_MISSING',
      'source_type', v_source_type,
      'source_id', p_source_id,
      'missing_account_codes', to_jsonb(v_missing_codes)
    );
  END IF;

  IF v_source_type = 'sales_invoice' THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '1103', 'debit', v_total, 'credit', 0),
      jsonb_build_object('account_code', '4101', 'debit', 0, 'credit', v_net),
      jsonb_build_object('account_code', '5101', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '1104', 'debit', 0, 'credit', abs(v_movement_book_value))
    );
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '2102', 'debit', 0, 'credit', v_tax)
      );
    END IF;
  ELSIF v_source_type = 'sales_return' THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '4101', 'debit', v_net, 'credit', 0),
      jsonb_build_object('account_code', '1103', 'debit', 0, 'credit', v_total),
      jsonb_build_object('account_code', '1104', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '5101', 'debit', 0, 'credit', abs(v_movement_book_value))
    );
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '2102', 'debit', v_tax, 'credit', 0)
      );
    END IF;
  ELSIF v_source_type = 'purchase_invoice' THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '1104', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '2101', 'debit', 0, 'credit', v_total)
    );
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '1105', 'debit', v_tax, 'credit', 0)
      );
    END IF;
  ELSIF v_source_type = 'purchase_return' THEN
    v_variance := round(v_net - abs(v_movement_book_value), 2);
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '2101', 'debit', v_total, 'credit', 0),
      jsonb_build_object('account_code', '1104', 'debit', 0, 'credit', abs(v_movement_book_value))
    );
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '1105', 'debit', 0, 'credit', v_tax)
      );
    END IF;
    IF v_variance > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '5108', 'debit', 0, 'credit', v_variance)
      );
    ELSIF v_variance < 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '5108', 'debit', abs(v_variance), 'credit', 0)
      );
    END IF;
  ELSIF v_movement_book_value < 0 THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '5201', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '1104', 'debit', 0, 'credit', abs(v_movement_book_value))
    );
  ELSE
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '1104', 'debit', v_movement_book_value, 'credit', 0),
      jsonb_build_object('account_code', '4201', 'debit', 0, 'credit', v_movement_book_value)
    );
  END IF;

  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_expected_debit, v_expected_credit
  FROM jsonb_array_elements(v_expected) line;
  IF v_expected_debit <> v_expected_credit OR v_expected_debit <= 0 THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'SOURCE_VALUE_MISMATCH',
      'source_type', v_source_type,
      'source_id', p_source_id,
      'expected_debit', v_expected_debit,
      'expected_credit', v_expected_credit,
      'movement_book_value', v_movement_book_value,
      'document_total', v_total,
      'document_tax', v_tax
    );
  END IF;

  IF v_journal_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'account_code', grouped.code,
      'debit', grouped.debit,
      'credit', grouped.credit
    ) ORDER BY grouped.code), '[]'::jsonb)
    INTO v_actual
    FROM (
      SELECT a.code,
        round(sum(COALESCE(l.debit, 0)), 2) AS debit,
        round(sum(COALESCE(l.credit, 0)), 2) AS credit
      FROM public.journal_entry_lines l
      JOIN public.accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = v_journal_id
      GROUP BY a.code
    ) grouped;
  END IF;

  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_actual_debit, v_actual_credit
  FROM jsonb_array_elements(v_actual) line;
  IF v_journal_id IS NOT NULL AND v_actual_debit <> v_actual_credit THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason_code', 'JOURNAL_UNBALANCED_REQUIRES_REVIEW',
      'source_type', v_source_type,
      'source_id', p_source_id,
      'original_journal_entry_id', v_journal_id
    );
  END IF;

  WITH expected AS (
    SELECT line->>'account_code' AS code,
      sum(COALESCE((line->>'debit')::numeric, 0)
        - COALESCE((line->>'credit')::numeric, 0)) AS net
    FROM jsonb_array_elements(v_expected) line GROUP BY line->>'account_code'
  ), actual AS (
    SELECT line->>'account_code' AS code,
      sum(COALESCE((line->>'debit')::numeric, 0)
        - COALESCE((line->>'credit')::numeric, 0)) AS net
    FROM jsonb_array_elements(v_actual) line GROUP BY line->>'account_code'
  ), delta AS (
    SELECT COALESCE(e.code, a.code) AS code,
      round(COALESCE(e.net, 0) - COALESCE(a.net, 0), 2) AS net
    FROM expected e FULL JOIN actual a USING (code)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_code', code,
    'debit', CASE WHEN net > 0 THEN net ELSE 0 END,
    'credit', CASE WHEN net < 0 THEN abs(net) ELSE 0 END
  ) ORDER BY code), '[]'::jsonb)
  INTO v_correction
  FROM delta WHERE net <> 0;

  SELECT array_agg(DISTINCT line->>'account_code' ORDER BY line->>'account_code')
  INTO v_unexpected_codes
  FROM jsonb_array_elements(v_correction) line
  WHERE NOT ((line->>'account_code') = ANY(v_allowed_codes));
  IF COALESCE(array_length(v_unexpected_codes, 1), 0) > 0 THEN
    v_eligible := false;
    v_reason := 'UNEXPECTED_ACCOUNT_DELTA';
  END IF;

  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_correction_debit, v_correction_credit
  FROM jsonb_array_elements(v_correction) line;
  IF v_eligible AND (v_correction_debit <> v_correction_credit OR v_correction_debit <= 0) THEN
    v_eligible := false;
    v_reason := CASE WHEN jsonb_array_length(v_correction) = 0
      THEN 'NO_CORRECTION_REQUIRED' ELSE 'CORRECTION_NOT_BALANCED' END;
  END IF;

  v_mode := CASE WHEN v_journal_id IS NULL
    THEN 'create_full_journal' ELSE 'post_delta_journal' END;
  v_plan_core := jsonb_build_object(
    'source_type', v_source_type,
    'source_id', p_source_id,
    'source_number', v_source_number,
    'source_status', v_source_status,
    'source_date', v_source_date,
    'accounting_date', v_effective_date,
    'original_journal_entry_id', v_journal_id,
    'journal_status', v_journal_status,
    'mode', v_mode,
    'movement_count', v_movement_count,
    'movement_book_value', v_movement_book_value,
    'expected_lines', v_expected,
    'actual_lines', v_actual,
    'correction_lines', v_correction,
    'target_ledger_1104_value', v_movement_book_value
  );
  v_plan_fingerprint := md5(v_plan_core::text);

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'reason_code', v_reason,
    'plan_fingerprint', v_plan_fingerprint,
    'unexpected_account_codes', COALESCE(to_jsonb(v_unexpected_codes), '[]'::jsonb)
  ) || v_plan_core;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_inventory_reconciliation_journal_plan(text, uuid, date)
  IS 'Stage 2D-A read-only planner: reconstructs expected source accounting, compares the posted journal by account, and returns a deterministic correction plan without writing business data.';
