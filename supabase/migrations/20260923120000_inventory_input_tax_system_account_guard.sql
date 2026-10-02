-- Protect the existing input-VAT account before creating the output-VAT account.
-- Alibea's historical 1105 is semantically correct but was not marked as a system account.
DO $migration$
DECLARE
  v_account public.accounts%ROWTYPE;
  v_parent_code text;
  v_guard_present boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.accounts'::regclass
      AND tgname = 'trg_guard_system_accounts_delete'
      AND NOT tgisinternal
  ) INTO v_guard_present;

  IF NOT v_guard_present
     OR to_regprocedure('public.fn_guard_system_accounts_delete()') IS NULL THEN
    RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_GUARD_MISSING';
  END IF;

  SELECT a.* INTO STRICT v_account
  FROM public.accounts a
  WHERE a.code = '1105'
  FOR UPDATE;

  SELECT p.code INTO v_parent_code
  FROM public.accounts p
  WHERE p.id = v_account.parent_id;

  IF v_account.name IS DISTINCT FROM 'ضريبة القيمة المضافة للمدخلات'
     OR v_account.account_type IS DISTINCT FROM 'asset'
     OR v_parent_code IS DISTINCT FROM '11'
     OR v_account.is_parent IS DISTINCT FROM false
     OR v_account.is_active IS DISTINCT FROM true
     OR v_account.is_system IS NULL
     OR (v_account.is_system IS FALSE AND v_account.description IS NOT NULL) THEN
    RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_IDENTITY_CONFLICT';
  END IF;

  IF v_account.is_system IS FALSE THEN
    UPDATE public.accounts
    SET is_system = true,
        description = 'SYSTEM:INPUT_VAT_HARDENED:20260923120000'
    WHERE id = v_account.id
      AND is_system IS FALSE
      AND description IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_CONCURRENT_CHANGE';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.accounts p ON p.id = a.parent_id
    WHERE a.id = v_account.id
      AND a.code = '1105'
      AND a.name = 'ضريبة القيمة المضافة للمدخلات'
      AND a.account_type = 'asset'
      AND p.code = '11'
      AND a.is_parent IS FALSE
      AND a.is_active IS TRUE
      AND a.is_system IS TRUE
  ) THEN
    RAISE EXCEPTION 'INPUT_TAX_SYSTEM_ACCOUNT_POSTCHECK_FAILED';
  END IF;
END;
$migration$;
