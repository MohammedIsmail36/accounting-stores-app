-- Stage 2D-D: make inventory-reconciliation tax mappings follow the accounts
-- selected in company settings instead of assuming the default 1105/2102 codes.

DO $guard$
BEGIN
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NULL
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NULL
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text,uuid,date)') IS NOT NULL
     OR to_regprocedure('public.fn_validate_company_tax_account_mapping()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.company_settings'::regclass
         AND tgname = 'trg_validate_company_tax_account_mapping'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_BASELINE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.company_settings s
    LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id
    WHERE (s.enable_tax IS TRUE AND (
             s.purchase_tax_account_id IS NULL OR s.sales_tax_account_id IS NULL
           ))
       OR (s.purchase_tax_account_id IS NOT NULL AND (
             p.id IS NULL OR p.account_type <> 'asset'
             OR p.is_active IS NOT TRUE OR p.is_parent IS NOT FALSE
           ))
       OR (s.sales_tax_account_id IS NOT NULL AND (
             v.id IS NULL OR v.account_type <> 'liability'
             OR v.is_active IS NOT TRUE OR v.is_parent IS NOT FALSE
           ))
  ) THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_BASELINE_MISMATCH';
  END IF;
END;
$guard$;

ALTER FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(text, uuid, date)
  RENAME TO get_inventory_reconciliation_journal_plan_base_2da_fixed_tax;
REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text, uuid, date)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_validate_company_tax_account_mapping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.enable_tax IS TRUE
     AND (NEW.purchase_tax_account_id IS NULL OR NEW.sales_tax_account_id IS NULL) THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_MAPPING_INVALID'
      USING ERRCODE = '23514', DETAIL = 'Both tax accounts are required while tax is enabled.';
  END IF;

  IF NEW.purchase_tax_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = NEW.purchase_tax_account_id
      AND a.account_type = 'asset'
      AND a.is_active IS TRUE
      AND a.is_parent IS FALSE
  ) THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_MAPPING_INVALID'
      USING ERRCODE = '23514', DETAIL = 'Purchase tax account must be an active leaf asset.';
  END IF;

  IF NEW.sales_tax_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = NEW.sales_tax_account_id
      AND a.account_type = 'liability'
      AND a.is_active IS TRUE
      AND a.is_parent IS FALSE
  ) THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_MAPPING_INVALID'
      USING ERRCODE = '23514', DETAIL = 'Sales tax account must be an active leaf liability.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_validate_company_tax_account_mapping()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_validate_company_tax_account_mapping
BEFORE INSERT OR UPDATE OF enable_tax, purchase_tax_account_id, sales_tax_account_id
ON public.company_settings
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_company_tax_account_mapping();

