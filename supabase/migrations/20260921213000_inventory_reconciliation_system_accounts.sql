-- Foundational protected accounts for inventory reconciliation postings.
DO $preflight$
DECLARE
  v_revenue_parent uuid;
  v_expense_parent uuid;
BEGIN
  IF to_regprocedure('public.fn_guard_system_accounts_delete()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.accounts'::regclass
         AND tgname = 'trg_guard_system_accounts_delete'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_BASELINE_MISMATCH';
  END IF;

  SELECT id INTO v_revenue_parent
  FROM public.accounts
  WHERE code = '4' AND account_type = 'revenue' AND is_parent IS TRUE;
  SELECT id INTO v_expense_parent
  FROM public.accounts
  WHERE code = '5' AND account_type = 'expense' AND is_parent IS TRUE;
  IF v_revenue_parent IS NULL OR v_expense_parent IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_PARENT_ACCOUNTS_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts
    WHERE code = '4201'
      AND (account_type <> 'revenue' OR is_parent IS NOT FALSE
        OR (is_system IS TRUE AND parent_id IS DISTINCT FROM v_revenue_parent)
        OR (parent_id IS NOT NULL AND parent_id IS DISTINCT FROM v_revenue_parent))
  ) OR EXISTS (
    SELECT 1 FROM public.accounts
    WHERE code = '5201'
      AND (account_type <> 'expense' OR is_parent IS NOT FALSE
        OR (is_system IS TRUE AND parent_id IS DISTINCT FROM v_expense_parent)
        OR (parent_id IS NOT NULL AND parent_id IS DISTINCT FROM v_expense_parent))
  ) THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_ACCOUNT_IDENTITY_CONFLICT';
  END IF;

  INSERT INTO public.accounts(
    code, name, account_type, parent_id, is_parent, description, is_active, is_system
  )
  SELECT '4201', 'أرباح تسوية المخزون', 'revenue', v_revenue_parent, false,
    'SYSTEM:INVENTORY_RECONCILIATION_GAIN:20260921213000', true, true
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '4201');

  INSERT INTO public.accounts(
    code, name, account_type, parent_id, is_parent, description, is_active, is_system
  )
  SELECT '5201', 'خسائر تسوية المخزون', 'expense', v_expense_parent, false,
    'SYSTEM:INVENTORY_RECONCILIATION_LOSS:20260921213000', true, true
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '5201');

  UPDATE public.accounts
  SET parent_id = v_revenue_parent,
      is_system = true,
      is_active = true
  WHERE code = '4201'
    AND (parent_id IS DISTINCT FROM v_revenue_parent
      OR is_system IS NOT TRUE OR is_active IS NOT TRUE);

  UPDATE public.accounts
  SET parent_id = v_expense_parent,
      is_system = true,
      is_active = true
  WHERE code = '5201'
    AND (parent_id IS DISTINCT FROM v_expense_parent
      OR is_system IS NOT TRUE OR is_active IS NOT TRUE);
END;
$preflight$;

CREATE FUNCTION public.fn_guard_system_accounts_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.is_system IS TRUE THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_DELETE_FORBIDDEN: لا يمكن حذف حساب النظام (%)', OLD.code;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_guard_system_accounts_delete
BEFORE DELETE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_system_accounts_delete();

COMMENT ON FUNCTION public.fn_guard_system_accounts_delete()
IS 'Database-level protection against deleting any account flagged as a system account.';

DO $postcheck$
BEGIN
  IF (SELECT count(*) FROM public.accounts WHERE code IN ('4201', '5201')) <> 2
     OR EXISTS (
       SELECT 1
       FROM public.accounts a
       JOIN public.accounts p ON p.id = a.parent_id
       WHERE (a.code = '4201' AND (a.account_type <> 'revenue' OR p.code <> '4'
         OR NOT a.is_system OR NOT a.is_active OR a.is_parent))
          OR (a.code = '5201' AND (a.account_type <> 'expense' OR p.code <> '5'
         OR NOT a.is_system OR NOT a.is_active OR a.is_parent))
     ) THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_SYSTEM_ACCOUNTS_POSTCHECK_FAILED';
  END IF;
END;
$postcheck$;
