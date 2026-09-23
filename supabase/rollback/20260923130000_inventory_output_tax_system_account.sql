-- Explicit rollback for the dedicated output-VAT system account.
DO $guard$
DECLARE v_sales_tax uuid;
BEGIN
  IF current_setting('app.inventory_output_tax_account_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260923130000' THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_NOT_AUTHORIZED';
  END IF;

  SELECT id INTO v_sales_tax
  FROM public.accounts
  WHERE code = '2104'
    AND name = 'ضريبة القيمة المضافة للمخرجات'
    AND account_type = 'liability'
    AND is_system IS TRUE
    AND is_active IS TRUE
    AND is_parent IS FALSE
    AND description = 'SYSTEM:OUTPUT_VAT:20260923130000';

  IF v_sales_tax IS NULL THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_IDENTITY_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.company_settings
    WHERE sales_tax_account_id = v_sales_tax AND enable_tax IS TRUE
  ) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_TAX_ENABLED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_entry_lines WHERE account_id = v_sales_tax)
     OR EXISTS (SELECT 1 FROM public.accounts WHERE parent_id = v_sales_tax)
     OR EXISTS (SELECT 1 FROM public.expense_types WHERE account_id = v_sales_tax) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_HAS_DEPENDENCIES';
  END IF;

  UPDATE public.company_settings
  SET sales_tax_account_id = NULL
  WHERE sales_tax_account_id = v_sales_tax;
END;
$guard$;

ALTER TABLE public.accounts DISABLE TRIGGER trg_guard_system_accounts_delete;

DELETE FROM public.accounts
WHERE code = '2104'
  AND description = 'SYSTEM:OUTPUT_VAT:20260923130000';

ALTER TABLE public.accounts ENABLE TRIGGER trg_guard_system_accounts_delete;

DO $postcheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE code = '2104')
     OR NOT EXISTS (
       SELECT 1 FROM public.accounts
       WHERE code = '2102' AND name = 'قروض قصيرة الأجل'
         AND account_type = 'liability'
     ) THEN
    RAISE EXCEPTION 'OUTPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