CREATE FUNCTION public.fn_guard_configured_tax_account_shape()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_settings s
    WHERE s.purchase_tax_account_id = OLD.id
  ) AND (
    TG_OP = 'DELETE' OR NEW.account_type <> 'asset'
    OR NEW.is_active IS NOT TRUE OR NEW.is_parent IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_MAPPING_INVALID'
      USING ERRCODE = '23514', DETAIL = 'Configured purchase tax account cannot be removed or made invalid.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.company_settings s
    WHERE s.sales_tax_account_id = OLD.id
  ) AND (
    TG_OP = 'DELETE' OR NEW.account_type <> 'liability'
    OR NEW.is_active IS NOT TRUE OR NEW.is_parent IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'TAX_ACCOUNT_MAPPING_INVALID'
      USING ERRCODE = '23514', DETAIL = 'Configured sales tax account cannot be removed or made invalid.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_configured_tax_account_shape()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_configured_tax_account_shape
BEFORE UPDATE OF account_type, is_active, is_parent OR DELETE
ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_configured_tax_account_shape();

CREATE FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(
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
  v_sales_tax_code text;
  v_purchase_tax_code text;
  v_expected jsonb := '[]'::jsonb;
  v_actual jsonb := '[]'::jsonb;
  v_correction jsonb := '[]'::jsonb;
  v_allowed_codes text[];
  v_required_codes text[] := ARRAY[]::text[];
  v_missing_codes text[];
  v_invalid_codes text[];
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
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'SOURCE_TYPE_NOT_SUPPORTED',
      'source_type', NULLIF(v_source_type, ''), 'source_id', p_source_id);
  END IF;

  IF v_source_type = 'sales_invoice' THEN
    SELECT status, invoice_date, COALESCE(posted_number, invoice_number)::text,
      journal_entry_id, subtotal, discount, tax, total
    INTO v_source_status, v_source_date, v_source_number, v_journal_id,
      v_subtotal, v_discount, v_tax, v_total
    FROM public.sales_invoices WHERE id = p_source_id;
  ELSIF v_source_type = 'sales_return' THEN
    SELECT status, return_date, COALESCE(posted_number, return_number)::text,
      journal_entry_id, subtotal, discount, tax, total
    INTO v_source_status, v_source_date, v_source_number, v_journal_id,
      v_subtotal, v_discount, v_tax, v_total
    FROM public.sales_returns WHERE id = p_source_id;
  ELSIF v_source_type = 'purchase_invoice' THEN
    SELECT status, invoice_date, COALESCE(posted_number, invoice_number)::text,
      journal_entry_id, subtotal, discount, tax, total
    INTO v_source_status, v_source_date, v_source_number, v_journal_id,
      v_subtotal, v_discount, v_tax, v_total
    FROM public.purchase_invoices WHERE id = p_source_id;
  ELSIF v_source_type = 'purchase_return' THEN
    SELECT status, return_date, COALESCE(posted_number, return_number)::text,
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
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'SOURCE_NOT_FOUND',
      'source_type', v_source_type, 'source_id', p_source_id);
  END IF;
  IF v_source_status IS DISTINCT FROM 'posted' THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'SOURCE_NOT_POSTED',
      'source_type', v_source_type, 'source_id', p_source_id,
      'source_status', v_source_status);
  END IF;

  SELECT count(*)::integer,
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
      ELSE 'adjustment' END), false)
  INTO v_movement_count, v_movement_book_value, v_movement_types_valid
  FROM public.inventory_movements m
  WHERE m.reference_id = p_source_id
    AND CASE WHEN m.reference_type = 'inventory_adjustment' THEN 'adjustment'
      ELSE m.reference_type END = v_source_type;

  v_movement_book_value := round(v_movement_book_value, 2);
  IF v_movement_count = 0 OR NOT v_movement_types_valid OR v_movement_book_value = 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'MOVEMENT_EVIDENCE_INVALID',
      'source_type', v_source_type, 'source_id', p_source_id,
      'movement_count', v_movement_count, 'movement_book_value', v_movement_book_value);
  END IF;

  SELECT s.locked_until_date, s.sales_tax_account_id, s.purchase_tax_account_id,
    sales.code, purchase.code
  INTO v_locked_until, v_sales_tax_account, v_purchase_tax_account,
    v_sales_tax_code, v_purchase_tax_code
  FROM public.company_settings s
  LEFT JOIN public.accounts sales ON sales.id = s.sales_tax_account_id
    AND sales.account_type = 'liability' AND sales.is_active IS TRUE
    AND sales.is_parent IS FALSE
  LEFT JOIN public.accounts purchase ON purchase.id = s.purchase_tax_account_id
    AND purchase.account_type = 'asset' AND purchase.is_active IS TRUE
    AND purchase.is_parent IS FALSE
  ORDER BY s.created_at
  LIMIT 1;

  IF v_locked_until IS NOT NULL AND v_source_date <= v_locked_until
     AND p_accounting_date IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'ACCOUNTING_DATE_REQUIRED',
      'source_type', v_source_type, 'source_id', p_source_id,
      'source_date', v_source_date, 'locked_until_date', v_locked_until);
  END IF;
  v_effective_date := COALESCE(p_accounting_date, v_source_date);
  IF v_effective_date IS NULL
     OR (v_locked_until IS NOT NULL AND v_effective_date <= v_locked_until) THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'ACCOUNTING_DATE_LOCKED',
      'source_type', v_source_type, 'source_id', p_source_id,
      'source_date', v_source_date, 'accounting_date', v_effective_date,
      'locked_until_date', v_locked_until);
  END IF;

  IF v_journal_id IS NOT NULL THEN
    SELECT status INTO v_journal_status FROM public.journal_entries WHERE id = v_journal_id;
    IF NOT FOUND OR v_journal_status IS DISTINCT FROM 'posted' THEN
      RETURN jsonb_build_object('eligible', false,
        'reason_code', 'JOURNAL_DRAFT_REQUIRES_REVIEW',
        'source_type', v_source_type, 'source_id', p_source_id,
        'original_journal_entry_id', v_journal_id, 'journal_status', v_journal_status);
    END IF;
  END IF;

  v_tax := round(COALESCE(v_tax, 0), 2);
  v_total := round(COALESCE(v_total, 0), 2);
  v_net := round(v_total - v_tax, 2);
  IF v_source_type <> 'adjustment' AND (v_total <= 0 OR v_net < 0) THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'SOURCE_TOTALS_INVALID',
      'source_type', v_source_type, 'source_id', p_source_id);
  END IF;

  IF v_source_type IN ('sales_invoice', 'sales_return') THEN
    v_required_codes := ARRAY['1103', '4101', '5101', '1104'];
    v_allowed_codes := ARRAY['1103', '4101', '5101', '1104'];
    IF v_tax > 0 THEN
      IF v_sales_tax_account IS NULL OR v_sales_tax_code IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason_code', 'TAX_ACCOUNT_MAPPING_INVALID',
          'source_type', v_source_type, 'source_id', p_source_id);
      END IF;
      v_required_codes := array_append(v_required_codes, v_sales_tax_code);
      v_allowed_codes := array_append(v_allowed_codes, v_sales_tax_code);
    END IF;
  ELSIF v_source_type = 'purchase_invoice' THEN
    v_required_codes := ARRAY['1104', '2101'];
    v_allowed_codes := ARRAY['1104', '2101'];
    IF v_tax > 0 THEN
      IF v_purchase_tax_account IS NULL OR v_purchase_tax_code IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason_code', 'TAX_ACCOUNT_MAPPING_INVALID',
          'source_type', v_source_type, 'source_id', p_source_id);
      END IF;
      v_required_codes := array_append(v_required_codes, v_purchase_tax_code);
      v_allowed_codes := array_append(v_allowed_codes, v_purchase_tax_code);
    END IF;
  ELSIF v_source_type = 'purchase_return' THEN
    v_required_codes := ARRAY['1104', '2101'];
    v_allowed_codes := ARRAY['1104', '2101', '5108'];
    IF v_tax > 0 THEN
      IF v_purchase_tax_account IS NULL OR v_purchase_tax_code IS NULL THEN
        RETURN jsonb_build_object('eligible', false, 'reason_code', 'TAX_ACCOUNT_MAPPING_INVALID',
          'source_type', v_source_type, 'source_id', p_source_id);
      END IF;
      v_required_codes := array_append(v_required_codes, v_purchase_tax_code);
      v_allowed_codes := array_append(v_allowed_codes, v_purchase_tax_code);
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

  SELECT array_agg(required.code ORDER BY required.code) INTO v_missing_codes
  FROM unnest(v_required_codes) AS required(code)
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.code = required.code);
  IF COALESCE(array_length(v_missing_codes, 1), 0) > 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'ACCOUNT_MAPPING_MISSING',
      'source_type', v_source_type, 'source_id', p_source_id,
      'missing_account_codes', to_jsonb(v_missing_codes));
  END IF;

  SELECT array_agg(required.code ORDER BY required.code) INTO v_invalid_codes
  FROM unnest(v_required_codes) AS required(code)
  WHERE required.code IN ('4201', '5201') AND NOT EXISTS (
    SELECT 1 FROM public.accounts a JOIN public.accounts parent ON parent.id = a.parent_id
    WHERE a.code = required.code AND a.is_system IS TRUE AND a.is_active IS TRUE
      AND a.is_parent IS FALSE AND (
        (required.code = '4201' AND a.account_type = 'revenue' AND parent.code = '4')
        OR (required.code = '5201' AND a.account_type = 'expense' AND parent.code = '5')
      )
  );
  IF COALESCE(array_length(v_invalid_codes, 1), 0) > 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'ACCOUNT_MAPPING_INVALID',
      'source_type', v_source_type, 'source_id', p_source_id,
      'invalid_account_codes', to_jsonb(v_invalid_codes));
  END IF;

  IF v_source_type = 'sales_invoice' THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '1103', 'debit', v_total, 'credit', 0),
      jsonb_build_object('account_code', '4101', 'debit', 0, 'credit', v_net),
      jsonb_build_object('account_code', '5101', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '1104', 'debit', 0, 'credit', abs(v_movement_book_value)));
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', v_sales_tax_code, 'debit', 0, 'credit', v_tax));
    END IF;
  ELSIF v_source_type = 'sales_return' THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '4101', 'debit', v_net, 'credit', 0),
      jsonb_build_object('account_code', '1103', 'debit', 0, 'credit', v_total),
      jsonb_build_object('account_code', '1104', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '5101', 'debit', 0, 'credit', abs(v_movement_book_value)));
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', v_sales_tax_code, 'debit', v_tax, 'credit', 0));
    END IF;
  ELSIF v_source_type = 'purchase_invoice' THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '1104', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '2101', 'debit', 0, 'credit', v_total));
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', v_purchase_tax_code, 'debit', v_tax, 'credit', 0));
    END IF;
  ELSIF v_source_type = 'purchase_return' THEN
    v_variance := round(v_net - abs(v_movement_book_value), 2);
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '2101', 'debit', v_total, 'credit', 0),
      jsonb_build_object('account_code', '1104', 'debit', 0, 'credit', abs(v_movement_book_value)));
    IF v_tax > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', v_purchase_tax_code, 'debit', 0, 'credit', v_tax));
    END IF;
    IF v_variance > 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '5108', 'debit', 0, 'credit', v_variance));
    ELSIF v_variance < 0 THEN
      v_expected := v_expected || jsonb_build_array(
        jsonb_build_object('account_code', '5108', 'debit', abs(v_variance), 'credit', 0));
    END IF;
  ELSIF v_movement_book_value < 0 THEN
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '5201', 'debit', abs(v_movement_book_value), 'credit', 0),
      jsonb_build_object('account_code', '1104', 'debit', 0, 'credit', abs(v_movement_book_value)));
  ELSE
    v_expected := jsonb_build_array(
      jsonb_build_object('account_code', '1104', 'debit', v_movement_book_value, 'credit', 0),
      jsonb_build_object('account_code', '4201', 'debit', 0, 'credit', v_movement_book_value));
  END IF;

  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_expected_debit, v_expected_credit FROM jsonb_array_elements(v_expected) line;
  IF v_expected_debit <> v_expected_credit OR v_expected_debit <= 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'SOURCE_VALUE_MISMATCH',
      'source_type', v_source_type, 'source_id', p_source_id,
      'expected_debit', v_expected_debit, 'expected_credit', v_expected_credit,
      'movement_book_value', v_movement_book_value,
      'document_total', v_total, 'document_tax', v_tax);
  END IF;

  IF v_journal_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'account_code', grouped.code, 'debit', grouped.debit, 'credit', grouped.credit
    ) ORDER BY grouped.code), '[]'::jsonb)
    INTO v_actual FROM (
      SELECT a.code, round(sum(COALESCE(l.debit, 0)), 2) debit,
        round(sum(COALESCE(l.credit, 0)), 2) credit
      FROM public.journal_entry_lines l JOIN public.accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = v_journal_id GROUP BY a.code
    ) grouped;
  END IF;

  SELECT round(COALESCE(sum((line->>'debit')::numeric), 0), 2),
         round(COALESCE(sum((line->>'credit')::numeric), 0), 2)
  INTO v_actual_debit, v_actual_credit FROM jsonb_array_elements(v_actual) line;
  IF v_journal_id IS NOT NULL AND v_actual_debit <> v_actual_credit THEN
    RETURN jsonb_build_object('eligible', false,
      'reason_code', 'JOURNAL_UNBALANCED_REQUIRES_REVIEW',
      'source_type', v_source_type, 'source_id', p_source_id,
      'original_journal_entry_id', v_journal_id);
  END IF;

  WITH expected AS (
    SELECT line->>'account_code' code,
      sum(COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)) net
    FROM jsonb_array_elements(v_expected) line GROUP BY line->>'account_code'
  ), actual AS (
    SELECT line->>'account_code' code,
      sum(COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)) net
    FROM jsonb_array_elements(v_actual) line GROUP BY line->>'account_code'
  ), delta AS (
    SELECT COALESCE(e.code, a.code) code,
      round(COALESCE(e.net, 0) - COALESCE(a.net, 0), 2) net
    FROM expected e FULL JOIN actual a USING (code)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_code', code,
    'debit', CASE WHEN net > 0 THEN net ELSE 0 END,
    'credit', CASE WHEN net < 0 THEN abs(net) ELSE 0 END
  ) ORDER BY code), '[]'::jsonb)
  INTO v_correction FROM delta WHERE net <> 0;

  SELECT array_agg(DISTINCT line->>'account_code' ORDER BY line->>'account_code')
  INTO v_unexpected_codes FROM jsonb_array_elements(v_correction) line
  WHERE NOT ((line->>'account_code') = ANY(v_allowed_codes));
  IF COALESCE(array_length(v_unexpected_codes, 1), 0) > 0 THEN
    v_eligible := false; v_reason := 'UNEXPECTED_ACCOUNT_DELTA';
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

  v_mode := CASE WHEN v_journal_id IS NULL THEN 'create_full_journal'
    ELSE 'post_delta_journal' END;
  v_plan_core := jsonb_build_object(
    'source_type', v_source_type, 'source_id', p_source_id,
    'source_number', v_source_number, 'source_status', v_source_status,
    'source_date', v_source_date, 'accounting_date', v_effective_date,
    'original_journal_entry_id', v_journal_id, 'journal_status', v_journal_status,
    'mode', v_mode, 'movement_count', v_movement_count,
    'movement_book_value', v_movement_book_value,
    'expected_lines', v_expected, 'actual_lines', v_actual,
    'correction_lines', v_correction,
    'target_ledger_1104_value', v_movement_book_value);
  v_plan_fingerprint := md5(v_plan_core::text);

  RETURN jsonb_build_object(
    'eligible', v_eligible, 'reason_code', v_reason,
    'plan_fingerprint', v_plan_fingerprint,
    'unexpected_account_codes', COALESCE(to_jsonb(v_unexpected_codes), '[]'::jsonb)
  ) || v_plan_core;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(text, uuid, date)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(text, uuid, date)
  IS 'Stage 2D-D base planner: resolves purchase and sales tax accounts from validated company settings.';
