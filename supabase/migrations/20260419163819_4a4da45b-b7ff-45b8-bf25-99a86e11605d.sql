ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS enable_tax boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_tax_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_tax_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;