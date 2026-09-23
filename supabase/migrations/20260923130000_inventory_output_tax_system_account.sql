-- Dedicated protected output-VAT account without repurposing the legacy loan accounts.
DO $migration$
DECLARE
  v_liability_parent uuid;
  v_purchase_tax uuid;
  v_sales_tax uuid;
  v_tax_state_before text;
  v_tax_state_after text;
BEGIN
  IF to_regprocedure('public.fn_guard_system_accounts_delete()') IS NULL
     OR to_regprocedure('public.fn_validate_company_tax_account_mapping()') IS NULL
     OR to_regprocedure('public.fn_guard_configured_tax_account_shape()') IS NULL THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_BASELINE_MISMATCH';
  END IF;

  SELECT id INTO v_liability_parent
  FROM public.accounts
  WHERE code = '2' AND account_type = 'liability' AND is_parent IS TRUE;

  SELECT a.id INTO v_purchase_tax
  FROM public.accounts a
  JOIN public.accounts p ON p.id = a.parent_id
  WHERE a.code = '1105'
    AND a.name = 'ضريبة القيمة المضافة للمدخلات'
    AND a.account_type = 'asset'
    AND a.is_active IS TRUE
    AND a.is_parent IS FALSE
    AND a.is_system IS TRUE
    AND p.code = '11';

  IF v_liability_parent IS NULL OR v_purchase_tax IS NULL THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_PARENT_OR_INPUT_TAX_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE code = '2102' AND name = 'قروض قصيرة الأجل'
      AND account_type = 'liability' AND is_parent IS FALSE
  ) THEN
    RAISE EXCEPTION 'LEGACY_LOAN_ACCOUNT_2102_IDENTITY_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts
    WHERE code = '2104'
      AND (name <> 'ضريبة القيمة المضافة للمخرجات'
        OR account_type <> 'liability'
        OR parent_id IS DISTINCT FROM v_liability_parent
        OR is_parent IS NOT FALSE
        OR is_active IS NOT TRUE
        OR is_system IS NOT TRUE
        OR description IS DISTINCT FROM 'SYSTEM:OUTPUT_VAT:20260923130000')
  ) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_IDENTITY_CONFLICT';
  END IF;

  SELECT md5(COALESCE(string_agg(
    concat_ws('|', id::text, enable_tax::text, tax_rate::text), ',' ORDER BY id
  ), '')) INTO v_tax_state_before
  FROM public.company_settings;

  INSERT INTO public.accounts(
    code, name, account_type, parent_id, is_parent, description, is_active, is_system
  )
  SELECT '2104', 'ضريبة القيمة المضافة للمخرجات', 'liability',
    v_liability_parent, false, 'SYSTEM:OUTPUT_VAT:20260923130000', true, true
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '2104');

  SELECT id INTO STRICT v_sales_tax FROM public.accounts WHERE code = '2104';

  UPDATE public.company_settings
  SET purchase_tax_account_id = COALESCE(purchase_tax_account_id, v_purchase_tax),
      sales_tax_account_id = COALESCE(sales_tax_account_id, v_sales_tax)
  WHERE purchase_tax_account_id IS NULL OR sales_tax_account_id IS NULL;

  SELECT md5(COALESCE(string_agg(
    concat_ws('|', id::text, enable_tax::text, tax_rate::text), ',' ORDER BY id
  ), '')) INTO v_tax_state_after
  FROM public.company_settings;

  IF v_tax_state_after IS DISTINCT FROM v_tax_state_before THEN
    RAISE EXCEPTION 'OUTPUT_TAX_MIGRATION_CHANGED_ENABLEMENT_OR_RATE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.company_settings s
    LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id
    WHERE p.id IS NULL OR p.account_type <> 'asset' OR NOT p.is_active OR p.is_parent
       OR v.id IS NULL OR v.account_type <> 'liability' OR NOT v.is_active OR v.is_parent
  ) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_DEFAULT_MAPPING_POSTCHECK_FAILED';
  END IF;
END;
$migration$;

COMMENT ON COLUMN public.company_settings.purchase_tax_account_id
IS 'Internal posting mapping for recoverable input VAT; defaults to protected account 1105.';

COMMENT ON COLUMN public.company_settings.sales_tax_account_id
IS 'Internal posting mapping for output VAT payable; defaults to protected account 2104.';
