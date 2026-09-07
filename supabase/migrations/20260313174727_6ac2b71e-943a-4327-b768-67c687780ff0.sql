
-- Add posted_number column to all relevant tables
ALTER TABLE public.sales_invoices ADD COLUMN IF NOT EXISTS posted_number integer;
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS posted_number integer;
ALTER TABLE public.sales_returns ADD COLUMN IF NOT EXISTS posted_number integer;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS posted_number integer;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS posted_number integer;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS posted_number integer;
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS posted_number integer;

-- Add journal_entry_prefix to company_settings
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS journal_entry_prefix text NOT NULL DEFAULT 'JV-';
