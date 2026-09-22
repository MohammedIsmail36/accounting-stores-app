-- Explicit rollback for foundational inventory reconciliation system accounts.
DO $guard$
BEGIN
  IF current_setting('app.inventory_reconciliation_accounts_rollback_authorized', true)
       IS DISTINCT FROM 'STAGING_20260921213000' THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_ACCOUNTS_ROLLBACK_NOT_AUTHORIZED';
  END IF;
  IF to_regprocedure('public.get_inventory_reconciliation_journal_plan(text,uuid,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_ACCOUNTS_ROLLBACK_DEPENDENCY_ACTIVE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.journal_entry_lines l
    JOIN public.accounts a ON a.id = l.account_id
    WHERE a.description IN (
      'SYSTEM:INVENTORY_RECONCILIATION_GAIN:20260921213000',
      'SYSTEM:INVENTORY_RECONCILIATION_LOSS:20260921213000'
    )
  ) THEN
    RAISE EXCEPTION 'INVENTORY_RECONCILIATION_ACCOUNTS_ROLLBACK_HAS_POSTINGS';
  END IF;
END;
$guard$;

DROP TRIGGER trg_guard_system_accounts_delete ON public.accounts;
DROP FUNCTION public.fn_guard_system_accounts_delete();

DELETE FROM public.accounts
WHERE description IN (
  'SYSTEM:INVENTORY_RECONCILIATION_GAIN:20260921213000',
  'SYSTEM:INVENTORY_RECONCILIATION_LOSS:20260921213000'
);
