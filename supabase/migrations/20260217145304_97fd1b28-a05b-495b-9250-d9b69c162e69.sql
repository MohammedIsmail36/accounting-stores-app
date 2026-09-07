
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS business_activity text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sales_return_prefix text NOT NULL DEFAULT 'SRN-',
  ADD COLUMN IF NOT EXISTS purchase_return_prefix text NOT NULL DEFAULT 'PRN-',
  ADD COLUMN IF NOT EXISTS customer_payment_prefix text NOT NULL DEFAULT 'CPY-',
  ADD COLUMN IF NOT EXISTS supplier_payment_prefix text NOT NULL DEFAULT 'SPY-';
