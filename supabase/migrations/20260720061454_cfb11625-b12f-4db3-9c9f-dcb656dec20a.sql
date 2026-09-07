
-- 1) Ensure is_system column exists (safety for older DBs)
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- 2) Merge duplicates: keep the OLDEST row per code, remap all FKs to it, then delete the duplicates
DO $$
DECLARE
  r record;
  keeper uuid;
BEGIN
  FOR r IN
    SELECT code FROM public.accounts GROUP BY code HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper FROM public.accounts WHERE code = r.code ORDER BY created_at ASC, id ASC LIMIT 1;

    -- Remap all FK references from duplicates to the keeper
    UPDATE public.accounts               SET parent_id = keeper WHERE parent_id IN (SELECT id FROM public.accounts WHERE code = r.code AND id <> keeper);
    UPDATE public.journal_entry_lines    SET account_id = keeper WHERE account_id IN (SELECT id FROM public.accounts WHERE code = r.code AND id <> keeper);
    UPDATE public.expense_types          SET account_id = keeper WHERE account_id IN (SELECT id FROM public.accounts WHERE code = r.code AND id <> keeper);
    UPDATE public.company_settings       SET sales_tax_account_id = keeper WHERE sales_tax_account_id IN (SELECT id FROM public.accounts WHERE code = r.code AND id <> keeper);
    UPDATE public.company_settings       SET purchase_tax_account_id = keeper WHERE purchase_tax_account_id IN (SELECT id FROM public.accounts WHERE code = r.code AND id <> keeper);

    -- Delete the duplicate rows (now unreferenced)
    DELETE FROM public.accounts WHERE code = r.code AND id <> keeper;
  END LOOP;
END $$;

-- 3) Add UNIQUE(code) constraint if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(code)%'
  ) THEN
    ALTER TABLE public.accounts ADD CONSTRAINT accounts_code_key UNIQUE (code);
  END IF;
END $$;

-- 4) Ensure protected accounts are flagged as system
UPDATE public.accounts SET is_system = true
WHERE code IN (
  '1','2','3','4','5',                              -- 5 roots
  '11','12','21',                                   -- parent groups used by system
  '1101','1102','1103','1104','1105',               -- cash/bank/AR/inventory/input VAT
  '2101','2102',                                    -- AP / output VAT
  '3101','3102',                                    -- capital / retained
  '4101','4201',                                    -- sales / adjustment gain
  '5101','5108','5109'                              -- COGS / variance / prepaid consumption
);
