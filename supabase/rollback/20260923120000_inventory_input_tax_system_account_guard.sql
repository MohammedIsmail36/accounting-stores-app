-- Explicitly undo only the system flag introduced for a previously unprotected 1105.
-- Run only after rolling back dependent output-tax mapping, and only with authorization.
DO $rollback$
DECLARE
  v_account public.accounts%ROWTYPE;
  v_parent_code text;
BEGIN
  IF current_setting('app.inventory_input_tax_rollback_authorized', true)
       IS DISTINCT FROM 'EXPLICIT_INPUT_VAT_ROLLBACK_20260923120000' THEN
    RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_NOT_AUTHORIZED';
  END IF;

  SELECT a.* INTO STRICT v_account
  FROM public.accounts a
  WHERE a.code = '1105'
  FOR UPDATE;

  SELECT p.code INTO v_parent_code
  FROM public.accounts p WHERE p.id = v_account.parent_id;

  IF v_account.name IS DISTINCT FROM 'ضريبة القيمة المضافة للمدخلات'
     OR v_account.account_type IS DISTINCT FROM 'asset'
     OR v_parent_code IS DISTINCT FROM '11'
     OR v_account.is_parent IS DISTINCT FROM false
     OR v_account.is_active IS DISTINCT FROM true
     OR v_account.is_system IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_IDENTITY_CONFLICT';
  END IF;
  IF v_account.description IS NOT NULL
     AND v_account.description <> 'SYSTEM:INPUT_VAT_HARDENED:20260923120000' THEN
    RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_PROVENANCE_UNKNOWN';
  END IF;


  IF v_account.description = 'SYSTEM:INPUT_VAT_HARDENED:20260923120000' THEN
    IF EXISTS (SELECT 1 FROM public.accounts WHERE code = '2104')
       OR EXISTS (
         SELECT 1 FROM public.company_settings
         WHERE purchase_tax_account_id = v_account.id
            OR sales_tax_account_id = v_account.id
       )
       OR EXISTS (SELECT 1 FROM public.journal_entry_lines WHERE account_id = v_account.id)
       OR EXISTS (SELECT 1 FROM public.accounts WHERE parent_id = v_account.id)
       OR EXISTS (SELECT 1 FROM public.expense_types WHERE account_id = v_account.id) THEN
      RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_HAS_DEPENDENCIES';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.accounts'::regclass
        AND tgname = 'trg_guard_system_accounts_update'
        AND tgenabled = 'O'
        AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_UPDATE_GUARD_INVALID';
    END IF;

    EXECUTE 'ALTER TABLE public.accounts DISABLE TRIGGER trg_guard_system_accounts_update';

    UPDATE public.accounts
    SET is_system = false, description = NULL
    WHERE id = v_account.id
      AND is_system IS TRUE
      AND description = 'SYSTEM:INPUT_VAT_HARDENED:20260923120000';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_ROLLBACK_CONCURRENT_CHANGE';
    END IF;
    EXECUTE 'ALTER TABLE public.accounts ENABLE TRIGGER trg_guard_system_accounts_update';
  END IF;
END;
$rollback$;
