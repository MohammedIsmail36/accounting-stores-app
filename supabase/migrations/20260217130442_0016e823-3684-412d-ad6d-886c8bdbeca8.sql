
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE public.sales_invoices ADD COLUMN IF NOT EXISTS reference text;
