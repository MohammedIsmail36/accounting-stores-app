-- Explicit rollback for Stage 2D-D configurable tax-account mappings.
DO $guard$
BEGIN
  IF current_setting('app.inventory_configurable_tax_accounts_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260923100000' THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text,uuid,date)') IS NULL
     OR to_regprocedure('public.get_inventory_reconciliation_journal_plan_base_2da(text,uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ROLLBACK_BASELINE_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.company_settings s
    LEFT JOIN public.accounts p ON p.id = s.purchase_tax_account_id
    LEFT JOIN public.accounts v ON v.id = s.sales_tax_account_id
    WHERE (s.purchase_tax_account_id IS NOT NULL AND p.code <> '1105')
       OR (s.sales_tax_account_id IS NOT NULL AND v.code <> '2102')
  ) THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_CONFIGURABLE_TAX_ROLLBACK_CUSTOM_MAPPING_IN_USE';
  END IF;
END;
$guard$;

DROP TRIGGER trg_guard_configured_tax_account_shape ON public.accounts;
DROP FUNCTION public.fn_guard_configured_tax_account_shape();
DROP TRIGGER trg_validate_company_tax_account_mapping ON public.company_settings;
DROP FUNCTION public.fn_validate_company_tax_account_mapping();

DROP FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(text, uuid, date);
ALTER FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da_fixed_tax(text, uuid, date)
  RENAME TO get_inventory_reconciliation_journal_plan_base_2da;
REVOKE ALL ON FUNCTION public.get_inventory_reconciliation_journal_plan_base_2da(text, uuid, date)
  FROM PUBLIC, anon, authenticated;
